-- Sprint 1：列名 snake_case @map 全量补齐（INFRA-003 勘误 1，expand-contract）
-- + S1 规格声明列/表补齐（Bug.status/handle_user/module/tags、ReviewCase.results、PlanCaseRef.result/exec_history、CaseReview.description、Group.disabled/description、user_preferences、attachments）
-- 约束与索引跟随列重命名自动生效；GIN（fields jsonb_path_ops）与复合索引为迁移补建项（PROJ-002/CASE-002）。
ALTER TABLE "User" RENAME COLUMN "passwordHash" TO "password_hash";
ALTER TABLE "User" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "User" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "User" RENAME COLUMN "deletedAt" TO "deleted_at";
ALTER TABLE "Organization" RENAME COLUMN "ownerId" TO "owner_id";
ALTER TABLE "Organization" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "Organization" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "Organization" RENAME COLUMN "deletedAt" TO "deleted_at";
ALTER TABLE "org_members" RENAME COLUMN "orgId" TO "org_id";
ALTER TABLE "org_members" RENAME COLUMN "userId" TO "user_id";
ALTER TABLE "org_members" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "projects" RENAME COLUMN "orgId" TO "org_id";
ALTER TABLE "projects" RENAME COLUMN "deletedAt" TO "deleted_at";
ALTER TABLE "projects" RENAME COLUMN "purgeAt" TO "purge_at";
ALTER TABLE "projects" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "projects" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "project_members" RENAME COLUMN "projectId" TO "project_id";
ALTER TABLE "project_members" RENAME COLUMN "userId" TO "user_id";
ALTER TABLE "project_members" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "groups" RENAME COLUMN "orgId" TO "org_id";
ALTER TABLE "groups" RENAME COLUMN "projectId" TO "project_id";
ALTER TABLE "groups" RENAME COLUMN "isSystem" TO "is_system";
ALTER TABLE "groups" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "groups" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "group_members" RENAME COLUMN "groupId" TO "group_id";
ALTER TABLE "group_members" RENAME COLUMN "userId" TO "user_id";
ALTER TABLE "resource_pools" RENAME COLUMN "isDefault" TO "is_default";
ALTER TABLE "resource_pools" RENAME COLUMN "maxConcurrency" TO "max_concurrency";
ALTER TABLE "resource_pools" RENAME COLUMN "lastBeatAt" TO "last_beat_at";
ALTER TABLE "resource_pools" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "resource_pools" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "plugins" RENAME COLUMN "storageKey" TO "storage_key";
ALTER TABLE "plugins" RENAME COLUMN "orgScope" TO "org_scope";
ALTER TABLE "plugins" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "plugins" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "audit_logs" RENAME COLUMN "userId" TO "user_id";
ALTER TABLE "audit_logs" RENAME COLUMN "projectId" TO "project_id";
ALTER TABLE "audit_logs" RENAME COLUMN "objectType" TO "object_type";
ALTER TABLE "audit_logs" RENAME COLUMN "objectId" TO "object_id";
ALTER TABLE "audit_logs" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "notifications" RENAME COLUMN "userId" TO "user_id";
ALTER TABLE "notifications" RENAME COLUMN "readAt" TO "read_at";
ALTER TABLE "notifications" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "robots" RENAME COLUMN "projectId" TO "project_id";
ALTER TABLE "robots" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "api_keys" RENAME COLUMN "userId" TO "user_id";
ALTER TABLE "api_keys" RENAME COLUMN "keyHash" TO "key_hash";
ALTER TABLE "api_keys" RENAME COLUMN "lastUsedAt" TO "last_used_at";
ALTER TABLE "api_keys" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "api_keys" RENAME COLUMN "revokedAt" TO "revoked_at";
ALTER TABLE "system_params" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "licenses" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "licenses" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "module_nodes" RENAME COLUMN "projectId" TO "project_id";
ALTER TABLE "module_nodes" RENAME COLUMN "parentId" TO "parent_id";
ALTER TABLE "module_nodes" RENAME COLUMN "isDefault" TO "is_default";
ALTER TABLE "module_nodes" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "module_nodes" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "field_defs" RENAME COLUMN "orgId" TO "org_id";
ALTER TABLE "field_defs" RENAME COLUMN "projectId" TO "project_id";
ALTER TABLE "field_defs" RENAME COLUMN "isSystem" TO "is_system";
ALTER TABLE "field_defs" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "field_defs" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "templates" RENAME COLUMN "orgId" TO "org_id";
ALTER TABLE "templates" RENAME COLUMN "projectId" TO "project_id";
ALTER TABLE "templates" RENAME COLUMN "isDefault" TO "is_default";
ALTER TABLE "templates" RENAME COLUMN "isSystem" TO "is_system";
ALTER TABLE "templates" RENAME COLUMN "platformBinding" TO "platform_binding";
ALTER TABLE "templates" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "templates" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "workflow_states" RENAME COLUMN "templateId" TO "template_id";
ALTER TABLE "workflow_states" RENAME COLUMN "isStart" TO "is_start";
ALTER TABLE "workflow_states" RENAME COLUMN "isEnd" TO "is_end";
ALTER TABLE "workflow_transitions" RENAME COLUMN "fromStateId" TO "from_state_id";
ALTER TABLE "workflow_transitions" RENAME COLUMN "toStateId" TO "to_state_id";
ALTER TABLE "environments" RENAME COLUMN "projectId" TO "project_id";
ALTER TABLE "environments" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "environments" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "environments" RENAME COLUMN "deletedAt" TO "deleted_at";
ALTER TABLE "env_groups" RENAME COLUMN "projectId" TO "project_id";
ALTER TABLE "env_groups" RENAME COLUMN "environmentIds" TO "environment_ids";
ALTER TABLE "env_groups" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "global_params" RENAME COLUMN "projectId" TO "project_id";
ALTER TABLE "global_params" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "file_items" RENAME COLUMN "projectId" TO "project_id";
ALTER TABLE "file_items" RENAME COLUMN "moduleId" TO "module_id";
ALTER TABLE "file_items" RENAME COLUMN "storageKey" TO "storage_key";
ALTER TABLE "file_items" RENAME COLUMN "jarEnabled" TO "jar_enabled";
ALTER TABLE "file_items" RENAME COLUMN "repoId" TO "repo_id";
ALTER TABLE "file_items" RENAME COLUMN "deletedAt" TO "deleted_at";
ALTER TABLE "file_items" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "file_repos" RENAME COLUMN "projectId" TO "project_id";
ALTER TABLE "file_repos" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "public_scripts" RENAME COLUMN "projectId" TO "project_id";
ALTER TABLE "public_scripts" RENAME COLUMN "deletedAt" TO "deleted_at";
ALTER TABLE "public_scripts" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "public_scripts" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "false_alarm_rules" RENAME COLUMN "projectId" TO "project_id";
ALTER TABLE "false_alarm_rules" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "false_alarm_rules" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "app_settings" RENAME COLUMN "projectId" TO "project_id";
ALTER TABLE "app_settings" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "functional_cases" RENAME COLUMN "projectId" TO "project_id";
ALTER TABLE "functional_cases" RENAME COLUMN "moduleId" TO "module_id";
ALTER TABLE "functional_cases" RENAME COLUMN "templateId" TO "template_id";
ALTER TABLE "functional_cases" RENAME COLUMN "deletedAt" TO "deleted_at";
ALTER TABLE "functional_cases" RENAME COLUMN "createdBy" TO "created_by";
ALTER TABLE "functional_cases" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "functional_cases" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "case_reviews" RENAME COLUMN "projectId" TO "project_id";
ALTER TABLE "case_reviews" RENAME COLUMN "reviewMode" TO "review_mode";
ALTER TABLE "case_reviews" RENAME COLUMN "startAt" TO "start_at";
ALTER TABLE "case_reviews" RENAME COLUMN "endAt" TO "end_at";
ALTER TABLE "case_reviews" RENAME COLUMN "deletedAt" TO "deleted_at";
ALTER TABLE "case_reviews" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "case_reviews" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "review_cases" RENAME COLUMN "reviewId" TO "review_id";
ALTER TABLE "review_cases" RENAME COLUMN "caseId" TO "case_id";
ALTER TABLE "review_cases" RENAME COLUMN "reSubmit" TO "re_submit";
ALTER TABLE "review_cases" RENAME COLUMN "commentedAt" TO "commented_at";
ALTER TABLE "case_dependencies" RENAME COLUMN "preCaseId" TO "pre_case_id";
ALTER TABLE "case_dependencies" RENAME COLUMN "postCaseId" TO "post_case_id";
ALTER TABLE "case_demand_refs" RENAME COLUMN "caseId" TO "case_id";
ALTER TABLE "case_demand_refs" RENAME COLUMN "demandKey" TO "demand_key";
ALTER TABLE "case_demand_refs" RENAME COLUMN "demandJson" TO "demand_json";
ALTER TABLE "comments" RENAME COLUMN "entityType" TO "entity_type";
ALTER TABLE "comments" RENAME COLUMN "entityId" TO "entity_id";
ALTER TABLE "comments" RENAME COLUMN "userId" TO "user_id";
ALTER TABLE "comments" RENAME COLUMN "parentId" TO "parent_id";
ALTER TABLE "comments" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "comments" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "comments" RENAME COLUMN "deletedAt" TO "deleted_at";
ALTER TABLE "change_logs" RENAME COLUMN "entityType" TO "entity_type";
ALTER TABLE "change_logs" RENAME COLUMN "entityId" TO "entity_id";
ALTER TABLE "change_logs" RENAME COLUMN "userId" TO "user_id";
ALTER TABLE "change_logs" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "follows" RENAME COLUMN "userId" TO "user_id";
ALTER TABLE "follows" RENAME COLUMN "entityType" TO "entity_type";
ALTER TABLE "follows" RENAME COLUMN "entityId" TO "entity_id";
ALTER TABLE "follows" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "test_plans" RENAME COLUMN "projectId" TO "project_id";
ALTER TABLE "test_plans" RENAME COLUMN "groupId" TO "group_id";
ALTER TABLE "test_plans" RENAME COLUMN "moduleId" TO "module_id";
ALTER TABLE "test_plans" RENAME COLUMN "startAt" TO "start_at";
ALTER TABLE "test_plans" RENAME COLUMN "endAt" TO "end_at";
ALTER TABLE "test_plans" RENAME COLUMN "archivedAt" TO "archived_at";
ALTER TABLE "test_plans" RENAME COLUMN "deletedAt" TO "deleted_at";
ALTER TABLE "test_plans" RENAME COLUMN "createdBy" TO "created_by";
ALTER TABLE "test_plans" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "test_plans" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "test_points" RENAME COLUMN "planId" TO "plan_id";
ALTER TABLE "test_points" RENAME COLUMN "parentId" TO "parent_id";
ALTER TABLE "test_points" RENAME COLUMN "inheritConfig" TO "inherit_config";
ALTER TABLE "plan_case_refs" RENAME COLUMN "planId" TO "plan_id";
ALTER TABLE "plan_case_refs" RENAME COLUMN "pointId" TO "point_id";
ALTER TABLE "plan_case_refs" RENAME COLUMN "refType" TO "ref_type";
ALTER TABLE "plan_case_refs" RENAME COLUMN "refId" TO "ref_id";
ALTER TABLE "plan_case_refs" RENAME COLUMN "execUserId" TO "exec_user_id";
ALTER TABLE "bugs" RENAME COLUMN "projectId" TO "project_id";
ALTER TABLE "bugs" RENAME COLUMN "templateId" TO "template_id";
ALTER TABLE "bugs" RENAME COLUMN "platformKey" TO "platform_key";
ALTER TABLE "bugs" RENAME COLUMN "syncState" TO "sync_state";
ALTER TABLE "bugs" RENAME COLUMN "deletedAt" TO "deleted_at";
ALTER TABLE "bugs" RENAME COLUMN "createdBy" TO "created_by";
ALTER TABLE "bugs" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "bugs" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "bug_case_refs" RENAME COLUMN "bugId" TO "bug_id";
ALTER TABLE "bug_case_refs" RENAME COLUMN "refType" TO "ref_type";
ALTER TABLE "bug_case_refs" RENAME COLUMN "refId" TO "ref_id";
ALTER TABLE "platform_sync_configs" RENAME COLUMN "projectId" TO "project_id";
ALTER TABLE "platform_sync_configs" RENAME COLUMN "projectKey" TO "project_key";
ALTER TABLE "platform_sync_configs" RENAME COLUMN "bugTypes" TO "bug_types";
ALTER TABLE "platform_sync_configs" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "api_definitions" RENAME COLUMN "projectId" TO "project_id";
ALTER TABLE "api_definitions" RENAME COLUMN "moduleId" TO "module_id";
ALTER TABLE "api_definitions" RENAME COLUMN "deletedAt" TO "deleted_at";
ALTER TABLE "api_definitions" RENAME COLUMN "createdBy" TO "created_by";
ALTER TABLE "api_definitions" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "api_definitions" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "api_cases" RENAME COLUMN "apiId" TO "api_id";
ALTER TABLE "api_cases" RENAME COLUMN "projectId" TO "project_id";
ALTER TABLE "api_cases" RENAME COLUMN "deletedAt" TO "deleted_at";
ALTER TABLE "api_cases" RENAME COLUMN "createdBy" TO "created_by";
ALTER TABLE "api_cases" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "api_cases" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "api_mocks" RENAME COLUMN "apiId" TO "api_id";
ALTER TABLE "api_mocks" RENAME COLUMN "followApi" TO "follow_api";
ALTER TABLE "api_mocks" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "api_mocks" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "scenarios" RENAME COLUMN "projectId" TO "project_id";
ALTER TABLE "scenarios" RENAME COLUMN "moduleId" TO "module_id";
ALTER TABLE "scenarios" RENAME COLUMN "deletedAt" TO "deleted_at";
ALTER TABLE "scenarios" RENAME COLUMN "createdBy" TO "created_by";
ALTER TABLE "scenarios" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "scenarios" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "scenario_steps" RENAME COLUMN "scenarioId" TO "scenario_id";
ALTER TABLE "scenario_steps" RENAME COLUMN "parentId" TO "parent_id";
ALTER TABLE "scenario_steps" RENAME COLUMN "stepType" TO "step_type";
ALTER TABLE "scenario_steps" RENAME COLUMN "refId" TO "ref_id";
ALTER TABLE "exec_tasks" RENAME COLUMN "projectId" TO "project_id";
ALTER TABLE "exec_tasks" RENAME COLUMN "refType" TO "ref_type";
ALTER TABLE "exec_tasks" RENAME COLUMN "refId" TO "ref_id";
ALTER TABLE "exec_tasks" RENAME COLUMN "clientTaskId" TO "client_task_id";
ALTER TABLE "exec_tasks" RENAME COLUMN "poolId" TO "pool_id";
ALTER TABLE "exec_tasks" RENAME COLUMN "envId" TO "env_id";
ALTER TABLE "exec_tasks" RENAME COLUMN "failureKind" TO "failure_kind";
ALTER TABLE "exec_tasks" RENAME COLUMN "startedAt" TO "started_at";
ALTER TABLE "exec_tasks" RENAME COLUMN "finishedAt" TO "finished_at";
ALTER TABLE "exec_tasks" RENAME COLUMN "durationMs" TO "duration_ms";
ALTER TABLE "exec_tasks" RENAME COLUMN "createdBy" TO "created_by";
ALTER TABLE "exec_tasks" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "exec_tasks" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "exec_items" RENAME COLUMN "taskId" TO "task_id";
ALTER TABLE "exec_items" RENAME COLUMN "refType" TO "ref_type";
ALTER TABLE "exec_items" RENAME COLUMN "refId" TO "ref_id";
ALTER TABLE "exec_items" RENAME COLUMN "startedAt" TO "started_at";
ALTER TABLE "exec_items" RENAME COLUMN "finishedAt" TO "finished_at";
ALTER TABLE "exec_step_results" RENAME COLUMN "itemId" TO "item_id";
ALTER TABLE "exec_step_results" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "reports" RENAME COLUMN "taskId" TO "task_id";
ALTER TABLE "reports" RENAME COLUMN "projectId" TO "project_id";
ALTER TABLE "reports" RENAME COLUMN "planId" TO "plan_id";
ALTER TABLE "reports" RENAME COLUMN "reportType" TO "report_type";
ALTER TABLE "reports" RENAME COLUMN "createdBy" TO "created_by";
ALTER TABLE "reports" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "report_shares" RENAME COLUMN "reportId" TO "report_id";
ALTER TABLE "report_shares" RENAME COLUMN "expireAt" TO "expire_at";
ALTER TABLE "report_shares" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "false_alarm_hits" RENAME COLUMN "reportId" TO "report_id";
ALTER TABLE "false_alarm_hits" RENAME COLUMN "taskId" TO "task_id";
ALTER TABLE "false_alarm_hits" RENAME COLUMN "ruleId" TO "rule_id";
ALTER TABLE "false_alarm_hits" RENAME COLUMN "createdAt" TO "created_at";

