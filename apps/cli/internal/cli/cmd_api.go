package cli

import (
	"fmt"
)

const apiHelp = `Usage: rabbitcli api <METHOD> <PATH> [flags]

Raw API call against the configured base URL (see ` + "`rabbitcli config init`" + `).

Flags:
  --params '{"k":"v"}'   Query parameters (JSON object)
  --data '{"k":"v"}'     Request body (JSON)
  --page-all             Auto-paginate via cursor (next_cursor / next_page_token)
  --page-limit N         Max pages when using --page-all
  --page-delay MS        Delay between page requests
  --dry-run              Print the request without sending it
  --format json|pretty|table|ndjson|csv

Example:
  rabbitcli api GET /v1/users --params '{"limit":10}'
  rabbitcli api POST /v1/users --data '{"name":"Ada"}' --dry-run`

// RunAPI implements the raw API command.
func RunAPI(a *Args) error {
	format, err := a.OutputFormat()
	if err != nil {
		return err
	}
	if a.Bool("help") || len(a.Pos) < 2 {
		fmt.Println(apiHelp)
		return nil
	}
	params := map[string]string{}
	if p, err := a.JSONFlag("params"); err != nil {
		return err
	} else if p != nil {
		m, ok := p.(map[string]any)
		if !ok {
			return usageError("--params must be a JSON object", "")
		}
		for k, v := range m {
			params[k] = fmt.Sprintf("%v", v)
		}
	}
	data, err := a.JSONFlag("data")
	if err != nil {
		return err
	}
	pageLimit, _, err := a.Int("page-limit")
	if err != nil {
		return err
	}
	pageDelay, _, err := a.Int("page-delay")
	if err != nil {
		return err
	}
	result, err := Request(RequestOpts{
		Method:    a.Pos[0],
		Path:      a.Pos[1],
		Params:    params,
		Data:      data,
		DryRun:    a.Bool("dry-run"),
		PageAll:   a.Bool("page-all"),
		PageLimit: pageLimit,
		PageDelay: pageDelay,
	})
	if err != nil {
		return err
	}
	EmitSuccess(result, format, nil)
	return nil
}
