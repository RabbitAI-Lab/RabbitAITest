// Terminal output sanitization: strings coming from external APIs may
// contain ANSI escape sequences or control characters (terminal injection).
// All data emitted via EmitSuccess is sanitized first; the output contract
// (JSON structure) is preserved.
package cli

import (
	"strings"
	"unicode/utf8"
)

// SanitizeString strips control characters from s, keeping printable
// characters plus \n and \t. ESC-terminated ANSI sequences are removed whole.
func SanitizeString(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for i := 0; i < len(s); {
		c := s[i]
		if c == 0x1b { // ESC: skip CSI/OSC sequence
			i++
			if i < len(s) && s[i] == '[' { // CSI: ESC [ ... final byte 0x40-0x7E
				for i++; i < len(s); i++ {
					if s[i] >= 0x40 && s[i] <= 0x7e {
						i++
						break
					}
				}
			} else if i < len(s) && s[i] == ']' { // OSC: ESC ] ... terminated by BEL or ESC\
				for i++; i < len(s); i++ {
					if s[i] == 0x07 {
						i++
						break
					}
					if s[i] == 0x1b && i+1 < len(s) && s[i+1] == '\\' {
						i += 2
						break
					}
				}
			} else if i < len(s) { // two-byte escape
				i++
			}
			continue
		}
		if c < 0x20 && c != '\n' && c != '\t' { // other C0 controls
			i++
			continue
		}
		if c == 0x7f { // DEL
			i++
			continue
		}
		r, size := utf8.DecodeRuneInString(s[i:])
		b.WriteRune(r)
		i += size
	}
	return b.String()
}

// Sanitize recursively sanitizes all strings in decoded JSON-like data.
func Sanitize(v any) any {
	switch t := v.(type) {
	case string:
		return SanitizeString(t)
	case map[string]any:
		out := make(map[string]any, len(t))
		for k, val := range t {
			out[SanitizeString(k)] = Sanitize(val)
		}
		return out
	case []any:
		out := make([]any, len(t))
		for i, val := range t {
			out[i] = Sanitize(val)
		}
		return out
	default:
		return v
	}
}
