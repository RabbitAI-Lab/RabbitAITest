// rabbitcli — a generic, agent-friendly bootstrap CLI (static single binary).
//
// Three-layer command system:
//  1. Shortcuts        rabbitcli demo +hello
//  2. Service commands rabbitcli demo items list
//  3. Raw API calls    rabbitcli api GET /v1/items
package main

import (
	"github.com/RabbitAI-Lab/RabbitCLI-Bootstrap/internal/cli"
	// Service command groups self-register via init() in files under
	// internal/services/ — adding a file there requires no other change.
	_ "github.com/RabbitAI-Lab/RabbitCLI-Bootstrap/internal/services"
)

func main() {
	cli.Main()
}
