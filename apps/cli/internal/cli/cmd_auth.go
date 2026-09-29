// Optional OAuth2 device-authorization flow (RFC 8628).
//
// Auth is NOT mandatory: a static token from config / .env.local /
// RABBIT_TOKEN works without it. To enable `auth login`, configure:
//
//	rabbit config set authDeviceUrl  https://<rabbit-server>/api/v1/oauth/device/code
//	rabbit config set authTokenUrl   https://<rabbit-server>/api/v1/oauth/token
//	rabbit config set authClientId   rabbit-cli
//
// RabbitAITest extensions (SYS-009 / CLI-001, upstreamable):
//   - `--scope` is carried with the device code request and echoed in status (default read)
//   - refresh_token is persisted; httpapi automatically rotates a single time and retries on 401
//   - polling interval/deadline respect the device response's interval/expires_in
//   - logout best-effort revokes the server-side session before authRevokeUrl
package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const authHelp = `Usage: rabbit auth <subcommand>

Optional OAuth2 device-flow login. Not required: static tokens via
config / .env.local / env vars work without it.

Subcommands:
  login [--scope read,exec] [--no-wait] [--device-code CODE]   Device-flow login
  status                                                      Credential and scope
  logout                                                      Revoke session and remove token

Requires config keys: authDeviceUrl, authTokenUrl, authClientId.`

type deviceCodeResponse struct {
	DeviceCode              string `json:"device_code"`
	UserCode                string `json:"user_code"`
	VerificationURI         string `json:"verification_uri"`
	VerificationURIComplete string `json:"verification_uri_complete"`
	Interval                int    `json:"interval"`
	ExpiresIn               int    `json:"expires_in"`
}

type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
	Scope        string `json:"scope"`
	TokenType    string `json:"token_type"`
}

// RunAuth implements the auth command group.
func RunAuth(a *Args) error {
	format, err := a.OutputFormat()
	if err != nil {
		return err
	}
	if a.Bool("help") || len(a.Pos) == 0 {
		fmt.Println(authHelp)
		return nil
	}
	switch a.Pos[0] {
	case "login":
		return authLogin(a, format)
	case "status":
		return authStatus(format)
	case "logout":
		return authLogout(format)
	default:
		return usageError(fmt.Sprintf("Unknown auth subcommand %q", a.Pos[0]), authHelp)
	}
}

func authEndpoints() (deviceURL, tokenURL, clientID string, err *CliError) {
	cfg, e := LoadConfig()
	if e != nil {
		return "", "", "", &CliError{Type: "config", Message: e.Error()}
	}
	deviceURL, _ = cfg["authDeviceUrl"].(string)
	tokenURL, _ = cfg["authTokenUrl"].(string)
	clientID, _ = cfg["authClientId"].(string)
	if deviceURL == "" || tokenURL == "" || clientID == "" {
		return "", "", "", &CliError{
			Type:    "config",
			Message: "OAuth not configured (authDeviceUrl / authTokenUrl / authClientId missing)",
			Hint:    "Auth is optional — a static token works without it. To enable: rabbit config set authDeviceUrl/authTokenUrl/authClientId.",
		}
	}
	return deviceURL, tokenURL, clientID, nil
}

