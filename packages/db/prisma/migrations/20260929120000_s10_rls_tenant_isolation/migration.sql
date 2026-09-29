-- INFRA-006：RLS 租户纵深防御（租户=组织；零业务表 DDL）
-- 语义：策略 TO PUBLIC（默认拒绝）——owner/admin 通道豁免（不 FORCE），rabbit_tenant 角色事务内
--       set_config('app.tenant_id', orgId, true) 后按组织过滤；未设上下文 → 谓词为假 → 零行（断路）。
-- 排除面（多态/个人/全局表，见规格 §2.3）：users, auth_sources, resource_pools, plugins,
--       system_params, licenses, api_keys, ai_models, notifications, ai_conversations,
--       ai_messages, comments, change_logs, follows, audit_logs。
-- 纪律：新增业务表必须同步本策略（rules/database.md §7）。

CREATE OR REPLACE FUNCTION app_tenant_id() RETURNS text
LANGUAGE sql STABLE AS
$fn$ SELECT NULLIF(current_setting('app.tenant_id', true), '') $fn$;


ALTER TABLE "Organization" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "Organization" FOR ALL TO PUBLIC
  USING ("Organization".id = app_tenant_id())
  WITH CHECK ("Organization".id = app_tenant_id());

ALTER TABLE "org_members" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "org_members" FOR ALL TO PUBLIC
  USING (org_members.org_id = app_tenant_id())
  WITH CHECK (org_members.org_id = app_tenant_id());

ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "projects" FOR ALL TO PUBLIC
  USING (projects.org_id = app_tenant_id())
  WITH CHECK (projects.org_id = app_tenant_id());

ALTER TABLE "departments" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "departments" FOR ALL TO PUBLIC
  USING (departments.org_id = app_tenant_id())
  WITH CHECK (departments.org_id = app_tenant_id());

ALTER TABLE "platform_integrations" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "platform_integrations" FOR ALL TO PUBLIC
  USING (platform_integrations.org_id = app_tenant_id())
  WITH CHECK (platform_integrations.org_id = app_tenant_id());

ALTER TABLE "groups" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "groups" FOR ALL TO PUBLIC
  USING (((groups.org_id IS NULL AND groups.project_id IS NULL) OR groups.org_id = app_tenant_id() OR EXISTS (SELECT 1 FROM projects p WHERE p.id = groups.project_id AND p.org_id = app_tenant_id())))
  WITH CHECK (((groups.org_id IS NULL AND groups.project_id IS NULL) OR groups.org_id = app_tenant_id() OR EXISTS (SELECT 1 FROM projects p WHERE p.id = groups.project_id AND p.org_id = app_tenant_id())));

ALTER TABLE "templates" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "templates" FOR ALL TO PUBLIC
  USING ((templates.org_id = app_tenant_id() OR EXISTS (SELECT 1 FROM projects p WHERE p.id = templates.project_id AND p.org_id = app_tenant_id())))
  WITH CHECK ((templates.org_id = app_tenant_id() OR EXISTS (SELECT 1 FROM projects p WHERE p.id = templates.project_id AND p.org_id = app_tenant_id())));

ALTER TABLE "field_defs" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "field_defs" FOR ALL TO PUBLIC
  USING ((field_defs.org_id = app_tenant_id() OR EXISTS (SELECT 1 FROM projects p WHERE p.id = field_defs.project_id AND p.org_id = app_tenant_id())))
  WITH CHECK ((field_defs.org_id = app_tenant_id() OR EXISTS (SELECT 1 FROM projects p WHERE p.id = field_defs.project_id AND p.org_id = app_tenant_id())));

ALTER TABLE "message_templates" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "message_templates" FOR ALL TO PUBLIC
  USING (EXISTS (SELECT 1 FROM projects p WHERE p.id = message_templates.project_id AND p.org_id = app_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM projects p WHERE p.id = message_templates.project_id AND p.org_id = app_tenant_id()));

ALTER TABLE "project_members" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "project_members" FOR ALL TO PUBLIC
  USING (EXISTS (SELECT 1 FROM projects p WHERE p.id = project_members.project_id AND p.org_id = app_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM projects p WHERE p.id = project_members.project_id AND p.org_id = app_tenant_id()));

ALTER TABLE "module_nodes" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "module_nodes" FOR ALL TO PUBLIC
  USING (EXISTS (SELECT 1 FROM projects p WHERE p.id = module_nodes.project_id AND p.org_id = app_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM projects p WHERE p.id = module_nodes.project_id AND p.org_id = app_tenant_id()));

