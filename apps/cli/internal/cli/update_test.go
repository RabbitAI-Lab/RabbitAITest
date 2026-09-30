package cli

import "testing"

func TestCompareVersions(t *testing.T) {
	cases := []struct {
		a, b string
		want int // sign of result
	}{
		{"1.2.0", "1.1.9", 1},
		{"0.1.0", "0.1.0", 0},
		{"0.9.9", "0.10.0", -1},
		{"v1.0.1", "1.0.0", 1},
		{"1.0", "1.0.0", 0},
		{"2.0.0-rc.1", "2.0.0", -1},
	}
	for _, c := range cases {
		got := CompareVersions(c.a, c.b)
		sign := 0
		if got > 0 {
			sign = 1
		} else if got < 0 {
			sign = -1
		}
		if sign != c.want {
			t.Errorf("CompareVersions(%q,%q) sign = %d, want %d", c.a, c.b, sign, c.want)
		}
	}
}