// normalizeScope validates the scope list (deny-by-default, the server does the same validation).
func normalizeScope(raw string) (string, *CliError) {
	if raw == "" {
		return "read", nil
	}
	seen := map[string]bool{}
	var out []string
	for _, s := range strings.Split(raw, ",") {
		s = strings.TrimSpace(s)
		if s == "" {
			continue
		}
		if s != "read" && s != "write" && s != "exec" {
			return "", usageError("invalid scope: "+s, "scope can only be a comma-separated combination of read / write / exec")
		}
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	if len(out) == 0 {
		return "read", nil
	}
	return strings.Join(out, ","), nil
}

func authLogin(a *Args, format string) error {
	deviceURL, tokenURL, clientID, cerr := authEndpoints()
	if cerr != nil {
		return cerr
	}
	scope, serr := normalizeScope(a.Str("scope"))
	if serr != nil {
		return serr
	}

	dc := a.Str("device-code")
	interval := 5 * time.Second
	deadline := time.Now().Add(10 * time.Minute)

	if dc == "" {
		res, err := http.PostForm(deviceURL, url.Values{
			"client_id": {clientID},
			"scope":     {scope},
		})
		if err != nil {
			return &CliError{Type: "network", Message: err.Error()}
		}
		defer res.Body.Close()
		if res.StatusCode != 200 {
			return &CliError{Type: "api", Code: res.StatusCode, Message: fmt.Sprintf("Device endpoint returned HTTP %d", res.StatusCode)}
		}
		var dr deviceCodeResponse
		if err := json.NewDecoder(res.Body).Decode(&dr); err != nil {
			return &CliError{Type: "api", Message: "Invalid device-code response: " + err.Error()}
		}
		dc = dr.DeviceCode
		// Respect the server-side pacing hints (interval/expires_in); fall back to 5s/10min when absent
		if dr.Interval > 0 {
			interval = time.Duration(dr.Interval) * time.Second
		}
		if dr.ExpiresIn > 0 {
			deadline = time.Now().Add(time.Duration(dr.ExpiresIn) * time.Second)
		}
		openURI := dr.VerificationURIComplete
		if openURI == "" {
			openURI = dr.VerificationURI
		}
		info := map[string]any{
			"verification_uri":          dr.VerificationURI,
			"verification_uri_complete": openURI,
			"user_code":                 dr.UserCode,
			"device_code":               dc,
			"expires_in":                dr.ExpiresIn,
			"interval":                  dr.Interval,
			"scope":                     scope,
		}
		fmt.Fprintf(os.Stderr, "Open %s and enter code %s\n", openURI, dr.UserCode)
		if a.Bool("no-wait") {
			info["status"] = "pending"
			info["hint"] = "Resume later: rabbit auth login --device-code " + dc
			EmitSuccess(info, format, nil)
			return nil
		}
		EmitSuccess(info, format, nil) // Agent can relay the URL/code to the user
	}

	// Poll the token endpoint
	for {
		res, err := http.PostForm(tokenURL, url.Values{
			"grant_type":  {"urn:ietf:params:oauth:grant-type:device_code"},
			"device_code": {dc},
			"client_id":   {clientID},
		})
		if err != nil {
			return &CliError{Type: "network", Message: err.Error()}
		}
		var body map[string]any
		json.NewDecoder(res.Body).Decode(&body)
		res.Body.Close()

		if tok, _ := body["access_token"].(string); tok != "" {
			return saveTokens(body, format)
		}
		errCode, _ := body["error"].(string)
		switch errCode {
		case "authorization_pending", "":
			// keep polling
		case "slow_down":
			interval += 5 * time.Second
		default:
			return &CliError{Type: "api", Message: "OAuth error: " + errCode, Hint: str(body["error_description"])}
		}
		if time.Now().After(deadline) {
			return &CliError{Type: "api", Message: "Device flow timed out", Hint: "Run `rabbit auth login` again."}
		}
		time.Sleep(interval)
	}
}

// saveTokens persists access/refresh and the scope (from the token endpoint response).
func saveTokens(body map[string]any, format string) error {
	tok, _ := body["access_token"].(string)
	cfg, err := LoadConfig()
	if err != nil {
		return err
	}
	cfg["token"] = tok
	delete(cfg, "refreshToken")
	authMeta := map[string]any{"method": "oauth_device", "obtained_at": time.Now().UTC().Format(time.RFC3339)}
	if rt, _ := body["refresh_token"].(string); rt != "" {
		cfg["refreshToken"] = rt
		authMeta["refresh"] = true
	}
	if sc, _ := body["scope"].(string); sc != "" {
		authMeta["scope"] = sc
	} else if sc2, _ := cfg["authScope"].(string); sc2 != "" {
		authMeta["scope"] = sc2
	}
	if exp, ok := body["expires_in"].(float64); ok && exp > 0 {
		authMeta["access_expires_at"] = time.Now().Add(time.Duration(exp) * time.Second).UTC().Format(time.RFC3339)
	}
	cfg["auth"] = authMeta
	if err := SaveConfig(cfg); err != nil {
		return err
	}
	Log(context.Background(), slog.LevelInfo, "auth login succeeded")
	EmitSuccess(map[string]any{
		"authenticated": true,
		"scope":         authMeta["scope"],
		"refresh":       authMeta["refresh"] == true,
	}, format, nil)
	return nil
}

// tryRefreshToken rotates the refresh_token once and writes it back (for httpapi's single 401 retry).
// Returns the new access token; when there is no refresh_token or rotation fails, returns "" (caller keeps the original token semantics).
func tryRefreshToken() (string, bool) {
	cfg, err := LoadConfig()
	if err != nil {
		return "", false
	}
	rt, _ := cfg["refreshToken"].(string)
	tokenURL, _ := cfg["authTokenUrl"].(string)
	if rt == "" || tokenURL == "" {
		return "", false
	}
	clientID, _ := cfg["authClientId"].(string)
	res, err := http.PostForm(tokenURL, url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {rt},
		"client_id":     {clientID},
	})
	if err != nil || res.StatusCode != 200 {
		if res != nil {
			res.Body.Close()
		}
		return "", false
	}
	defer res.Body.Close()
	var body map[string]any
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		return "", false
	}
	tok, _ := body["access_token"].(string)
	if tok == "" {
		return "", false
	}
	cfg["token"] = tok
	if nrt, _ := body["refresh_token"].(string); nrt != "" {
		cfg["refreshToken"] = nrt
	}
	if a, ok := cfg["auth"].(map[string]any); ok {
		a["obtained_at"] = time.Now().UTC().Format(time.RFC3339)
	}
	if err := SaveConfig(cfg); err != nil {
		return "", false
	}
	return tok, true
}

