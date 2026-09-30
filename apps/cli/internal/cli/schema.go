// Schema introspection: `rabbitcli schema [group]` prints a machine-readable
// description of each command group — flags, positionals, examples — so both
// humans and AI Agents can discover usage without reading source.
package cli

import (
	"fmt"
	"sort"
)

// FlagSchema describes one flag.
type FlagSchema struct {
	Name     string `json:"name"`
	Type     string `json:"type"` // string | bool | int | json
	Required bool   `json:"required,omitempty"`
	Desc     string `json:"desc"`
}

// CommandSchema describes one command group.
type CommandSchema struct {
	Name        string       `json:"name"`
	Description string       `json:"description"`
	Usage       string       `json:"usage"`
	Positionals []string     `json:"positionals,omitempty"`
	Flags       []FlagSchema `json:"flags,omitempty"`
	Subcommands []string     `json:"subcommands,omitempty"`
	Examples    []string     `json:"examples,omitempty"`
}

var globalFlags = []FlagSchema{
	{Name: "format", Type: "string", Desc: "json|pretty|table|ndjson|csv (default json)"},
	{Name: "config-dir", Type: "string", Desc: "Override the config directory"},
	{Name: "env", Type: "string", Desc: "Override the active environment"},
	{Name: "verbose", Type: "bool", Desc: "Info-level file logging"},
	{Name: "debug", Type: "bool", Desc: "Debug-level file logging (incl. HTTP requests)"},
}

// schemas is the registry; keep it in sync when adding command groups.
var schemas = map[string]CommandSchema{
	"config": {
		Name: "config", Description: "Configure the CLI (base URL, token, defaults)",
		Usage:       "rabbitcli config <subcommand>",
		Subcommands: []string{"init", "set <key> <value>", "get <key>", "show"},
		Examples:    []string{"rabbitcli config init", "rabbitcli config set baseUrl https://api.example.com"},
	},
	"env": {
		Name: "env", Description: "Environment switcher (dev/staging/prod backends)",
		Usage:       "rabbitcli env <subcommand>",
		Subcommands: []string{"list", "add <name> --base-url URL [--token T]", "use <name>", "current", "remove <name>"},
		Flags:       []FlagSchema{{Name: "base-url", Type: "string", Desc: "API base URL (env add)"}, {Name: "token", Type: "string", Desc: "Credential (env add)"}},
		Examples:    []string{"rabbitcli env add dev --base-url https://dev-api.example.com", "rabbitcli env use dev"},
	},
	"demo": {
		Name: "demo", Description: "Example service: shortcuts and resource commands (replace with yours)",
		Usage:       "rabbitcli demo <command>",
		Subcommands: []string{"+hello", "items list", "items get <id>"},
		Examples:    []string{"rabbitcli demo +hello", "rabbitcli demo items list --format table"},
	},
	"api": {
		Name: "api", Description: "Raw API call against the configured base URL",
		Usage:       "rabbitcli api <METHOD> <PATH>",
		Positionals: []string{"METHOD (GET/POST/...)", "PATH (/v1/...)"},
		Flags: []FlagSchema{
			{Name: "params", Type: "json", Desc: "Query parameters as JSON object"},
			{Name: "data", Type: "json", Desc: "Request body as JSON"},
			{Name: "dry-run", Type: "bool", Desc: "Preview the request without sending it"},
			{Name: "page-all", Type: "bool", Desc: "Auto-paginate via cursor"},
			{Name: "page-limit", Type: "int", Desc: "Max pages with --page-all"},
			{Name: "page-delay", Type: "int", Desc: "Milliseconds between page requests"},
		},
		Examples: []string{`rabbitcli api GET /v1/items --params '{"limit":10}'`, `rabbitcli api POST /v1/items --data '{"name":"Ada"}' --dry-run`},
	},
	"update": {
		Name: "update", Description: "Self-update from GitHub Releases (atomic binary replace)",
		Usage: "rabbitcli update [--check] [--repo owner/name]",
		Flags: []FlagSchema{
			{Name: "check", Type: "bool", Desc: "Only check, do not install"},
			{Name: "repo", Type: "string", Desc: "GitHub repo (default: built-in)"},
		},
		Examples: []string{"rabbitcli update --check"},
	},
	"auth": {
		Name: "auth", Description: "Optional OAuth2 device-flow login (not required if you use static tokens)",
		Usage:       "rabbitcli auth <subcommand>",
		Subcommands: []string{"login", "status", "logout"},
		Flags: []FlagSchema{
			{Name: "no-wait", Type: "bool", Desc: "Return the verification URL immediately without polling"},
			{Name: "device-code", Type: "string", Desc: "Resume polling for a pending login"},
		},
		Examples: []string{"rabbitcli auth login", "rabbitcli auth status"},
	},
	"schema": {
		Name: "schema", Description: "Machine-readable command schemas for introspection",
		Usage:       "rabbitcli schema [group]",
		Subcommands: []string{"(no args = list all)", "<group>"},
		Examples:    []string{"rabbitcli schema", "rabbitcli schema api"},
	},
	"skills": {
		Name: "skills", Description: "Agent skills: list / install bundled SKILL.md docs, scaffold new ones",
		Usage:       "rabbitcli skills <subcommand>",
		Subcommands: []string{"list", "install [--dir PATH]", "new <name>"},
		Examples:    []string{"rabbitcli skills list", "rabbitcli skills install --dir ~/.agents/skills"},
	},
}

// RunSchema implements the schema command.
func RunSchema(a *Args) error {
	format, err := a.OutputFormat()
	if err != nil {
		return err
	}
	if len(a.Pos) == 0 {
		names := make([]string, 0, len(schemas))
		for n := range schemas {
			names = append(names, n)
		}
		for _, s := range ListServices() {
			if _, ok := schemas[s.Name]; !ok {
				names = append(names, s.Name)
			}
		}
		sort.Strings(names)
		EmitSuccess(map[string]any{
			"commands": names, "global_flags": globalFlags,
		}, format, nil)
		return nil
	}
	s, ok := schemas[a.Pos[0]]
	if !ok {
		if svc := GetService(a.Pos[0]); svc != nil {
			s = svc.Schema
			ok = true
		}
	}
	if !ok {
		return usageError(fmt.Sprintf("Unknown command group %q", a.Pos[0]), "Run `rabbitcli schema` to list all groups.")
	}
	EmitSuccess(s, format, nil)
	return nil
}
