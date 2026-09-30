// rabbit.go — RabbitAITest 平台服务命令（CLI-001 P1）。
// 三层命令体系：Shortcuts（+ 前缀高频组合）→ 资源命令（域资源 1:1）→ raw api 兜底（脚手架内置）。
// 路径一律引用 apidef 生成常量（门禁 4 Go 侧：禁止手写接口路径）。
package services

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/RabbitAI-Lab/RabbitCLI-Bootstrap/internal/cli"
	"github.com/RabbitAI-Lab/RabbitCLI-Bootstrap/internal/services/apidef"
)

const rabbitHelp = `Usage: rabbit <group> <command> [flags]

Shortcuts（AI 高频组合）:
  +run api-case <id> [--env ENV] [--wait]   默认环境→执行→等待→终态摘要
  +run scenario <id> [--env ENV]            同上（场景）
  +run plan <id>                            执行测试计划
  +report <taskId>                          报告摘要（open/exec 端点，跨项目）

Resource commands（--project 旗标或 config 键 project 提供项目上下文）:
  project ls / project use <id>
  case ls|get|create|update|rm              功能用例
  api ls / api cases <apiId>                接口定义与接口用例
  api-case run <apiId> <caseId> [--env ENV] 触发接口用例执行（→taskId）
  scenario ls / scenario run <id> [--env ENV]
  plan ls / plan get <id> / plan run <id>
  env ls                                    环境（envId 发现）
  task get <taskId> / task wait <taskId> [--timeout 300] / task stop <taskId>
  report get <taskId>

Flags: --format json|pretty|table|ndjson|csv, --page-all, --dry-run, --project <id>

Auth: rabbit auth login（Device Flow）——判断成功看 ok==true；data 为平台信封原样。`

// unwrap 平台信封：取 data.data（信封内层）；无信封结构时原样返回。
func unwrap(body any) any {
	if m, ok := body.(map[string]any); ok {
		if d, exists := m["data"]; exists {
			return d
		}
	}
	return body
}

// projectId 解析项目上下文：--project 旗标 > config 键 project。
func projectId(a *cli.Args) (string, *cli.CliError) {
	if id := a.Str("project"); id != "" {
		return id, nil
	}
	cfg, err := cli.LoadConfig()
	if err != nil {
		return "", &cli.CliError{Type: "config", Message: err.Error()}
	}
	if id, _ := cfg["project"].(string); id != "" {
		return id, nil
	}
	return "", cli.NewUsageError("--project <id> 未提供且 config 键 project 未设置",
		"先运行 rabbit project use <id>（或每条命令带 --project）")
}

func path(tpl, id string) string { return strings.ReplaceAll(tpl, "{projectId}", id) }

func init() {
	cli.RegisterService(&cli.Service{
		Name:        "rabbit",
		Description: "RabbitAITest 平台资源与执行（case/api/scenario/plan/env/task/report）",
		Handler:     runRabbit,
		Schema: cli.CommandSchema{
			Name:        "rabbit",
			Description: "RabbitAITest 平台资源与执行",
			Usage:       "rabbit <group> <command>",
			Subcommands: []string{
				"+run api-case <id>", "+run scenario <id>", "+run plan <id>", "+report <taskId>",
				"project ls", "project use <id>",
				"case ls|get|create|update|rm", "api ls", "api cases <apiId>", "api-case run",
				"scenario ls|run", "plan ls|get|run", "env ls",
				"task get|wait|stop", "report get",
			},
			Examples: []string{
				"rabbit +run api-case 6f1c… --env 8a2b…",
				"rabbit case ls --page-all --format table",
				"rabbit task wait <taskId> --timeout 300",
			},
		},
	})
}