func authStatus(format string) error {
	source := "none"
	masked := any(nil)
	cfg, err := LoadConfig()
	if err != nil {
		return err
	}
	eff, err := EffectiveConfig()
	if err != nil {
		return err
	}
	out := map[string]any{
		"env": CurrentEnv(cfg),
	}
	if tok, _ := eff["token"].(string); tok != "" {
		masked = "****" + tok[max(0, len(tok)-4):]
		switch {
		case os.Getenv(EnvVar("TOKEN")) != "":
			source = "env (incl. .env.local)"
		default:
			source = "config file"
			if a, ok := cfg["auth"].(map[string]any); ok {
				if m, _ := a["method"].(string); m != "" {
					source = "oauth (" + m + ")"
				}
				if sc, _ := a["scope"].(string); sc != "" {
					out["scope"] = sc
				}
				if exp, _ := a["access_expires_at"].(string); exp != "" {
					out["access_expires_at"] = exp
					out["refresh"] = cfg["refreshToken"] != nil
				}
			}
		}
	}
	out["authenticated"] = source != "none"
	out["token_source"] = source
	out["token"] = masked
	EmitSuccess(out, format, nil)
	return nil
}

func authLogout(format string) error {
	cfg, err := LoadConfig()
	if err != nil {
		return err
	}
	revoked := false
	// Best-effort server-side revocation (authRevokeUrl is optional; failure does not block local cleanup)
	if revokeURL, _ := cfg["authRevokeUrl"].(string); revokeURL != "" {
		if tok, _ := cfg["token"].(string); tok != "" {
			req, _ := http.NewRequest("POST", revokeURL, strings.NewReader("{}"))
			req.Header.Set("Authorization", "Bearer "+tok)
			req.Header.Set("Content-Type", "application/json")
			if res, err := http.DefaultClient.Do(req); err == nil {
				revoked = res.StatusCode >= 200 && res.StatusCode < 300
				res.Body.Close()
			}
		}
	}
	delete(cfg, "token")
	delete(cfg, "refreshToken")
	delete(cfg, "auth")
	if err := SaveConfig(cfg); err != nil {
		return err
	}
	EmitSuccess(map[string]any{"logged_out": true, "server_revoked": revoked}, format, nil)
	return nil
}
