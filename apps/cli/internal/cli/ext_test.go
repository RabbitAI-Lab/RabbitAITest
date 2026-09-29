package cli

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"testing"
)

// clearEnvOverride 清除 .env.local/环境变量覆盖（EffectiveConfig 的 env 层会胜出 config 文件——
// dotenv_test 等用 os.Setenv 时会穿透；测试间隔离纪律）。
func clearEnvOverride(t *testing.T) {
	t.Helper()
	for _, k := range []string{"TOKEN", "BASE_URL", "CONFIG_DIR"} {
		os.Unsetenv(EnvVar(k))
	}
}

// CLI-001-T0（扩展②④⑤⑥单测）：scope 传递 / refresh 旋转重试 / 页码分页 / 错误解包。

// TestLoginScopePassed：--scope 值随 device code 请求 form 提交；非法 scope 本地拒绝。
func TestLoginScopePassed(t *testing.T) {
	dir := t.TempDir()
	SetConfigDir(dir)
	defer SetConfigDir("")
	clearEnvOverride(t)

	var gotScope string
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.ParseForm()
		gotScope = r.Form.Get("scope")
		json.NewEncoder(w).Encode(map[string]any{
			"device_code": "dc1", "user_code": "ABCD-EFGH",
			"verification_uri": srv.URL, "interval": 0, "expires_in": 600,
		})
	}))
	defer srv.Close()

	if err := SaveConfig(map[string]any{
		"authDeviceUrl": srv.URL + "/device", "authTokenUrl": srv.URL + "/token", "authClientId": "c",
	}); err != nil {
		t.Fatal(err)
	}
	a := &Args{Flags: map[string]string{"scope": "read,exec", "no-wait": "true"}, Pos: []string{"login"}}
	if err := RunAuth(a); err != nil {
		t.Fatalf("login failed: %v", err)
	}
	if gotScope != "read,exec" {
		t.Fatalf("scope not passed to device endpoint: got %q", gotScope)
	}

	// 非法 scope：本地 usage 错误（不发出请求）
	bad := &Args{Flags: map[string]string{"scope": "admin"}, Pos: []string{"login"}}
	if err := RunAuth(bad); err == nil {
		t.Fatal("expected usage error for invalid scope")
	} else if e, ok := err.(*CliError); !ok || e.Type != "usage" {
		t.Fatalf("expected usage error, got %+v", err)
	}
}

// TestAutoRefreshOn401：401 + refresh_token 存在 → 自动旋转一次并重试原请求。
func TestAutoRefreshOn401(t *testing.T) {
	dir := t.TempDir()
	SetConfigDir(dir)
	defer SetConfigDir("")
	clearEnvOverride(t)

	calls := 0
	var newToken string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/token" {
			r.ParseForm()
			if r.Form.Get("grant_type") == "refresh_token" && r.Form.Get("refresh_token") == "rrt_old" {
				newToken = "rat_new"
				json.NewEncoder(w).Encode(map[string]any{
					"access_token": "rat_new", "refresh_token": "rrt_new", "expires_in": 7200,
				})
				return
			}
			w.WriteHeader(400)
			return
		}
		// API 端点：旧 token 401，新 token 200
		if r.Header.Get("Authorization") == "Bearer rat_new" {
			json.NewEncoder(w).Encode(map[string]any{"code": 0, "message": "ok", "data": map[string]any{"me": true}})
			return
		}
		calls++
		w.WriteHeader(401)
		json.NewEncoder(w).Encode(map[string]any{"code": 10001, "message": "未登录", "data": nil})
	}))
	defer srv.Close()

	if err := SaveConfig(map[string]any{
		"baseUrl": srv.URL, "token": "rat_old", "refreshToken": "rrt_old",
		"authTokenUrl": srv.URL + "/token", "authClientId": "c",
	}); err != nil {
		t.Fatal(err)
	}
	body, err := Request(RequestOpts{Method: "GET", Path: "/api/v1/personal/me"})
	if err != nil {
		t.Fatalf("request after refresh should succeed: %v", err)
	}
	if newToken != "rat_new" || calls != 1 {
		t.Fatalf("expected one refresh + retry (newToken=%q calls=%d)", newToken, calls)
	}
	if m, ok := body.(map[string]any); !ok || m["code"] != float64(0) {
		t.Fatalf("unexpected body after retry: %v", body)
	}
}

