// Logging framework based on the standard library log/slog — zero
// third-party dependencies, still a single static binary.
//
// Logs are written as JSON Lines to daily files:
//
//	<log-dir>/rabbitcli-YYYYMMDD.log
//
// Log directory precedence (mirrors config-dir):
//  1. RABBITCLI_LOG_DIR environment variable
//  2. <config-dir>/logs   (config-dir itself follows --config-dir > RABBITCLI_CONFIG_DIR > ~/.config/rabbitcli)
//
// Level control: --debug > --verbose > RABBITCLI_LOG_LEVEL > default "warn".
// Logs never pollute stdout/stderr: the output contract is unchanged.
// Secrets (authorization tokens) are never logged.
package cli

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const logRetentionDays = 14

var logger *slog.Logger = slog.New(slog.NewTextHandler(ioDiscard{}, nil))

type ioDiscard struct{}

func (ioDiscard) Write(p []byte) (int, error) { return len(p), nil }

// LogDir resolves the effective log directory.
func LogDir() string {
	if d := os.Getenv(EnvVar("LOG_DIR")); d != "" {
		return d
	}
	return filepath.Join(ConfigDir(), "logs")
}

// MaxLogSize returns the per-file size cap in bytes
// (RABBITCLI_LOG_MAX_SIZE, default 10MB).
func MaxLogSize() int64 {
	if v := os.Getenv(EnvVar("LOG_MAX_SIZE")); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil && n > 0 {
			return n
		}
	}
	return 10 * 1024 * 1024
}

// rotateWriter rotates the daily log file by size: when the current file
// exceeds MaxLogSize, it is rolled to rabbitcli-YYYYMMDD.N.log (N = 1, 2, ...).
type rotateWriter struct {
	mu   sync.Mutex
	base string // full path of rabbitcli-YYYYMMDD.log
	seq  int    // current rotation index (0 = base file)
	size int64
	f    *os.File
	max  int64
}

func newRotateWriter(base string, max int64) *rotateWriter {
	w := &rotateWriter{base: base, max: max}
	if err := w.openCurrent(); err != nil {
		return nil
	}
	return w
}

func (w *rotateWriter) openCurrent() error {
	path := w.base
	if w.seq > 0 {
		path = strings.TrimSuffix(w.base, ".log") + fmt.Sprintf(".%d.log", w.seq)
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	if fi, err := f.Stat(); err == nil {
		w.size = fi.Size()
	}
	w.f = f
	return nil
}

func (w *rotateWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.size+int64(len(p)) > w.max && w.size > 0 {
		w.f.Close()
		w.seq++
		w.size = 0
		if err := w.openCurrent(); err != nil {
			return len(p), nil // logging must never break the CLI
		}
	}
	n, err := w.f.Write(p)
	w.size += int64(n)
	return n, err
}

// InitLogging opens today's log file and installs the global logger.
// level: "debug" | "info" | "warn" | "error". Errors are non-fatal:
// logging must never break the CLI itself.
func InitLogging(level string) {
	lv := slog.LevelWarn
	switch strings.ToLower(level) {
	case "debug":
		lv = slog.LevelDebug
	case "info":
		lv = slog.LevelInfo
	case "error":
		lv = slog.LevelError
	}
	if err := os.MkdirAll(LogDir(), 0o700); err != nil {
		return
	}
	base := filepath.Join(LogDir(), fmt.Sprintf("%s-%s.log", Name, time.Now().Format("20060102")))
	w := newRotateWriter(base, MaxLogSize())
	if w == nil {
		return
	}
	logger = slog.New(slog.NewJSONHandler(w, &slog.HandlerOptions{Level: lv}))
	cleanOldLogs()
}

// ResolveLogLevel implements: --debug > --verbose > RABBITCLI_LOG_LEVEL > warn.
func ResolveLogLevel(a *Args) string {
	if a.Bool("debug") {
		return "debug"
	}
	if a.Bool("verbose") {
		return "info"
	}
	if v := os.Getenv(EnvVar("LOG_LEVEL")); v != "" {
		return v
	}
	return "warn"
}

// Log emits a log record with the given attributes (no-op at low levels).
func Log(ctx context.Context, level slog.Level, msg string, attrs ...any) {
	logger.Log(ctx, level, msg, attrs...)
}

// LogRequest records an HTTP call with the token redacted.
func LogRequest(method, rawURL string, status int, elapsed time.Duration, err error) {
	safe := redactURL(rawURL)
	attrs := []any{"method", method, "url", safe, "status", status, "elapsed_ms", elapsed.Milliseconds()}
	if err != nil {
		attrs = append(attrs, "error", err.Error())
		Log(context.Background(), slog.LevelWarn, "http request failed", attrs...)
		return
	}
	Log(context.Background(), slog.LevelDebug, "http request", attrs...)
}

// redactURL strips sensitive query values (token/key/secret) from a URL for logging.
func redactURL(rawURL string) string {
	i := strings.Index(rawURL, "?")
	if i < 0 {
		return rawURL
	}
	base, query := rawURL[:i], rawURL[i+1:]
	parts := strings.Split(query, "&")
	for j, p := range parts {
		k := strings.ToLower(p)
		if idx := strings.Index(p, "="); idx >= 0 {
			k = strings.ToLower(p[:idx])
		}
		if strings.Contains(k, "token") || strings.Contains(k, "secret") || strings.Contains(k, "key") {
			if idx := strings.Index(p, "="); idx >= 0 {
				parts[j] = p[:idx+1] + "***"
			}
		}
	}
	return base + "?" + strings.Join(parts, "&")
}

// cleanOldLogs removes log files older than the retention window (best effort).
func cleanOldLogs() {
	entries, err := os.ReadDir(LogDir())
	if err != nil {
		return
	}
	cutoff := time.Now().AddDate(0, 0, -logRetentionDays)
	for _, e := range entries {
		name := e.Name()
		if !strings.HasPrefix(name, Name+"-") || !strings.HasSuffix(name, ".log") {
			continue
		}
		// name forms: rabbitcli-YYYYMMDD.log, rabbitcli-YYYYMMDD.N.log
		stem := strings.TrimSuffix(strings.TrimPrefix(name, Name+"-"), ".log")
		datePart, _, _ := strings.Cut(stem, ".")
		t, err := time.Parse("20060102", datePart)
		if err == nil && t.Before(cutoff) {
			os.Remove(filepath.Join(LogDir(), name))
		}
	}
}