func runRabbit(a *cli.Args) error {
	format, err := a.OutputFormat()
	if err != nil {
		return err
	}
	if a.Bool("help") || len(a.Pos) == 0 {
		fmt.Println(rabbitHelp)
		return nil
	}
	group := a.Pos[0]

	switch group {
	// ── Shortcuts ──
	case "+run":
		return shortcutRun(a, format)
	case "+report":
		if len(a.Pos) < 2 {
			return cli.NewUsageError("+report 需要 <taskId>", rabbitHelp)
		}
		body, err := cli.Request(cli.RequestOpts{Method: "GET", Path: apidef.GET_open_exec_taskId_report, Params: map[string]string{"taskId": a.Pos[1]}, DryRun: a.Bool("dry-run")})
		if err != nil {
			return err
		}
		cli.EmitSuccess(unwrap(body), format, nil)
		return nil

	// ── project ──
	case "project":
		if len(a.Pos) >= 2 && a.Pos[1] == "ls" {
			body, err := cli.Request(cli.RequestOpts{Method: "GET", Path: apidef.GET_personal_projects, DryRun: a.Bool("dry-run")})
			if err != nil {
				return err
			}
			cli.EmitSuccess(unwrap(body), format, nil)
			return nil
		}
		if len(a.Pos) >= 3 && a.Pos[1] == "use" {
			cfg, err := cli.LoadConfig()
			if err != nil {
				return err
			}
			cfg["project"] = a.Pos[2]
			if err := cli.SaveConfig(cfg); err != nil {
				return err
			}
			cli.EmitSuccess(map[string]any{"project": a.Pos[2]}, format, nil)
			return nil
		}
		return cli.NewUsageError("project ls | project use <id>", rabbitHelp)

	// ── case（功能用例）──
	case "case":
		if len(a.Pos) < 2 {
			return cli.NewUsageError("case ls|get|create|update|rm", rabbitHelp)
		}
		pid, cerr := projectId(a)
		if cerr != nil {
			return cerr
		}
		sub := a.Pos[1]
		params := map[string]string{"page": a.Str("page"), "size": a.Str("size")}
		switch {
		case sub == "ls":
			body, err := cli.Request(cli.RequestOpts{Method: "GET", Path: path(apidef.GET_projects_projectId_cases, pid), Params: params, DryRun: a.Bool("dry-run"), PageAll: a.Bool("page-all")})
			if err != nil {
				return err
			}
			cli.EmitSuccess(unwrap(body), format, nil)
			return nil
		case sub == "get" && len(a.Pos) >= 3:
			p := strings.ReplaceAll(apidef.GET_projects_projectId_cases_caseId, "{caseId}", a.Pos[2])
			body, err := cli.Request(cli.RequestOpts{Method: "GET", Path: path(p, pid), DryRun: a.Bool("dry-run")})
			if err != nil {
				return err
			}
			cli.EmitSuccess(unwrap(body), format, nil)
			return nil
		case (sub == "create" || sub == "update") && len(a.Pos) >= 3:
			payload, err := readPayload(a)
			if err != nil {
				return err
			}
			method, p := "POST", apidef.POST_projects_projectId_cases
			if sub == "update" {
				method, p = "PUT", strings.ReplaceAll(apidef.PUT_projects_projectId_cases_caseId, "{caseId}", a.Pos[2])
			}
			body, err := cli.Request(cli.RequestOpts{Method: method, Path: path(p, pid), Data: payload, DryRun: a.Bool("dry-run")})
			if err != nil {
				return err
			}
			cli.EmitSuccess(unwrap(body), format, nil)
			return nil
		case sub == "rm" && len(a.Pos) >= 3:
			p := strings.ReplaceAll(apidef.DELETE_projects_projectId_cases_caseId, "{caseId}", a.Pos[2])
			body, err := cli.Request(cli.RequestOpts{Method: "DELETE", Path: path(p, pid), DryRun: a.Bool("dry-run")})
			if err != nil {
				return err
			}
			cli.EmitSuccess(unwrap(body), format, nil)
			return nil
		}
		return cli.NewUsageError("case ls|get|create --file|update <id> --file|rm <id>", rabbitHelp)

	// ── api（接口定义/接口用例）──
	case "api":
		if len(a.Pos) < 2 {
			return cli.NewUsageError("api ls | api cases <apiId> | api-case run", rabbitHelp)
		}
		pid, cerr := projectId(a)
		if cerr != nil {
			return cerr
		}
		switch {
		case a.Pos[1] == "ls":
			body, err := cli.Request(cli.RequestOpts{Method: "GET", Path: path(apidef.GET_projects_projectId_apis, pid), Params: map[string]string{"page": a.Str("page"), "size": a.Str("size")}, DryRun: a.Bool("dry-run"), PageAll: a.Bool("page-all")})
			if err != nil {
				return err
			}
			cli.EmitSuccess(unwrap(body), format, nil)
			return nil
		case a.Pos[1] == "cases" && len(a.Pos) >= 3:
			p := strings.ReplaceAll(apidef.GET_projects_projectId_apis_apiId_cases, "{apiId}", a.Pos[2])
			body, err := cli.Request(cli.RequestOpts{Method: "GET", Path: path(p, pid), DryRun: a.Bool("dry-run")})
			if err != nil {
				return err
			}
			cli.EmitSuccess(unwrap(body), format, nil)
			return nil
		}
		return cli.NewUsageError("api ls | api cases <apiId>", rabbitHelp)

	case "api-case":
		if len(a.Pos) >= 4 && a.Pos[1] == "run" {
			pid, cerr := projectId(a)
			if cerr != nil {
				return cerr
			}
			p := strings.ReplaceAll(apidef.POST_projects_projectId_apis_apiId_cases_execute, "{apiId}", a.Pos[2])
			payload := map[string]any{"caseIds": []string{a.Pos[3]}}
			if env := a.Str("env"); env != "" {
				payload["envId"] = env
			}
			body, err := cli.Request(cli.RequestOpts{Method: "POST", Path: path(p, pid), Data: payload, DryRun: a.Bool("dry-run")})
			if err != nil {
				return err
			}
			cli.EmitSuccess(unwrap(body), format, nil)
			return nil
		}
		return cli.NewUsageError("api-case run <apiId> <caseId> [--env ENV]", rabbitHelp)

	// ── scenario ──
	case "scenario":
		if len(a.Pos) >= 3 && a.Pos[1] == "run" {
			pid, cerr := projectId(a)
			if cerr != nil {
				return cerr
			}
			return execAndMaybeWait(a, format, pid, apidef.POST_projects_projectId_scenarios_id_execute, "{id}", a.Pos[2])
		}
		if len(a.Pos) >= 2 && a.Pos[1] == "ls" {
			pid, cerr := projectId(a)
			if cerr != nil {
				return cerr
			}
			body, err := cli.Request(cli.RequestOpts{Method: "GET", Path: path(apidef.GET_projects_projectId_scenarios, pid), Params: map[string]string{"page": a.Str("page"), "size": a.Str("size")}, DryRun: a.Bool("dry-run"), PageAll: a.Bool("page-all")})
			if err != nil {
				return err
			}
			cli.EmitSuccess(unwrap(body), format, nil)
			return nil
		}
		return cli.NewUsageError("scenario ls | scenario run <id> [--env ENV]", rabbitHelp)

	// ── plan ──
	case "plan":
		if len(a.Pos) < 2 {
			return cli.NewUsageError("plan ls|get|run", rabbitHelp)
		}
		pid, cerr := projectId(a)
		if cerr != nil {
			return cerr
		}
		switch {
		case a.Pos[1] == "ls":
			body, err := cli.Request(cli.RequestOpts{Method: "GET", Path: path(apidef.GET_projects_projectId_plans, pid), Params: map[string]string{"page": a.Str("page"), "size": a.Str("size")}, DryRun: a.Bool("dry-run"), PageAll: a.Bool("page-all")})
			if err != nil {
				return err
			}
			cli.EmitSuccess(unwrap(body), format, nil)
			return nil
		case a.Pos[1] == "get" && len(a.Pos) >= 3:
			p := strings.ReplaceAll(apidef.GET_projects_projectId_plans_planId, "{planId}", a.Pos[2])
			body, err := cli.Request(cli.RequestOpts{Method: "GET", Path: path(p, pid), DryRun: a.Bool("dry-run")})
			if err != nil {
				return err
			}
			cli.EmitSuccess(unwrap(body), format, nil)
			return nil
		case a.Pos[1] == "run" && len(a.Pos) >= 3:
			return execAndMaybeWait(a, format, pid, apidef.POST_projects_projectId_plans_planId_execute, "{planId}", a.Pos[2])
		}
		return cli.NewUsageError("plan ls|get <id>|run <id>", rabbitHelp)

	// ── env ──
	case "env":
		if len(a.Pos) >= 2 && a.Pos[1] == "ls" {
			pid, cerr := projectId(a)
			if cerr != nil {
				return cerr
			}
			body, err := cli.Request(cli.RequestOpts{Method: "GET", Path: path(apidef.GET_projects_projectId_environments, pid), DryRun: a.Bool("dry-run")})
			if err != nil {
				return err
			}
			cli.EmitSuccess(unwrap(body), format, nil)
			return nil
		}
		return cli.NewUsageError("env ls", rabbitHelp)

	// ── task / report ──
	case "task":
		if len(a.Pos) < 3 {
			return cli.NewUsageError("task get|wait|stop <taskId>", rabbitHelp)
		}
		switch a.Pos[1] {
		case "get":
			body, err := cli.Request(cli.RequestOpts{Method: "GET", Path: apidef.GET_open_exec_taskId, Params: map[string]string{"taskId": a.Pos[2]}, DryRun: a.Bool("dry-run")})
			if err != nil {
				return err
			}
			cli.EmitSuccess(unwrap(body), format, nil)
			return nil
		case "wait":
			return taskWait(a, format, a.Pos[2])
		case "stop":
			pid, cerr := projectId(a)
			if cerr != nil {
				return cerr
			}
			p := strings.ReplaceAll(apidef.POST_projects_projectId_exec_tasks_taskId_stop, "{taskId}", a.Pos[2])
			body, err := cli.Request(cli.RequestOpts{Method: "POST", Path: path(p, pid), Data: map[string]any{}, DryRun: a.Bool("dry-run")})
			if err != nil {
				return err
			}
			cli.EmitSuccess(unwrap(body), format, nil)
			return nil
		}
		return cli.NewUsageError("task get|wait|stop", rabbitHelp)

	case "report":
		if len(a.Pos) >= 3 && a.Pos[1] == "get" {
			body, err := cli.Request(cli.RequestOpts{Method: "GET", Path: apidef.GET_open_exec_taskId_report, Params: map[string]string{"taskId": a.Pos[2]}, DryRun: a.Bool("dry-run")})
			if err != nil {
				return err
			}
			cli.EmitSuccess(unwrap(body), format, nil)
			return nil
		}
		return cli.NewUsageError("report get <taskId>", rabbitHelp)
	}
	return cli.NewUsageError(fmt.Sprintf("未知命令组 %q", group), rabbitHelp)
}

