// Service registry: service command groups self-register via init() in
// files under internal/services/. Dropping a new .go file into that
// directory is all it takes — no router edits, no manual wiring.
package cli

import "sort"

// ServiceHandler handles one command group: a.Pos holds the remaining
// positionals (e.g. ["items","list"] or ["+hello"]).
type ServiceHandler func(a *Args) error

// Service is a registered command group.
type Service struct {
	Name        string // command group name, e.g. "billing"
	Description string // one-liner for help/schema
	Handler     ServiceHandler
	Schema      CommandSchema // for `rabbitcli schema <name>`
}

var registry = map[string]*Service{}

// RegisterService adds a service to the registry. Call it from init()
// in a file under internal/services/. Duplicate names panic at startup
// (fail fast at build/dev time, not in production).
func RegisterService(s *Service) {
	if _, dup := registry[s.Name]; dup {
		panic("duplicate service registration: " + s.Name)
	}
	registry[s.Name] = s
}

// GetService returns a registered service or nil.
func GetService(name string) *Service { return registry[name] }

// ListServices returns registered services sorted by name.
func ListServices() []*Service {
	out := make([]*Service, 0, len(registry))
	for _, s := range registry {
		out = append(out, s)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}
