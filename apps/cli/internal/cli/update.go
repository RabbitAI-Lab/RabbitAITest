// Self-update: query a GitHub Releases-compatible endpoint for the latest
// version, compare versions, download the matching binary and replace the
// current executable.
package cli

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"runtime"
	"strings"
)

// CompareVersions compares semver-ish versions: >0 if a>b, 0 if equal, <0 if a<b.
func CompareVersions(a, b string) int {
	pa := strings.FieldsFunc(strings.TrimPrefix(a, "v"), func(r rune) bool { return r == '.' || r == '-' })
	pb := strings.FieldsFunc(strings.TrimPrefix(b, "v"), func(r rune) bool { return r == '.' || r == '-' })
	n := len(pa)
	if len(pb) > n {
		n = len(pb)
	}
	for i := 0; i < n; i++ {
		var xa, xb string
		if i < len(pa) {
			xa = pa[i]
		} else {
			xa = "0"
		}
		if i < len(pb) {
			xb = pb[i]
		} else {
			xb = "0"
		}
		var na, nb int
		_, ea := fmt.Sscanf(xa, "%d", &na)
		_, eb := fmt.Sscanf(xb, "%d", &nb)
		if ea == nil && eb == nil {
			if na != nb {
				return na - nb
			}
			continue
		}
		// Semver: a numeric segment outranks a prerelease segment
		// (2.0.0 > 2.0.0-rc.1); both non-numeric -> lexical compare.
		if ea == nil {
			return 1
		}
		if eb == nil {
			return -1
		}
		if xa != xb {
			if xa < xb {
				return -1
			}
			return 1
		}
	}
	return 0
}

type release struct {
	TagName string `json:"tag_name"`
	Assets  []struct {
		Name               string `json:"name"`
		BrowserDownloadURL string `json:"browser_download_url"`
	} `json:"assets"`
}

// FetchLatestRelease queries the GitHub Releases API for owner/repo.
func FetchLatestRelease(repo string) (*release, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/releases/latest", repo)
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Accept", "application/vnd.github+json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, &CliError{Type: "network", Message: err.Error(), Hint: "Check your network connection."}
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		hint := ""
		if res.StatusCode == 404 {
			hint = "Repository or release not found — pass --repo owner/name, or publish a release first."
		}
		return nil, &CliError{Type: "api", Code: res.StatusCode, Message: fmt.Sprintf("GitHub API returned HTTP %d", res.StatusCode), Hint: hint}
	}
	var rel release
	if err := json.NewDecoder(res.Body).Decode(&rel); err != nil {
		return nil, &CliError{Type: "api", Message: "Invalid release response: " + err.Error()}
	}
	if rel.TagName == "" {
		return nil, &CliError{Type: "api", Message: "Release response missing tag_name"}
	}
	return &rel, nil
}

// SelfUpdate downloads the release asset matching GOOS/GOARCH and replaces
// the current executable atomically.
func SelfUpdate(rel *release) error {
	suffix := runtime.GOOS + "-" + runtime.GOARCH
	if runtime.GOOS == "windows" {
		suffix += ".exe"
	}
	downloadURL := ""
	for _, a := range rel.Assets {
		if strings.Contains(a.Name, suffix) {
			downloadURL = a.BrowserDownloadURL
			break
		}
	}
	if downloadURL == "" {
		return &CliError{
			Type:    "api",
			Message: "No release asset matches " + suffix,
			Hint:    "Publish assets named like rabbitcli-linux-amd64, or download manually.",
		}
	}

	res, err := http.Get(downloadURL)
	if err != nil {
		return &CliError{Type: "network", Message: err.Error()}
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return &CliError{Type: "api", Code: res.StatusCode, Message: fmt.Sprintf("Asset download returned HTTP %d", res.StatusCode)}
	}
	b, err := io.ReadAll(res.Body)
	if err != nil {
		return &CliError{Type: "network", Message: err.Error()}
	}

	exe, err := os.Executable()
	if err != nil {
		return err
	}
	// Atomic replace: write temp file in the same directory, then rename.
	tmp := exe + ".new"
	if err := os.WriteFile(tmp, b, 0o755); err != nil {
		return &CliError{Type: "internal", Message: err.Error(), Hint: "Check write permission on the install directory."}
	}
	if err := os.Rename(tmp, exe); err != nil {
		os.Remove(tmp)
		return &CliError{Type: "internal", Message: err.Error(), Hint: "Check write permission on the install directory."}
	}
	return nil
}
