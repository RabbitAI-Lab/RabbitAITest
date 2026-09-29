package cli

import (
	"fmt"
	"sort"
	"strconv"
)

const envHelp = `Usage: rabbitcli env <subcommand>

Environment switcher: named environments each hold their own
baseUrl / token, so debugging can point the CLI at a different backend.

Subcommands:
  list                          List all environments (* marks the active one)
  add <name> [--base-url URL] [--token T]   Create or update an environment
  use <name>                    Switch the active environment (persisted)
  current                       Print the active environment name
  remove <name>                 Delete an environment

Selection precedence: --env <name> flag > RABBITCLI_ENV env var > env use.

Examples:
  rabbitcli env add dev --base-url https://dev-api.example.com
  rabbitcli env add prod --base-url https://api.example.com
  rabbitcli env use dev
  rabbitcli api GET /v1/items --env prod        # one-off override`

// RunEnv implements the env command group.
func RunEnv(a *Args) error {
	format, err := a.OutputFormat()
	if err != nil {
		return err
	}
	if a.Bool("help") || len(a.Pos) == 0 {
		fmt.Println(envHelp)
		return nil
	}
	sub := a.Pos[0]
	rest := a.Pos[1:]

	cfg, err := LoadConfig()
	if err != nil {
		return err
	}
	envs, _ := cfg["envs"].(map[string]any)
	if envs == nil {
		envs = map[string]any{}
	}

	switch sub {
	case "list":
		active := CurrentEnv(cfg)
		names := make([]string, 0, len(envs))
		for n := range envs {
			names = append(names, n)
		}
		sort.Strings(names)
		rows := make([]any, 0, len(names))
		for _, n := range names {
			e, _ := envs[n].(map[string]any)
			rows = append(rows, map[string]any{
				"name": n, "active": n == active,
				"base_url": e["baseUrl"], "has_token": e["token"] != nil && e["token"] != "",
			})
		}
		EmitSuccess(rows, format, map[string]any{"current": active})
	case "add":
		if len(rest) < 1 {
			return usageError("env add requires <name>", envHelp)
		}
		name := rest[0]
		entry, _ := envs[name].(map[string]any)
		if entry == nil {
			entry = map[string]any{}
		}
		if v := a.Str("base-url"); v != "" {
			entry["baseUrl"] = v
		}
		if v := a.Str("token"); v != "" {
			entry["token"] = v
		}
		envs[name] = entry
		cfg["envs"] = envs
		if err := SaveConfig(cfg); err != nil {
			return err
		}
		EmitSuccess(map[string]any{"name": name, "base_url": entry["baseUrl"], "saved": true}, format, nil)
	case "use":
		if len(rest) < 1 {
			return usageError("env use requires <name>", envHelp)
		}
		if _, ok := envs[rest[0]]; !ok {
			return &CliError{Type: "config", Message: "Unknown environment " + strconv.Quote(rest[0]), Hint: "Run `rabbitcli env add " + rest[0] + " --base-url ...` first."}
		}
		cfg["current_env"] = rest[0]
		if err := SaveConfig(cfg); err != nil {
			return err
		}
		EmitSuccess(map[string]any{"current_env": rest[0]}, format, nil)
	case "current":
		EmitSuccess(map[string]any{"current_env": CurrentEnv(cfg)}, format, nil)
	case "remove":
		if len(rest) < 1 {
			return usageError("env remove requires <name>", envHelp)
		}
		delete(envs, rest[0])
		cfg["envs"] = envs
		if cfg["current_env"] == rest[0] {
			delete(cfg, "current_env")
		}
		if err := SaveConfig(cfg); err != nil {
			return err
		}
		EmitSuccess(map[string]any{"removed": rest[0]}, format, nil)
	default:
		return usageError(fmt.Sprintf("Unknown env subcommand %q", sub), envHelp)
	}
	return nil
}
