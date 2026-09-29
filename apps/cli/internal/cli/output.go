// Package cli implements the rabbitcli bootstrap CLI: output contract, config,
// HTTP client, self-update and the command groups.
//
// Output contract:
//
//	Success -> stdout, exit code 0:  {"ok":true,"data":...,"meta":{...}}
//	Error   -> stderr, exit !=0:     {"ok":false,"error":{...}}
//
// Check success via ok==true (or the exit code), never via code==0.
package cli

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
)

// CliError carries a structured error envelope.
type CliError struct {
	Type    string `json:"type"` // api | config | usage | network | internal
	Subtype string `json:"subtype,omitempty"`
	Code    int    `json:"code,omitempty"`
	Message string `json:"message"`
	Hint    string `json:"hint,omitempty"`
}

func (e *CliError) Error() string { return e.Message }

func usageError(msg, hint string) *CliError {
	return &CliError{Type: "usage", Message: msg, Hint: hint}
}

// NewUsageError is the exported form of usageError for use by the services package (CLI-001).
func NewUsageError(msg, hint string) *CliError { return usageError(msg, hint) }

type successEnvelope struct {
	OK   bool           `json:"ok"`
	Data any            `json:"data"`
	Meta map[string]any `json:"meta,omitempty"`
}

type errorEnvelope struct {
	OK    bool      `json:"ok"`
	Error *CliError `json:"error"`
}

// EmitSuccess writes data to stdout in the requested format.
// Data is sanitized first: terminal escape sequences from upstream
// APIs are stripped (structure preserved).
func EmitSuccess(data any, format string, meta map[string]any) {
	data = Sanitize(data)
	switch format {
	case "pretty":
		if s, ok := data.(string); ok {
			fmt.Println(s)
		} else {
			b, _ := json.MarshalIndent(data, "", "  ")
			fmt.Println(string(b))
		}
	case "table":
		fmt.Println(RenderTable(data))
	case "ndjson":
		for _, item := range toRows(data) {
			b, _ := json.Marshal(item)
			fmt.Println(string(b))
		}
	case "csv":
		fmt.Println(RenderCSV(data))
	default: // json
		b, _ := json.MarshalIndent(successEnvelope{OK: true, Data: data, Meta: meta}, "", "  ")
		fmt.Println(string(b))
	}
}

// EmitError writes a structured error to stderr and exits.
func EmitError(err error) {
	ce, ok := err.(*CliError)
	if !ok {
		ce = &CliError{Type: "internal", Message: err.Error()}
	}
	b, _ := json.MarshalIndent(errorEnvelope{OK: false, Error: ce}, "", "  ")
	fmt.Fprintln(os.Stderr, string(b))
	if ce.Type == "usage" {
		os.Exit(2)
	}
	os.Exit(1)
}

func toRows(data any) []map[string]any {
	switch v := data.(type) {
	case []any:
		rows := make([]map[string]any, 0, len(v))
		for _, item := range v {
			if m, ok := item.(map[string]any); ok {
				rows = append(rows, m)
			} else {
				rows = append(rows, map[string]any{"value": item})
			}
		}
		return rows
	case map[string]any:
		return []map[string]any{v}
	default:
		return []map[string]any{{"value": v}}
	}
}

func cell(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return t
	case float64, bool:
		return fmt.Sprintf("%v", t)
	default:
		b, _ := json.Marshal(t)
		return string(b)
	}
}

func columns(rows []map[string]any) []string {
	seen := map[string]bool{}
	var cols []string
	for _, r := range rows {
		keys := make([]string, 0, len(r))
		for k := range r {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			if !seen[k] {
				seen[k] = true
				cols = append(cols, k)
			}
		}
	}
	return cols
}

// RenderTable renders data as an aligned plain-text table.
func RenderTable(data any) string {
	rows := toRows(data)
	cols := columns(rows)
	widths := make([]int, len(cols))
	for i, c := range cols {
		widths[i] = len(c)
	}
	for _, r := range rows {
		for i, c := range cols {
			if l := len(cell(r[c])); l > widths[i] {
				widths[i] = l
			}
		}
	}
	line := func(cells []string) string {
		parts := make([]string, len(cells))
		for i, c := range cells {
			parts[i] = c + strings.Repeat(" ", widths[i]-len(c))
		}
		return strings.TrimRight(strings.Join(parts, "  "), " ")
	}
	var out []string
	out = append(out, line(cols))
	dashes := make([]string, len(cols))
	for i, w := range widths {
		dashes[i] = strings.Repeat("-", w)
	}
	out = append(out, line(dashes))
	for _, r := range rows {
		cells := make([]string, len(cols))
		for i, c := range cols {
			cells[i] = cell(r[c])
		}
		out = append(out, line(cells))
	}
	return strings.Join(out, "\n")
}

// RenderCSV renders data as CSV.
func RenderCSV(data any) string {
	rows := toRows(data)
	cols := columns(rows)
	esc := func(s string) string {
		if strings.ContainsAny(s, "\",\n") {
			return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
		}
		return s
	}
	var out []string
	head := make([]string, len(cols))
	for i, c := range cols {
		head[i] = esc(c)
	}
	out = append(out, strings.Join(head, ","))
	for _, r := range rows {
		cells := make([]string, len(cols))
		for i, c := range cols {
			cells[i] = esc(cell(r[c]))
		}
		out = append(out, strings.Join(cells, ","))
	}
	return strings.Join(out, "\n")
}
