package cli

import (
	"fmt"
	"os"
)

// Version is set at build time: go build -ldflags "-X .../cli.Version=1.0.0"
var Version = "0.1.0-dev"

// DefaultRepo is the GitHub repo queried for releases; override per
// invocation with --repo owner/name.
const DefaultRepo = "example/rabbitcli"

const updateHelp = `Usage: rabbitcli update [flags]

Self-update: check a GitHub Releases-compatible endpoint for a newer
version and upgrade the binary in place.

Flags:
  --check              Only check for a new version, do not install
  --repo owner/name    Override the GitHub repo (default: ` + DefaultRepo + `)
  --format             Output format

Release assets must be named like: rabbitcli-linux-amd64, rabbitcli-darwin-arm64,
rabbitcli-windows-amd64.exe (GOOS-GOARCH suffix).

Examples:
  rabbitcli update --check
  rabbitcli update
  rabbitcli update --repo owner/name --check`

// RunUpdate implements the self-update command.
func RunUpdate(a *Args) error {
	format, err := a.OutputFormat()
	if err != nil {
		return err
	}
	if a.Bool("help") {
		fmt.Println(updateHelp)
		return nil
	}
	repo := a.Str("repo")
	if repo == "" {
		repo = DefaultRepo
	}
	rel, err := FetchLatestRelease(repo)
	if err != nil {
		return err
	}
	latest := rel.TagName
	cmp := CompareVersions(latest, Version)

	if a.Bool("check") {
		EmitSuccess(map[string]any{
			"repo": repo, "current": Version, "latest": latest,
			"update_available": cmp > 0,
		}, format, nil)
		return nil
	}
	if cmp <= 0 {
		EmitSuccess(map[string]any{
			"repo": repo, "current": Version, "latest": latest,
			"updated": false, "message": "Already up to date.",
		}, format, nil)
		return nil
	}
	fmt.Fprintf(os.Stderr, "Updating %s: %s -> %s ...\n", repo, Version, latest)
	if err := SelfUpdate(rel); err != nil {
		return err
	}
	EmitSuccess(map[string]any{
		"repo": repo, "previous": Version, "current": latest, "updated": true,
	}, format, nil)
	return nil
}
