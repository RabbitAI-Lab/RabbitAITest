// Package services holds auto-registered service command groups.
//
// To add a new API/service to the CLI, drop ONE .go file into this
// directory (package services) with an init() that calls
// cli.RegisterService — no router edits, no other wiring. The file is
// compiled and registered automatically on the next build, because
// cmd/rabbitcli/main.go blank-imports this package.
//
// Organization is up to you:
//   - one file per service (billing.go, users.go)          — recommended
//   - one file per endpoint if the service is large (billing_invoices.go)
//
// Nested subdirectories (internal/services/foo/) are separate Go
// packages; if you use them, add one blank import line below.
package services

// Blank imports for nested service packages, e.g.:
// _ "github.com/RabbitAI-Lab/RabbitCLI-Bootstrap/internal/services/foo"