// readPayload 读取 --file（JSON 文件）或 --data（内联 JSON）。
func readPayload(a *cli.Args) (any, error) {
	if f := a.Str("file"); f != "" {
		b, err := os.ReadFile(f)
		if err != nil {
			return nil, &cli.CliError{Type: "config", Message: "读取 --file 失败: " + err.Error()}
		}
		var v any
		if err := json.Unmarshal(b, &v); err != nil {
			return nil, cli.NewUsageError("--file 不是合法 JSON: "+err.Error(), "")
		}
		return v, nil
	}
	if d := a.Str("data"); d != "" {
		var v any
		if err := json.Unmarshal([]byte(d), &v); err != nil {
			return nil, cli.NewUsageError("--data 不是合法 JSON: "+err.Error(), "")
		}
		return v, nil
	}
	return nil, cli.NewUsageError("需要 --file <path> 或 --data '<json>'", "")
}

// execAndMaybeWait 触发执行（POST 模板端点）；--wait 时轮询 open/exec/{taskId} 至终态。
func execAndMaybeWait(a *cli.Args, format string, pid, tpl, key, id string) error {
	p := strings.ReplaceAll(tpl, key, id)
	payload := map[string]any{}
	if env := a.Str("env"); env != "" {
		payload["envId"] = env
	}
	body, err := cli.Request(cli.RequestOpts{Method: "POST", Path: path(p, pid), Data: payload, DryRun: a.Bool("dry-run")})
	if err != nil {
		return err
	}
	data := unwrap(body)
	taskID := ""
	if m, ok := data.(map[string]any); ok {
		if t, _ := m["taskId"].(string); t != "" {
			taskID = t
		}
	}
	if !a.Bool("wait") || taskID == "" {
		cli.EmitSuccess(data, format, nil)
		return nil
	}
	return pollTask(format, taskID, waitTimeout(a))
}