ALTER TABLE "environments" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "environments" FOR ALL TO PUBLIC
  USING (EXISTS (SELECT 1 FROM projects p WHERE p.id = environments.project_id AND p.org_id = app_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM projects p WHERE p.id = environments.project_id AND p.org_id = app_tenant_id()));

ALTER TABLE "env_groups" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "env_groups" FOR ALL TO PUBLIC
  USING (EXISTS (SELECT 1 FROM projects p WHERE p.id = env_groups.project_id AND p.org_id = app_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM projects p WHERE p.id = env_groups.project_id AND p.org_id = app_tenant_id()));

ALTER TABLE "global_params" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "global_params" FOR ALL TO PUBLIC
  USING (EXISTS (SELECT 1 FROM projects p WHERE p.id = global_params.project_id AND p.org_id = app_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM projects p WHERE p.id = global_params.project_id AND p.org_id = app_tenant_id()));

ALTER TABLE "file_items" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "file_items" FOR ALL TO PUBLIC
  USING (EXISTS (SELECT 1 FROM projects p WHERE p.id = file_items.project_id AND p.org_id = app_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM projects p WHERE p.id = file_items.project_id AND p.org_id = app_tenant_id()));

ALTER TABLE "file_repos" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "file_repos" FOR ALL TO PUBLIC
  USING (EXISTS (SELECT 1 FROM projects p WHERE p.id = file_repos.project_id AND p.org_id = app_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM projects p WHERE p.id = file_repos.project_id AND p.org_id = app_tenant_id()));

ALTER TABLE "public_scripts" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "public_scripts" FOR ALL TO PUBLIC
  USING (EXISTS (SELECT 1 FROM projects p WHERE p.id = public_scripts.project_id AND p.org_id = app_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM projects p WHERE p.id = public_scripts.project_id AND p.org_id = app_tenant_id()));

ALTER TABLE "false_alarm_rules" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "false_alarm_rules" FOR ALL TO PUBLIC
  USING (EXISTS (SELECT 1 FROM projects p WHERE p.id = false_alarm_rules.project_id AND p.org_id = app_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM projects p WHERE p.id = false_alarm_rules.project_id AND p.org_id = app_tenant_id()));

ALTER TABLE "app_settings" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "app_settings" FOR ALL TO PUBLIC
  USING (EXISTS (SELECT 1 FROM projects p WHERE p.id = app_settings.project_id AND p.org_id = app_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM projects p WHERE p.id = app_settings.project_id AND p.org_id = app_tenant_id()));

ALTER TABLE "user_preferences" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "user_preferences" FOR ALL TO PUBLIC
  USING (EXISTS (SELECT 1 FROM projects p WHERE p.id = user_preferences.project_id AND p.org_id = app_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM projects p WHERE p.id = user_preferences.project_id AND p.org_id = app_tenant_id()));

ALTER TABLE "functional_cases" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "functional_cases" FOR ALL TO PUBLIC
  USING (EXISTS (SELECT 1 FROM projects p WHERE p.id = functional_cases.project_id AND p.org_id = app_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM projects p WHERE p.id = functional_cases.project_id AND p.org_id = app_tenant_id()));

ALTER TABLE "case_reviews" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "case_reviews" FOR ALL TO PUBLIC
  USING (EXISTS (SELECT 1 FROM projects p WHERE p.id = case_reviews.project_id AND p.org_id = app_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM projects p WHERE p.id = case_reviews.project_id AND p.org_id = app_tenant_id()));

ALTER TABLE "test_plans" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "test_plans" FOR ALL TO PUBLIC
  USING (EXISTS (SELECT 1 FROM projects p WHERE p.id = test_plans.project_id AND p.org_id = app_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM projects p WHERE p.id = test_plans.project_id AND p.org_id = app_tenant_id()));

ALTER TABLE "bugs" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "bugs" FOR ALL TO PUBLIC
  USING (EXISTS (SELECT 1 FROM projects p WHERE p.id = bugs.project_id AND p.org_id = app_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM projects p WHERE p.id = bugs.project_id AND p.org_id = app_tenant_id()));

ALTER TABLE "attachments" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "attachments" FOR ALL TO PUBLIC
  USING (EXISTS (SELECT 1 FROM projects p WHERE p.id = attachments.project_id AND p.org_id = app_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM projects p WHERE p.id = attachments.project_id AND p.org_id = app_tenant_id()));