// TestPageAllPageNumberProtocol：page/size + total 协议——翻页至累计 = total 停。
func TestPageAllPageNumberProtocol(t *testing.T) {
	dir := t.TempDir()
	SetConfigDir(dir)
	defer SetConfigDir("")
	clearEnvOverride(t)

	requested := []string{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requested = append(requested, r.URL.Query().Get("page"))
		page := r.URL.Query().Get("page")
		switch page {
		case "", "1":
			json.NewEncoder(w).Encode(map[string]any{"total": 3, "items": []any{"a", "b"}})
		case "2":
			json.NewEncoder(w).Encode(map[string]any{"total": 3, "items": []any{"c"}})
		default:
			w.WriteHeader(400)
		}
	}))
	defer srv.Close()

	if err := SaveConfig(map[string]any{"baseUrl": srv.URL, "token": "t"}); err != nil {
		t.Fatal(err)
	}
	body, err := Request(RequestOpts{Method: "GET", Path: "/items", Params: map[string]string{"page": "1", "size": "2"}, PageAll: true})
	if err != nil {
		t.Fatal(err)
	}
	items, ok := body.([]any)
	if !ok || len(items) != 3 {
		t.Fatalf("expected 3 items aggregated, got %v", body)
	}
	if len(requested) != 2 || requested[1] != "2" {
		t.Fatalf("expected pages 1,2 requested, got %v", requested)
	}
}

// TestErrorEnvelopeLift：平台信封 {code,message}——message 提升为错误消息，业务码进 hint。
func TestErrorEnvelopeLift(t *testing.T) {
	dir := t.TempDir()
	SetConfigDir(dir)
	defer SetConfigDir("")
	clearEnvOverride(t)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(403)
		json.NewEncoder(w).Encode(map[string]any{"code": 10003, "message": "token scope 缺少 write（当前：read）", "data": nil})
	}))
	defer srv.Close()

	if err := SaveConfig(map[string]any{"baseUrl": srv.URL, "token": "t"}); err != nil {
		t.Fatal(err)
	}
	_, err := Request(RequestOpts{Method: "POST", Path: "/x", Data: map[string]any{}})
	if err == nil {
		t.Fatal("expected error")
	}
	ce, ok := err.(*CliError)
	if !ok {
		t.Fatalf("expected CliError, got %T", err)
	}
	if ce.Code != 403 || ce.Message != "token scope 缺少 write（当前：read）" {
		t.Fatalf("envelope not lifted: code=%d message=%q", ce.Code, ce.Message)
	}
}

// TestRefreshNotAttemptedWithoutToken：无 refreshToken 时 401 直接报错（不静默旋转）。
func TestRefreshNotAttemptedWithoutToken(t *testing.T) {
	dir := t.TempDir()
	SetConfigDir(dir)
	defer SetConfigDir("")
	clearEnvOverride(t)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(401)
		json.NewEncoder(w).Encode(map[string]any{"code": 10001, "message": "未登录或会话已过期", "data": nil})
	}))
	defer srv.Close()
	if err := SaveConfig(map[string]any{"baseUrl": srv.URL, "token": "rat_x"}); err != nil {
		t.Fatal(err)
	}
	_, err := Request(RequestOpts{Method: "GET", Path: "/x"})
	if err == nil {
		t.Fatal("expected 401 error")
	}
	if u, err := url.Parse(srv.URL); err != nil || u == nil {
		t.Fatal(err)
	}
}
