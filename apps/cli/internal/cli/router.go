package cli

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"time"
)

const help = `Usage: rabbitcli <command> [flags]

Built-in command groups:
  config     Configure the CLI (init / set / get / show)
  env        Environment switcher (list / add / use / current / remove)
  api        Raw API call: rabbitcli api <METHOD> <PATH>
  update     Self-update: check the release endpoint and upgrade in place
  schema     Machine-readable command schemas (for humans and Agents)
  skills     Agent skills: list / install / scaffold SKILL.md docs
  auth       Optional OAuth2 device login (static tokens work without it)

Service command groups self-register from internal/services/ files
(see ` + "`rabbitcli schema`" + ` for the full list).

Global flags:
  --format json|pretty|table|ndjson|csv   Output format (default: json)
  --config-dir <dir>                      Override the config directory (like npm prefix)
  --env <name>                            Override the active environment (dev/staging/prod...)
  --dry-run                               Preview the request without sending it
  --page-all, --page-limit, --page-delay  Pagination controls
  --verbose, --debug                      Log verbosity (default: warn; logs go to files only)
  -h, --help                              Show help

Run ` + "`rabbitcli <group> --help`" + ` for group-specific usage.`

// Main is the CLI entry point; returns the process exit code via os.Exit on error.
func Main() {
	argv := os.Args[1:]
	// Find the command group: first non-flag token.
	group := ""
	rest := []string{}
	for i, tok := range argv {
		if len(tok) > 0 && tok[0] != '-' {
			group = tok
			rest = append(argv[:i], argv[i+1:]...)
			break
		}
	}
	if group == "" {
		rest = argv
	}

	switch {
	case group == "" || group == "-h" || group == "--help" || group == "help":
		// Version flags: -v, --version, -version, --v (also: rabbitcli version)
		for _, t := range argv {
			if t == "-v" || t == "--version" || t == "-version" || t == "--v" {
				fmt.Println(Name + " " + Version)
				return
			}
		}
		fmt.Println(help)
		printServices()

	case group == "version":
		fmt.Println(Name + " " + Version)

	case group == "config" || group == "env" || group == "api" || group == "update" ||
		group == "schema" || group == "skills" || group == "auth" || GetService(group) != nil:
		a, err := ParseArgs(rest)
		if err != nil {
			EmitError(err)
		}
		if d := a.Str("config-dir"); d != "" {
			SetConfigDir(d)
		}
		LoadDotenv() // ./.env.local then <config-dir>/.env.local; real env vars win
		if e := a.Str("env"); e != "" {
			SetEnv(e)
		}
		InitLogging(ResolveLogLevel(a))
		start := time.Now()
		safeArgs := make([]string, len(a.Pos))
		for i, p := range a.Pos {
			safeArgs[i] = redactURL(p)
		}
		Log(context.Background(), slog.LevelInfo, "command start", "group", group, "args", safeArgs)

		var runErr error
		switch group {
		case "config":
			runErr = RunConfig(a)
		case "env":
			runErr = RunEnv(a)
		case "api":
			runErr = RunAPI(a)
		case "update":
			runErr = RunUpdate(a)
		case "schema":
			runErr = RunSchema(a)
		case "skills":
			runErr = RunSkills(a)
		case "auth":
			runErr = RunAuth(a)
		default:
			// Auto-registered service from internal/services/
			runErr = GetService(group).Handler(a)
		}
		if runErr != nil {
			Log(context.Background(), slog.LevelWarn, "command failed", "group", group, "elapsed_ms", time.Since(start).Milliseconds(), "error", runErr.Error())
			EmitError(runErr)
		}
		Log(context.Background(), slog.LevelInfo, "command done", "group", group, "elapsed_ms", time.Since(start).Milliseconds())

	default:
		fmt.Fprintf(os.Stderr, "Unknown command %q.\n\n%s\n", group, help)
		printServices()
		os.Exit(2)
	}
}

func printServices() {
	svcs := ListServices()
	if len(svcs) == 0 {
		return
	}
	fmt.Println("\nRegistered services:")
	for _, s := range svcs {
		fmt.Printf("  %-10s %s\n", s.Name, s.Description)
	}
}