ALTER TABLE "platform_sync_configs" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "platform_sync_configs" FOR ALL TO PUBLIC
  USING (EXISTS (SELECT 1 FROM projects p WHERE p.id = platform_sync_configs.project_id AND p.org_id = app_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM projects p WHERE p.id = platform_sync_configs.project_id AND p.org_id = app_tenant_id()));

ALTER TABLE "api_definitions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "api_definitions" FOR ALL TO PUBLIC
  USING (EXISTS (SELECT 1 FROM projects p WHERE p.id = api_definitions.project_id AND p.org_id = app_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM projects p WHERE p.id = api_definitions.project_id AND p.org_id = app_tenant_id()));

ALTER TABLE "api_cases" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "api_cases" FOR ALL TO PUBLIC
  USING (EXISTS (SELECT 1 FROM projects p WHERE p.id = api_cases.project_id AND p.org_id = app_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM projects p WHERE p.id = api_cases.project_id AND p.org_id = app_tenant_id()));

ALTER TABLE "scenarios" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "scenarios" FOR ALL TO PUBLIC
  USING (EXISTS (SELECT 1 FROM projects p WHERE p.id = scenarios.project_id AND p.org_id = app_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM projects p WHERE p.id = scenarios.project_id AND p.org_id = app_tenant_id()));

ALTER TABLE "exec_tasks" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "exec_tasks" FOR ALL TO PUBLIC
  USING (EXISTS (SELECT 1 FROM projects p WHERE p.id = exec_tasks.project_id AND p.org_id = app_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM projects p WHERE p.id = exec_tasks.project_id AND p.org_id = app_tenant_id()));

ALTER TABLE "reports" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "reports" FOR ALL TO PUBLIC
  USING (EXISTS (SELECT 1 FROM projects p WHERE p.id = reports.project_id AND p.org_id = app_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM projects p WHERE p.id = reports.project_id AND p.org_id = app_tenant_id()));

ALTER TABLE "ai_prompt_templates" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "ai_prompt_templates" FOR ALL TO PUBLIC
  USING (EXISTS (SELECT 1 FROM projects p WHERE p.id = ai_prompt_templates.project_id AND p.org_id = app_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM projects p WHERE p.id = ai_prompt_templates.project_id AND p.org_id = app_tenant_id()));

ALTER TABLE "ai_gen_records" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "ai_gen_records" FOR ALL TO PUBLIC
  USING (EXISTS (SELECT 1 FROM projects p WHERE p.id = ai_gen_records.project_id AND p.org_id = app_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM projects p WHERE p.id = ai_gen_records.project_id AND p.org_id = app_tenant_id()));

ALTER TABLE "robots" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "robots" FOR ALL TO PUBLIC
  USING (EXISTS (SELECT 1 FROM projects p WHERE p.id = robots.project_id AND p.org_id = app_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM projects p WHERE p.id = robots.project_id AND p.org_id = app_tenant_id()));

ALTER TABLE "group_members" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "group_members" FOR ALL TO PUBLIC
  USING (EXISTS (SELECT 1 FROM groups x WHERE x.id = group_members.group_id AND ((x.org_id IS NULL AND x.project_id IS NULL) OR x.org_id = app_tenant_id() OR EXISTS (SELECT 1 FROM projects p WHERE p.id = x.project_id AND p.org_id = app_tenant_id()))))
  WITH CHECK (EXISTS (SELECT 1 FROM groups x WHERE x.id = group_members.group_id AND ((x.org_id IS NULL AND x.project_id IS NULL) OR x.org_id = app_tenant_id() OR EXISTS (SELECT 1 FROM projects p WHERE p.id = x.project_id AND p.org_id = app_tenant_id()))));

ALTER TABLE "department_members" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "department_members" FOR ALL TO PUBLIC
  USING (EXISTS (SELECT 1 FROM departments x WHERE x.id = department_members.department_id AND x.org_id = app_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM departments x WHERE x.id = department_members.department_id AND x.org_id = app_tenant_id()));

ALTER TABLE "workflow_states" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "workflow_states" FOR ALL TO PUBLIC
  USING (EXISTS (SELECT 1 FROM templates x WHERE x.id = workflow_states.template_id AND (x.org_id = app_tenant_id() OR EXISTS (SELECT 1 FROM projects p WHERE p.id = x.project_id AND p.org_id = app_tenant_id()))))
  WITH CHECK (EXISTS (SELECT 1 FROM templates x WHERE x.id = workflow_states.template_id AND (x.org_id = app_tenant_id() OR EXISTS (SELECT 1 FROM projects p WHERE p.id = x.project_id AND p.org_id = app_tenant_id()))));

