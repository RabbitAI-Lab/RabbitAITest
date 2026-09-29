// .env.local support: user-specific variables (e.g. tokens) live outside
// the config file, in a git-ignorable dotenv file.
//
// Load order (later sources do NOT override earlier ones):
//  1. real process environment variables (highest priority, never overridden)
//  2. ./.env.local          (current working directory)
//  3. <config-dir>/.env.local
//
// Recognized variables: RABBITCLI_TOKEN, RABBITCLI_BASE_URL, RABBITCLI_ENV,
// RABBITCLI_CONFIG_DIR, RABBITCLI_LOG_DIR, RABBITCLI_LOG_LEVEL,
// RABBITCLI_LOG_MAX_SIZE — plus any custom ones the user's own code reads.
package cli

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"
)

// LoadDotenv loads .env.local from the working directory and the config dir.
// Existing environment variables always win; dotenv only fills gaps.
func LoadDotenv() {
	paths := []string{}
	if cwd, err := os.Getwd(); err == nil {
		paths = append(paths, filepath.Join(cwd, ".env.local"))
	}
	paths = append(paths, filepath.Join(ConfigDir(), ".env.local"))
	for _, p := range paths {
		loadDotenvFile(p)
	}
}

func loadDotenvFile(path string) {
	f, err := os.Open(path)
	if err != nil {
		return // missing file is fine
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		// Strip matching quotes
		if len(value) >= 2 {
			if (value[0] == '"' && value[len(value)-1] == '"') || (value[0] == '\'' && value[len(value)-1] == '\'') {
				value = value[1 : len(value)-1]
			}
		}
		if key == "" {
			continue
		}
		if _, exists := os.LookupEnv(key); !exists {
			os.Setenv(key, value)
		}
	}
}