func waitTimeout(a *cli.Args) int {
	t := 300
	if v := a.Str("timeout"); v != "" {
		if n, err := fmt.Sscanf(v, "%d", &t); err != nil || n != 1 || t <= 0 {
			t = 300
		}
	}
	return t
}

func taskWait(a *cli.Args, format string, taskID string) error {
	if a.Bool("dry-run") {
		cli.EmitSuccess(map[string]any{"task": taskID, "wait": true, "dry_run": true}, format, nil)
		return nil
	}
	return pollTask(format, taskID, waitTimeout(a))
}

// pollTask 每 2 秒轮询 open/exec/{taskId} 直至终态（SUCCESS/FAILED/STOPPED）或超时（exit 语义交给错误）。
func pollTask(format string, taskID string, timeoutSec int) error {
	deadline := time.Now().Add(time.Duration(timeoutSec) * time.Second)
	for {
		body, err := cli.Request(cli.RequestOpts{Method: "GET", Path: apidef.GET_open_exec_taskId, Params: map[string]string{"taskId": taskID}})
		if err != nil {
			return err
		}
		data := unwrap(body)
		if m, ok := data.(map[string]any); ok {
			if st, _ := m["status"].(string); st == "SUCCESS" || st == "FAILED" || st == "STOPPED" {
				cli.EmitSuccess(m, format, nil)
				return nil
			}
		}
		if time.Now().After(deadline) {
			return &cli.CliError{Type: "api", Code: 408, Message: "等待执行终态超时", Hint: fmt.Sprintf("taskId=%s timeout=%ds（task get 可再查）", taskID, timeoutSec)}
		}
		time.Sleep(2 * time.Second)
	}
}

