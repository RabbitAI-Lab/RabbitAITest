package cli

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

const configHelp = `Usage: rabbitcli config <subcommand>

Subcommands:
  init              Interactive guided setup (base URL, token, default format)
  set <key> <value> Set a config value
  get <key>         Print a config value
  show              Print the full config (token masked, includes _dir)

Global flags: --format json|pretty|table|ndjson|csv, --config-dir <dir>`

// RunConfig implements the config command group.
func RunConfig(a *Args) error {
	format, err := a.OutputFormat()
	if err != nil {
		return err
	}
	if a.Bool("help") || len(a.Pos) == 0 {
		fmt.Println(configHelp)
		return nil
	}
	sub := a.Pos[0]
	rest := a.Pos[1:]

	switch sub {
	case "init":
		return configInit(format)
	case "set":
		if len(rest) < 2 {
			return usageError("config set requires <key> and <value>", configHelp)
		}
		cfg, err := LoadConfig()
		if err != nil {
			return err
		}
		cfg[rest[0]] = rest[1]
		if err := SaveConfig(cfg); err != nil {
			return err
		}
		EmitSuccess(map[string]any{"key": rest[0], "value": rest[1]}, format, nil)
	case "get":
		if len(rest) < 1 {
			return usageError("config get requires <key>", configHelp)
		}
		cfg, err := LoadConfig()
		if err != nil {
			return err
		}
		EmitSuccess(map[string]any{"key": rest[0], "value": cfg[rest[0]]}, format, nil)
	case "show":
		cfg, err := LoadConfig()
		if err != nil {
			return err
		}
		if t, ok := cfg["token"].(string); ok && len(t) > 4 {
			cfg["token"] = "****" + t[len(t)-4:]
		}
		cfg["_dir"] = ConfigDir()
		cfg["_env"] = CurrentEnv(cfg)
		EmitSuccess(cfg, format, nil)
	default:
		return usageError(fmt.Sprintf("Unknown config subcommand %q", sub), configHelp)
	}
	return nil
}

func configInit(format string) error {
	cfg, err := LoadConfig()
	if err != nil {
		return err
	}
	reader := bufio.NewReader(os.Stdin)
	ask := func(label, current string) string {
		if current == "" {
			current = "none"
		}
		fmt.Fprintf(os.Stderr, "%s [%s]: ", label, current)
		line, _ := reader.ReadString('\n')
		return strings.TrimSpace(line)
	}
	if v := ask("API base URL", str(cfg["baseUrl"])); v != "" {
		cfg["baseUrl"] = v
	}
	if v := ask("API token (leave empty to keep current)", ""); v != "" {
		cfg["token"] = v
	}
	def := str(cfg["format"])
	if def == "" {
		def = "json"
	}
	if v := ask("Default output format", def); v != "" {
		cfg["format"] = v
	}
	if err := SaveConfig(cfg); err != nil {
		return err
	}
	EmitSuccess(map[string]any{"configured": true, "_dir": ConfigDir()}, format, nil)
	return nil
}

func str(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}
