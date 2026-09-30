// Minimal HTTP client for raw API calls: auth, pagination, dry-run.
package cli

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// RequestOpts describes a raw API request.
type RequestOpts struct {
	Method    string
	Path      string // absolute URL or path relative to config baseUrl
	Params    map[string]string
	Data      any
	DryRun    bool
	PageAll   bool
	PageLimit int // max pages when PageAll (default 100)
	PageDelay int // ms between page requests
}

// Request executes the API call and returns the decoded JSON body.
//
// RabbitAITest extensions (CLI-001, upstreamable):
//   - on 401, if a refresh_token exists, automatically rotate once and retry the original request
//   - platform envelope {code,message}: lift business message into the error Message
//   - --page-all supports both the cursor protocol (next_cursor/has_more) and the page-number protocol (page/size + total)
func Request(opts RequestOpts) (any, error) {
	cfg, err := EffectiveConfig()
	if err != nil {
		return nil, err
	}
	base, _ := cfg["baseUrl"].(string)
	if base == "" {
		base = "http://localhost"
	}
	u, err := url.Parse(opts.Path)
	if err != nil {
		return nil, usageError("Invalid path: "+opts.Path, "")
	}
	if !u.IsAbs() {
		u, err = url.Parse(strings.TrimRight(base, "/") + "/" + strings.TrimLeft(opts.Path, "/"))
		if err != nil {
			return nil, usageError("Invalid path: "+opts.Path, "")
		}
	}
	q := u.Query()
	for k, v := range opts.Params {
		if v == "" {
			continue // 空旗标值不进 query（?page=&size= 会被服务端 coerce 校验拒绝）
		}
		q.Set(k, v)
	}
	u.RawQuery = q.Encode()

	headers := map[string]string{"content-type": "application/json"}
	if token, _ := cfg["token"].(string); token != "" {
		headers["authorization"] = "Bearer " + token
	}
	method := strings.ToUpper(opts.Method)

	if opts.DryRun {
		return map[string]any{
			"dry_run": true,
			"request": map[string]any{
				"method": method, "url": u.String(), "headers": headers, "body": opts.Data,
			},
		}, nil
	}

	maxPages := 1
	if opts.PageAll {
		maxPages = opts.PageLimit
		if maxPages == 0 {
			maxPages = 100
		}
	}

	client := &http.Client{Timeout: 30 * time.Second}
	var lastBody any
	var items []any
	gotItems := false
	refreshed := false

	for page := 0; page < maxPages; page++ {
		var bodyReader io.Reader
		if opts.Data != nil {
			b, _ := json.Marshal(opts.Data)
			bodyReader = bytes.NewReader(b)
		}
		req, err := http.NewRequest(method, u.String(), bodyReader)
		if err != nil {
			return nil, err
		}
		for k, v := range headers {
			req.Header.Set(k, v)
		}
		t0 := time.Now()
		res, err := client.Do(req)
		elapsed := time.Since(t0)
		if err != nil {
			LogRequest(method, u.String(), 0, elapsed, err)
			return nil, &CliError{
				Type:    "network",
				Message: err.Error(),
				Hint:    "Check baseUrl (`rabbit config show`) and your network connection.",
			}
		}
		b, _ := io.ReadAll(res.Body)
		res.Body.Close()
		LogRequest(method, u.String(), res.StatusCode, elapsed, nil)

		// 401 + refresh_token exists: automatically rotate once and retry the original request
		if res.StatusCode == 401 && !refreshed && headers["authorization"] != "" {
			if nt, ok := tryRefreshToken(); ok {
				refreshed = true
				headers["authorization"] = "Bearer " + nt
				page-- // redo this page
				continue
			}
		}

		var body any
		if err := json.Unmarshal(b, &body); err != nil {
			body = string(b)
		}
		if res.StatusCode >= 400 {
			hint := ""
			if s, ok := body.(string); ok {
				hint = s
			} else {
				hb, _ := json.Marshal(body)
				hint = string(hb)
			}
			message := fmt.Sprintf("HTTP %d %s", res.StatusCode, http.StatusText(res.StatusCode))
			// Platform envelope {code,message}: lift the business message (directly readable by AI)
			if m, ok := body.(map[string]any); ok {
				if msg, _ := m["message"].(string); msg != "" {
					message = msg
					if c, okc := m["code"].(float64); okc {
						hint = strings.TrimSpace(hint + fmt.Sprintf(" (business code %.0f)", c))
					}
				}
			}
			return nil, &CliError{
				Type:    "api",
				Code:    res.StatusCode,
				Message: message,
				Hint:    hint,
			}
		}
		lastBody = body

		// Generic cursor pagination: next_cursor / next_page_token / has_more
		if !opts.PageAll {
			break
		}
		m, ok := body.(map[string]any)
		if !ok {
			break
		}
		var pageArr []any
		if arr, ok := m["items"].([]any); ok {
			pageArr = arr
			items = append(items, arr...)
			gotItems = true
		} else if arr, ok := m["data"].([]any); ok {
			pageArr = arr
			items = append(items, arr...)
			gotItems = true
		}
		next, _ := m["next_cursor"].(string)
		if next == "" {
			next, _ = m["next_page_token"].(string)
		}
		if next == "" {
			next, _ = m["cursor"].(string)
		}
		hasMore, _ := m["has_more"].(bool)
		if next != "" && (hasMore || m["has_more"] == nil) {
			q := u.Query()
			q.Set("cursor", next)
			u.RawQuery = q.Encode()
			if opts.PageDelay > 0 {
				time.Sleep(time.Duration(opts.PageDelay) * time.Millisecond)
			}
			continue
		}
		// Page-number protocol: page/size + total —— page not full or accumulated >= total means last page
		// (only when the response carries no cursor keys at all, to prevent cursor-type APIs from mis-paginating)
		if next == "" {
			if total, ok := m["total"].(float64); ok && gotItems {
				q := u.Query()
				cur := 1
				if v := q.Get("page"); v != "" {
					if n, err := strconv.Atoi(v); err == nil {
						cur = n
					}
				}
				size := 20
				sizeKey := ""
				for _, k := range []string{"size", "pageSize", "page_size"} {
					if v := q.Get(k); v != "" {
						if n, err := strconv.Atoi(v); err == nil {
							size = n
							sizeKey = k
						}
					}
				}
				if sizeKey == "" {
					sizeKey = "size"
				}
				if float64(len(items)) < total && len(pageArr) >= size {
					q.Set("page", strconv.Itoa(cur+1))
					if q.Get(sizeKey) == "" {
						q.Set(sizeKey, strconv.Itoa(size))
					}
					u.RawQuery = q.Encode()
					if opts.PageDelay > 0 {
						time.Sleep(time.Duration(opts.PageDelay) * time.Millisecond)
					}
					continue
				}
			}
		}
		break
	}

	if opts.PageAll && gotItems {
		return items, nil
	}
	return lastBody, nil
}