ALTER TABLE "workflow_transitions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "workflow_transitions" FOR ALL TO PUBLIC
  USING (EXISTS (SELECT 1 FROM workflow_states ws JOIN templates x ON x.id = ws.template_id WHERE ws.id = workflow_transitions.from_state_id AND (x.org_id = app_tenant_id() OR EXISTS (SELECT 1 FROM projects p WHERE p.id = x.project_id AND p.org_id = app_tenant_id()))))
  WITH CHECK (EXISTS (SELECT 1 FROM workflow_states ws JOIN templates x ON x.id = ws.template_id WHERE ws.id = workflow_transitions.from_state_id AND (x.org_id = app_tenant_id() OR EXISTS (SELECT 1 FROM projects p WHERE p.id = x.project_id AND p.org_id = app_tenant_id()))));

ALTER TABLE "review_cases" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "review_cases" FOR ALL TO PUBLIC
  USING (EXISTS (SELECT 1 FROM case_reviews x WHERE x.id = review_cases.review_id AND EXISTS (SELECT 1 FROM projects p WHERE p.id = x.project_id AND p.org_id = app_tenant_id())))
  WITH CHECK (EXISTS (SELECT 1 FROM case_reviews x WHERE x.id = review_cases.review_id AND EXISTS (SELECT 1 FROM projects p WHERE p.id = x.project_id AND p.org_id = app_tenant_id())));

ALTER TABLE "case_dependencies" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "case_dependencies" FOR ALL TO PUBLIC
  USING (EXISTS (SELECT 1 FROM functional_cases x WHERE x.id = case_dependencies.pre_case_id AND EXISTS (SELECT 1 FROM projects p WHERE p.id = x.project_id AND p.org_id = app_tenant_id())) AND EXISTS (SELECT 1 FROM functional_cases x WHERE x.id = case_dependencies.post_case_id AND EXISTS (SELECT 1 FROM projects p WHERE p.id = x.project_id AND p.org_id = app_tenant_id())))
  WITH CHECK (EXISTS (SELECT 1 FROM functional_cases x WHERE x.id = case_dependencies.pre_case_id AND EXISTS (SELECT 1 FROM projects p WHERE p.id = x.project_id AND p.org_id = app_tenant_id())) AND EXISTS (SELECT 1 FROM functional_cases x WHERE x.id = case_dependencies.post_case_id AND EXISTS (SELECT 1 FROM projects p WHERE p.id = x.project_id AND p.org_id = app_tenant_id())));

ALTER TABLE "case_demand_refs" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "case_demand_refs" FOR ALL TO PUBLIC
  USING (EXISTS (SELECT 1 FROM functional_cases x WHERE x.id = case_demand_refs.case_id AND EXISTS (SELECT 1 FROM projects p WHERE p.id = x.project_id AND p.org_id = app_tenant_id())))
  WITH CHECK (EXISTS (SELECT 1 FROM functional_cases x WHERE x.id = case_demand_refs.case_id AND EXISTS (SELECT 1 FROM projects p WHERE p.id = x.project_id AND p.org_id = app_tenant_id())));

ALTER TABLE "case_api_refs" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "case_api_refs" FOR ALL TO PUBLIC
  USING (EXISTS (SELECT 1 FROM functional_cases x WHERE x.id = case_api_refs.case_id AND EXISTS (SELECT 1 FROM projects p WHERE p.id = x.project_id AND p.org_id = app_tenant_id())))
  WITH CHECK (EXISTS (SELECT 1 FROM functional_cases x WHERE x.id = case_api_refs.case_id AND EXISTS (SELECT 1 FROM projects p WHERE p.id = x.project_id AND p.org_id = app_tenant_id())));

ALTER TABLE "bug_case_refs" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "bug_case_refs" FOR ALL TO PUBLIC
  USING (EXISTS (SELECT 1 FROM bugs x WHERE x.id = bug_case_refs.bug_id AND EXISTS (SELECT 1 FROM projects p WHERE p.id = x.project_id AND p.org_id = app_tenant_id())))
  WITH CHECK (EXISTS (SELECT 1 FROM bugs x WHERE x.id = bug_case_refs.bug_id AND EXISTS (SELECT 1 FROM projects p WHERE p.id = x.project_id AND p.org_id = app_tenant_id())));

ALTER TABLE "test_points" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "test_points" FOR ALL TO PUBLIC
  USING (EXISTS (SELECT 1 FROM test_plans x WHERE x.id = test_points.plan_id AND EXISTS (SELECT 1 FROM projects p WHERE p.id = x.project_id AND p.org_id = app_tenant_id())))
  WITH CHECK (EXISTS (SELECT 1 FROM test_plans x WHERE x.id = test_points.plan_id AND EXISTS (SELECT 1 FROM projects p WHERE p.id = x.project_id AND p.org_id = app_tenant_id())));