-- S1 新增列
ALTER TABLE "groups" ADD COLUMN "disabled" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "groups" ADD COLUMN "description" VARCHAR(512);
ALTER TABLE "bugs" ADD COLUMN "status" VARCHAR(64) NOT NULL DEFAULT '';
ALTER TABLE "bugs" ADD COLUMN "handle_user_id" TEXT;
ALTER TABLE "bugs" ADD COLUMN "module_id" TEXT;
ALTER TABLE "bugs" ADD COLUMN "tags" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "case_reviews" ADD COLUMN "description" VARCHAR(2000);
ALTER TABLE "review_cases" ADD COLUMN "results" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "plan_case_refs" ADD COLUMN "result" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "plan_case_refs" ADD COLUMN "exec_history" JSONB NOT NULL DEFAULT '[]';

-- S1 新增表
CREATE TABLE "user_preferences" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "project_id" VARCHAR(191) NOT NULL DEFAULT '',
    "key" VARCHAR(64) NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "user_preferences_user_id_project_id_key_key" ON "user_preferences"("user_id", "project_id", "key");
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "entity_type" VARCHAR(64) NOT NULL,
    "entity_id" TEXT NOT NULL,
    "name" VARCHAR(256) NOT NULL,
    "storage_key" VARCHAR(512) NOT NULL,
    "size" INTEGER NOT NULL,
    "mime" VARCHAR(128),
    "created_by" TEXT NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "attachments_entity_type_entity_id_idx" ON "attachments"("entity_type", "entity_id");
CREATE INDEX "attachments_project_id_deleted_at_idx" ON "attachments"("project_id", "deleted_at");
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 索引补建
CREATE INDEX "functional_cases_module_id_deleted_at_idx" ON "functional_cases"("module_id", "deleted_at");
CREATE INDEX "functional_cases_fields_gin" ON "functional_cases" USING GIN ("fields" jsonb_path_ops);
CREATE INDEX "bugs_fields_gin" ON "bugs" USING GIN ("fields" jsonb_path_ops);
CREATE UNIQUE INDEX "workflow_states_template_id_serial_key" ON "workflow_states"("template_id", "serial");
