package cli

import "strings"

// Name is the single source of truth for the CLI's identity. It drives:
//   - the environment variable prefix (strings.ToUpper(Name) + "_")
//   - the default config directory (~/.config/<Name>)
//   - log file names (<Name>-YYYYMMDD.log)
//
// Override at build time (rename without touching source):
//
//	go build -ldflags "-X github.com/RabbitAI-Lab/RabbitCLI-Bootstrap/internal/cli.Name=acmecli"
var Name = "rabbitcli"

// EnvPrefix is the environment variable prefix, e.g. "RABBITCLI_".
func EnvPrefix() string {
	return strings.ToUpper(Name) + "_"
}

// EnvVar returns the full env var name for a suffix, e.g. EnvVar("TOKEN").
func EnvVar(suffix string) string {
	return EnvPrefix() + suffix
}