ALTER TABLE "plan_case_refs" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "plan_case_refs" FOR ALL TO PUBLIC
  USING (EXISTS (SELECT 1 FROM test_plans x WHERE x.id = plan_case_refs.plan_id AND EXISTS (SELECT 1 FROM projects p WHERE p.id = x.project_id AND p.org_id = app_tenant_id())))
  WITH CHECK (EXISTS (SELECT 1 FROM test_plans x WHERE x.id = plan_case_refs.plan_id AND EXISTS (SELECT 1 FROM projects p WHERE p.id = x.project_id AND p.org_id = app_tenant_id())));

ALTER TABLE "api_mocks" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "api_mocks" FOR ALL TO PUBLIC
  USING (EXISTS (SELECT 1 FROM api_definitions x WHERE x.id = api_mocks.api_id AND EXISTS (SELECT 1 FROM projects p WHERE p.id = x.project_id AND p.org_id = app_tenant_id())))
  WITH CHECK (EXISTS (SELECT 1 FROM api_definitions x WHERE x.id = api_mocks.api_id AND EXISTS (SELECT 1 FROM projects p WHERE p.id = x.project_id AND p.org_id = app_tenant_id())));

ALTER TABLE "scenario_steps" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "scenario_steps" FOR ALL TO PUBLIC
  USING (EXISTS (SELECT 1 FROM scenarios x WHERE x.id = scenario_steps.scenario_id AND EXISTS (SELECT 1 FROM projects p WHERE p.id = x.project_id AND p.org_id = app_tenant_id())))
  WITH CHECK (EXISTS (SELECT 1 FROM scenarios x WHERE x.id = scenario_steps.scenario_id AND EXISTS (SELECT 1 FROM projects p WHERE p.id = x.project_id AND p.org_id = app_tenant_id())));

ALTER TABLE "exec_items" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "exec_items" FOR ALL TO PUBLIC
  USING (EXISTS (SELECT 1 FROM exec_tasks x WHERE x.id = exec_items.task_id AND EXISTS (SELECT 1 FROM projects p WHERE p.id = x.project_id AND p.org_id = app_tenant_id())))
  WITH CHECK (EXISTS (SELECT 1 FROM exec_tasks x WHERE x.id = exec_items.task_id AND EXISTS (SELECT 1 FROM projects p WHERE p.id = x.project_id AND p.org_id = app_tenant_id())));

ALTER TABLE "exec_step_results" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "exec_step_results" FOR ALL TO PUBLIC
  USING (EXISTS (SELECT 1 FROM exec_items ei JOIN exec_tasks x ON x.id = ei.task_id WHERE ei.id = exec_step_results.item_id AND EXISTS (SELECT 1 FROM projects p WHERE p.id = x.project_id AND p.org_id = app_tenant_id())))
  WITH CHECK (EXISTS (SELECT 1 FROM exec_items ei JOIN exec_tasks x ON x.id = ei.task_id WHERE ei.id = exec_step_results.item_id AND EXISTS (SELECT 1 FROM projects p WHERE p.id = x.project_id AND p.org_id = app_tenant_id())));

ALTER TABLE "report_shares" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "report_shares" FOR ALL TO PUBLIC
  USING (EXISTS (SELECT 1 FROM reports x WHERE x.id = report_shares.report_id AND EXISTS (SELECT 1 FROM projects p WHERE p.id = x.project_id AND p.org_id = app_tenant_id())))
  WITH CHECK (EXISTS (SELECT 1 FROM reports x WHERE x.id = report_shares.report_id AND EXISTS (SELECT 1 FROM projects p WHERE p.id = x.project_id AND p.org_id = app_tenant_id())));

ALTER TABLE "false_alarm_hits" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "false_alarm_hits" FOR ALL TO PUBLIC
  USING (EXISTS (SELECT 1 FROM reports x WHERE x.id = false_alarm_hits.report_id AND EXISTS (SELECT 1 FROM projects p WHERE p.id = x.project_id AND p.org_id = app_tenant_id())))
  WITH CHECK (EXISTS (SELECT 1 FROM reports x WHERE x.id = false_alarm_hits.report_id AND EXISTS (SELECT 1 FROM projects p WHERE p.id = x.project_id AND p.org_id = app_tenant_id())));
