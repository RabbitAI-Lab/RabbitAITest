package cli

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// TestAuthDeviceFlow runs auth login against a mock OAuth server:
// first poll returns authorization_pending, second returns a token.
func TestAuthDeviceFlow(t *testing.T) {
	dir := t.TempDir()
	SetConfigDir(dir)
	defer SetConfigDir("")

	polls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch filepath.Base(r.URL.Path) {
		case "device":
			json.NewEncoder(w).Encode(map[string]any{
				"device_code": "dc123", "user_code": "ABCD-EFGH",
				"verification_uri": "https://auth.example.com/activate",
				"interval": 0, "expires_in": 600,
			})
		case "token":
			polls++
			if polls < 2 {
				json.NewEncoder(w).Encode(map[string]any{"error": "authorization_pending"})
			} else {
				json.NewEncoder(w).Encode(map[string]any{"access_token": "tok-dev-flow"})
			}
		}
	}))
	defer srv.Close()

	cfg := map[string]any{
		"authDeviceUrl": srv.URL + "/device",
		"authTokenUrl":  srv.URL + "/token",
		"authClientId":  "test-client",
	}
	if err := SaveConfig(cfg); err != nil {
		t.Fatal(err)
	}

	a := &Args{Flags: map[string]string{}, Pos: []string{"login"}}
	if err := RunAuth(a); err != nil {
		t.Fatalf("auth login failed: %v", err)
	}
	got, _ := LoadConfig()
	if got["token"] != "tok-dev-flow" {
		t.Fatalf("token not stored: %v", got["token"])
	}
	if a2, ok := got["auth"].(map[string]any); !ok || a2["method"] != "oauth_device" {
		t.Fatalf("auth metadata missing: %v", got["auth"])
	}
}

func TestAuthNotConfigured(t *testing.T) {
	dir := t.TempDir()
	SetConfigDir(dir)
	defer SetConfigDir("")
	os.Unsetenv(EnvVar("TOKEN"))
	a := &Args{Flags: map[string]string{}, Pos: []string{"login"}}
	err := RunAuth(a)
	ce, ok := err.(*CliError)
	if !ok || ce.Type != "config" {
		t.Fatalf("expected config error, got %v", err)
	}
}
