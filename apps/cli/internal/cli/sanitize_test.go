package cli

import "testing"

func TestSanitizeString(t *testing.T) {
	cases := []struct{ in, want string }{
		{"plain text", "plain text"},
		{"\x1b[31mred\x1b[0m", "red"},                     // ANSI color
		{"\x1b]8;;https://evil\x07link\x1b]8;;\x07", "link"}, // OSC hyperlink
		{"a\x00b\x07c\x7f", "abc"},                        // C0 controls + DEL
		{"keep\nnewline\tand tab", "keep\nnewline\tand tab"},
		{"中文 unaffected", "中文 unaffected"},
	}
	for _, c := range cases {
		if got := SanitizeString(c.in); got != c.want {
			t.Errorf("SanitizeString(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestSanitizeRecursive(t *testing.T) {
	in := map[string]any{
		"items": []any{"\x1b[1m bold", map[string]any{"k\x1b[2m": "v"}},
		"n":     42.0,
	}
	out := Sanitize(in).(map[string]any)
	items := out["items"].([]any)
	if items[0] != " bold" {
		t.Errorf("nested string not sanitized: %q", items[0])
	}
	m := items[1].(map[string]any)
	if _, ok := m["k"]; !ok {
		t.Errorf("map key not sanitized: %v", m)
	}
	if out["n"] != 42.0 {
		t.Errorf("non-string value altered: %v", out["n"])
	}
}
