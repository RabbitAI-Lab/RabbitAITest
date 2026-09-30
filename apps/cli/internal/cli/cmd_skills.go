// Agent skills: SKILL.md documents bundled into the binary via go:embed.
//
//	rabbitcli skills list                  # show bundled skills
//	rabbitcli skills install [--dir PATH]  # install skills into an Agent's skills directory
//	rabbitcli skills update [--dir PATH]   # update only changed skills (hash-compared)
//	rabbitcli skills status [--dir PATH]   # show new/updated/unchanged/missing per skill
//	rabbitcli skills new <name>            # scaffold a new SKILL.md from the template
//
// After upgrading the CLI binary (`rabbitcli update`), run
// `rabbitcli skills update` to refresh the installed skills to the
// versions embedded in the new binary.
package cli

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

//go:embed all:skills
var skillsFS embed.FS

const skillsHelp = `Usage: rabbitcli skills <subcommand>

Agent skills are SKILL.md documents that teach AI Agents how to call this
CLI correctly (commands, safety rules, dry-run habits). They are embedded
in the binary and versioned together with it.

Subcommands:
  list                     List bundled skills
  install [--dir PATH]     Install all skills (default dir: ~/.agents/skills)
  update  [--dir PATH]     Update only skills whose content changed
  status  [--dir PATH]     Show per-skills state: new / outdated / current / locally modified
  new <name>               Scaffold a new skill from the template into ./skills/

Typical flow after a CLI upgrade:
  rabbitcli update && rabbitcli skills update`

func skillNames() ([]string, error) {
	entries, err := skillsFS.ReadDir("skills")
	if err != nil {
		return nil, err
	}
	var names []string
	for _, e := range entries {
		if e.IsDir() && !strings.HasPrefix(e.Name(), "_") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	return names, nil
}

func skillHash(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:8])
}

// skillState compares the embedded skill with the installed copy.
// Returns: new | current | outdated (we are newer) | modified (local edits differ
// from last install AND from embedded — updated by us before), missing-dir.
func skillState(name, dir string, embedded []byte) string {
	dst := filepath.Join(dir, name, "SKILL.md")
	installed, err := os.ReadFile(dst)
	if err != nil {
		return "new"
	}
	if skillHash(installed) == skillHash(embedded) {
		return "current"
	}
	// Installed copy differs from embedded. If the installed copy carries our
	// marker hash from a previous install we can safely update it; otherwise
	// the user edited it locally.
	marker := filepath.Join(dir, name, ".installed-sha256")
	if m, err := os.ReadFile(marker); err == nil && strings.TrimSpace(string(m)) == skillHash(installed) {
		return "outdated"
	}
	if _, err := os.Stat(marker); os.IsNotExist(err) {
		// Never installed by us (no marker) -> treat plain diff as outdated.
		return "outdated"
	}
	return "modified"
}

func skillsDir(a *Args) string {
	if d := a.Str("dir"); d != "" {
		return d
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".agents", "skills")
}

func writeSkill(dir, name string, content []byte) error {
	dst := filepath.Join(dir, name, "SKILL.md")
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(dst, content, 0o644); err != nil {
		return err
	}
	// Marker records what we installed, so update can detect local edits.
	return os.WriteFile(filepath.Join(dir, name, ".installed-sha256"), []byte(skillHash(content)), 0o644)
}

// RunSkills implements the skills command group.
func RunSkills(a *Args) error {
	format, err := a.OutputFormat()
	if err != nil {
		return err
	}
	if a.Bool("help") || len(a.Pos) == 0 {
		fmt.Println(skillsHelp)
		return nil
	}
	sub := a.Pos[0]

	switch sub {
	case "list":
		names, err := skillNames()
		if err != nil {
			return err
		}
		rows := make([]any, 0, len(names))
		for _, n := range names {
			b, _ := skillsFS.ReadFile("skills/" + n + "/SKILL.md")
			rows = append(rows, map[string]any{
				"name": n, "description": skillDescription(string(b)),
				"bytes": len(b), "sha256": skillHash(b),
			})
		}
		EmitSuccess(rows, format, map[string]any{"count": len(names)})

	case "install", "update", "status":
		dir := skillsDir(a)
		names, err := skillNames()
		if err != nil {
			return err
		}
		rows := make([]any, 0, len(names))
		changed := 0
		for _, n := range names {
			b, err := skillsFS.ReadFile("skills/" + n + "/SKILL.md")
			if err != nil {
				return err
			}
			state := skillState(n, dir, b)
			action := "skip"
			switch sub {
			case "install":
				if sub == "install" && state != "current" {
					if state == "modified" {
						action = "skip-local-modified"
					} else if err := writeSkill(dir, n, b); err != nil {
						return err
					} else {
						action = "installed"
						changed++
					}
				}
			case "update":
				if state == "outdated" || state == "new" {
					if err := writeSkill(dir, n, b); err != nil {
						return err
					}
					action = "updated"
					changed++
				} else if state == "modified" {
					action = "skip-local-modified"
				}
			}
			rows = append(rows, map[string]any{"name": n, "state": state, "action": action})
		}
		meta := map[string]any{"dir": dir}
		if sub != "status" {
			meta["changed"] = changed
		}
		EmitSuccess(rows, format, meta)

	case "new":
		if len(a.Pos) < 2 {
			return usageError("skills new requires <name>", skillsHelp)
		}
		name := a.Pos[1]
		if strings.HasPrefix(name, "_") || strings.ContainsAny(name, "/\\") {
			return usageError(fmt.Sprintf("Invalid skill name %q", name), "Use letters, digits and dashes.")
		}
		tpl, err := skillsFS.ReadFile("skills/_template/SKILL.md")
		if err != nil {
			return err
		}
		content := strings.ReplaceAll(string(tpl), "{{NAME}}", name)
		dst := filepath.Join("skills", name, "SKILL.md")
		if _, err := os.Stat(dst); err == nil {
			return &CliError{Type: "usage", Message: dst + " already exists"}
		}
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(dst, []byte(content), 0o644); err != nil {
			return err
		}
		EmitSuccess(map[string]any{"created": dst, "hint": "Edit it, then move it under internal/cli/skills/ and rebuild to bundle it."}, format, nil)
	default:
		return usageError(fmt.Sprintf("Unknown skills subcommand %q", sub), skillsHelp)
	}
	return nil
}

func skillDescription(content string) string {
	for _, line := range strings.Split(content, "\n") {
		if strings.HasPrefix(line, "description:") {
			return strings.TrimSpace(strings.TrimPrefix(line, "description:"))
		}
	}
	return ""
}
