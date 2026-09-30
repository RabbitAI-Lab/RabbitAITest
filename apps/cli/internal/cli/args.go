package cli

import (
	"fmt"
	"strconv"
	"strings"
)

// Args holds parsed flags and positional arguments.
type Args struct {
	Flags map[string]string
	Pos   []string
}

// boolFlags never consume the next token as a value.
var boolFlags = map[string]bool{
	"dry-run": true, "page-all": true, "help": true, "h": true,
	"check": true, "verbose": true, "debug": true, "no-wait": true,
	// RabbitAITest CLI-001：--wait（执行后等待终态）为开关旗标——否则会误吃下一个位置参数
	"wait": true,
}

// ParseArgs parses flags in any position: --k=v, --k v, -h.
func ParseArgs(argv []string) (*Args, error) {
	a := &Args{Flags: map[string]string{}}
	for i := 0; i < len(argv); i++ {
		tok := argv[i]
		if tok == "--" {
			a.Pos = append(a.Pos, argv[i+1:]...)
			break
		}
		if strings.HasPrefix(tok, "--") || (strings.HasPrefix(tok, "-") && len(tok) == 2) {
			name := strings.TrimLeft(tok, "-")
			if idx := strings.Index(name, "="); idx >= 0 {
				a.Flags[name[:idx]] = name[idx+1:]
				continue
			}
			if boolFlags[name] {
				a.Flags[name] = "true"
				continue
			}
			if i+1 < len(argv) {
				a.Flags[name] = argv[i+1]
				i++
				continue
			}
			return nil, usageError(fmt.Sprintf("flag --%s requires a value", name), "Run with --help to see usage.")
		}
		a.Pos = append(a.Pos, tok)
	}
	return a, nil
}

func (a *Args) Bool(name string) bool {
	return a.Flags[name] == "true"
}

func (a *Args) Str(name string) string { return a.Flags[name] }

func (a *Args) Int(name string) (int, bool, error) {
	v, ok := a.Flags[name]
	if !ok {
		return 0, false, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 0 {
		return 0, true, usageError(fmt.Sprintf("--%s must be a non-negative integer, got %q", name, v), "")
	}
	return n, true, nil
}

// JSONFlag parses a JSON flag value into any.
func (a *Args) JSONFlag(name string) (any, error) {
	v, ok := a.Flags[name]
	if !ok {
		return nil, nil
	}
	var out any
	if err := jsonUnmarshal([]byte(v), &out); err != nil {
		return nil, usageError(fmt.Sprintf("--%s must be valid JSON", name), "")
	}
	return out, nil
}

// OutputFormat validates --format.
func (a *Args) OutputFormat() (string, error) {
	f := a.Flags["format"]
	if f == "" {
		f = "json"
	}
	switch f {
	case "json", "pretty", "table", "ndjson", "csv":
		return f, nil
	}
	return "", usageError(fmt.Sprintf("Unknown format %q", f), "Use one of: json, pretty, table, ndjson, csv.")
}
