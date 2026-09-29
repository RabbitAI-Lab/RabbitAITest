// Configuration storage.
//
// The config directory is customizable (like npm's prefix), with precedence:
//  1. --config-dir <dir> global flag (per invocation)
//  2. RABBITCLI_CONFIG_DIR environment variable (per shell/session)
//  3. default ~/.config/rabbitcli
package cli

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
)

func jsonUnmarshal(b []byte, v any) error { return json.Unmarshal(b, v) }

var configDirOverride string

// SetConfigDir sets a process-wide config dir override (from --config-dir).
func SetConfigDir(dir string) {
	if dir != "" {
		configDirOverride = dir
	}
}

// ConfigDir resolves the effective config directory.
func ConfigDir() string {
	if configDirOverride != "" {
		return configDirOverride
	}
	if d := os.Getenv(EnvVar("CONFIG_DIR")); d != "" {
		return d
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".config", Name)
}

func configPath() string { return filepath.Join(ConfigDir(), "config.json") }

// LoadConfig reads the config file; missing file yields an empty map.
func LoadConfig() (map[string]any, error) {
	p := configPath()
	b, err := os.ReadFile(p)
	if os.IsNotExist(err) {
		return map[string]any{}, nil
	}
	if err != nil {
		return nil, err
	}
	var cfg map[string]any
	if err := json.Unmarshal(b, &cfg); err != nil {
		return nil, &CliError{
			Type:    "config",
			Message: "Invalid config file at " + p,
			Hint:    "Fix the JSON or run `rabbitcli config init` to recreate it.",
		}
	}
	return cfg, nil
}

// SaveConfig writes the config file with 0600 permissions.
func SaveConfig(cfg map[string]any) error {
	if err := os.MkdirAll(ConfigDir(), 0o700); err != nil {
		return err
	}
	b, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(configPath(), append(b, '\n'), 0o600)
}

// --- Environments ---
//
// Named environments (dev / staging / prod ...) are stored in the config
// file under "envs"; the active one is selected with precedence:
//  1. --env <name> global flag (per invocation)
//  2. RABBITCLI_ENV environment variable (per shell/session)
//  3. "current_env" key in the config file (set via `rabbitcli env use`)
//  4. none — top-level baseUrl/token are used as-is

var envOverride string

// SetEnv sets a process-wide environment override (from --env).
func SetEnv(name string) {
	if name != "" {
		envOverride = name
	}
}

// CurrentEnv resolves the active environment name ("" = none).
func CurrentEnv(cfg map[string]any) string {
	if envOverride != "" {
		return envOverride
	}
	if e := os.Getenv(EnvVar("ENV")); e != "" {
		return e
	}
	if e, _ := cfg["current_env"].(string); e != "" {
		return e
	}
	return ""
}

// EffectiveConfig returns the config with the active environment merged in
// (environment values override top-level keys like baseUrl/token).
func EffectiveConfig() (map[string]any, error) {
	cfg, err := LoadConfig()
	if err != nil {
		return nil, err
	}
	env := CurrentEnv(cfg)
	if env == "" {
		applyEnvOverrides(cfg)
		return cfg, nil
	}
	envs, _ := cfg["envs"].(map[string]any)
	entry, ok := envs[env].(map[string]any)
	if !ok {
		return nil, &CliError{
			Type:    "config",
			Message: "Unknown environment " + strconv.Quote(env),
			Hint:    "Run `rabbitcli env list` to see available environments.",
		}
	}
	out := map[string]any{}
	for k, v := range cfg {
		out[k] = v
	}
	for k, v := range entry {
		out[k] = v
	}
	// Process env vars (including ones loaded from .env.local) override
	// the config file for credentials and endpoints.
	applyEnvOverrides(out)
	return out, nil
}

// applyEnvOverrides lets RABBITCLI_BASE_URL / RABBITCLI_TOKEN (from the real
// environment or .env.local) override config-file values.
func applyEnvOverrides(cfg map[string]any) {
	if v := os.Getenv(EnvVar("BASE_URL")); v != "" {
		cfg["baseUrl"] = v
	}
	if v := os.Getenv(EnvVar("TOKEN")); v != "" {
		cfg["token"] = v
	}
}