// shortcutRun +run：执行 + （缺省）等待 + 终态摘要。
func shortcutRun(a *cli.Args, format string) error {
	if len(a.Pos) < 3 {
		return cli.NewUsageError("+run api-case <id> | +run scenario <id> | +run plan <id>", rabbitHelp)
	}
	pid, cerr := projectId(a)
	if cerr != nil {
		return cerr
	}
	// +run 缺省等待终态（智能缺省——AI 主链路一次拿结果）；--no-wait 显式关闭
	wantWait := a.Bool("wait") || !a.Bool("no-wait")
	switch a.Pos[1] {
	case "api-case":
		if len(a.Pos) < 4 {
			return cli.NewUsageError("+run api-case <apiId> <caseId> [--env ENV]", rabbitHelp)
		}
		p := strings.ReplaceAll(apidef.POST_projects_projectId_apis_apiId_cases_execute, "{apiId}", a.Pos[2])
		payload := map[string]any{"caseIds": []string{a.Pos[3]}}
		if env := a.Str("env"); env != "" {
			payload["envId"] = env
		}
		body, err := cli.Request(cli.RequestOpts{Method: "POST", Path: path(p, pid), Data: payload, DryRun: a.Bool("dry-run")})
		if err != nil {
			return err
		}
		data := unwrap(body)
		if m, ok := data.(map[string]any); ok {
			if t, _ := m["taskId"].(string); t != "" && wantWait {
				return pollTask(format, t, waitTimeout(a))
			}
		}
		cli.EmitSuccess(data, format, nil)
		return nil
	case "scenario":
		return execAndMaybeWait(a, format, pid, apidef.POST_projects_projectId_scenarios_id_execute, "{id}", a.Pos[2])
	case "plan":
		return execAndMaybeWait(a, format, pid, apidef.POST_projects_projectId_plans_planId_execute, "{planId}", a.Pos[2])
	}
	return cli.NewUsageError("+run 支持 api-case / scenario / plan", rabbitHelp)
}
