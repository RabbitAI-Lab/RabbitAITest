-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" VARCHAR(256) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "phone" VARCHAR(32),
    "passwordHash" VARCHAR(512) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    "source" VARCHAR(32) NOT NULL DEFAULT 'LOCAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "description" VARCHAR(512),
    "ownerId" TEXT NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_members" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "num" INTEGER NOT NULL,
    "description" VARCHAR(512),
    "modules" JSONB NOT NULL DEFAULT '{"case":true,"api":true,"plan":true,"bug":true}',
    "status" VARCHAR(32) NOT NULL DEFAULT 'ENABLED',
    "deletedAt" TIMESTAMP(3),
    "purgeAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_members" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" VARCHAR(32) NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "groups" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "scope" VARCHAR(16) NOT NULL,
    "orgId" TEXT,
    "projectId" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "permissions" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_members" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "group_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_pools" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "type" VARCHAR(16) NOT NULL DEFAULT 'NODE',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "maxConcurrency" INTEGER NOT NULL DEFAULT 4,
    "nodes" JSONB NOT NULL DEFAULT '[]',
    "lastBeatAt" TIMESTAMP(3),
    "status" VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resource_pools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plugins" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "version" VARCHAR(32) NOT NULL,
    "storageKey" VARCHAR(512) NOT NULL,
    "orgScope" JSONB NOT NULL DEFAULT '"ALL"',
    "description" VARCHAR(512),
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plugins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "scope" VARCHAR(16) NOT NULL,
    "projectId" TEXT,
    "action" VARCHAR(64) NOT NULL,
    "objectType" VARCHAR(64) NOT NULL,
    "objectId" VARCHAR(64),
    "detail" JSONB,
    "ip" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "title" VARCHAR(256) NOT NULL,
    "content" VARCHAR(2048) NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "robots" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "channel" VARCHAR(32) NOT NULL,
    "webhook" VARCHAR(1024),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "robots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "prefix" VARCHAR(16) NOT NULL,
    "keyHash" VARCHAR(128) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_params" (
    "key" VARCHAR(64) NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_params_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "licenses" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(4096) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'NONE',
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "licenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "module_nodes" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "scene" VARCHAR(16) NOT NULL,
    "parentId" TEXT,
    "name" VARCHAR(128) NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "module_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "field_defs" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT,
    "scene" VARCHAR(16) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "type" VARCHAR(32) NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" JSONB NOT NULL DEFAULT '{}',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "field_defs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "templates" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT,
    "scene" VARCHAR(16) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "fields" JSONB NOT NULL DEFAULT '[]',
    "platformBinding" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_states" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "scene" VARCHAR(16) NOT NULL,
    "serial" VARCHAR(64) NOT NULL,
    "isStart" BOOLEAN NOT NULL DEFAULT false,
    "isEnd" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "workflow_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_transitions" (
    "id" TEXT NOT NULL,
    "fromStateId" TEXT NOT NULL,
    "toStateId" TEXT NOT NULL,

    CONSTRAINT "workflow_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "environments" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "environments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "env_groups" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "environmentIds" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "env_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "global_params" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "global_params_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_items" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "moduleId" TEXT,
    "name" VARCHAR(256) NOT NULL,
    "storageKey" VARCHAR(512) NOT NULL,
    "size" INTEGER NOT NULL,
    "mime" VARCHAR(128),
    "jarEnabled" BOOLEAN NOT NULL DEFAULT false,
    "repoId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_repos" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "platform" VARCHAR(32) NOT NULL,
    "url" VARCHAR(1024) NOT NULL,
    "token" VARCHAR(512),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_repos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_scripts" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "language" VARCHAR(32) NOT NULL DEFAULT 'javascript',
    "status" VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
    "tags" JSONB NOT NULL DEFAULT '[]',
    "params" JSONB NOT NULL DEFAULT '[]',
    "content" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "public_scripts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "false_alarm_rules" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "matcher" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "false_alarm_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "projectId" TEXT NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("projectId","key")
);

-- CreateTable
CREATE TABLE "functional_cases" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "num" INTEGER NOT NULL,
    "name" VARCHAR(512) NOT NULL,
    "precondition" VARCHAR(4000) NOT NULL,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "level" VARCHAR(8) NOT NULL DEFAULT 'P2',
    "status" VARCHAR(32) NOT NULL DEFAULT 'PREPARING',
    "tags" JSONB NOT NULL DEFAULT '[]',
    "templateId" TEXT,
    "fields" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "functional_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_reviews" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" VARCHAR(256) NOT NULL,
    "reviewMode" VARCHAR(16) NOT NULL DEFAULT 'SINGLE',
    "reviewers" JSONB NOT NULL DEFAULT '[]',
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "status" VARCHAR(32) NOT NULL DEFAULT 'UNDERWAY',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "case_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_cases" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "reviewer" VARCHAR(64),
    "result" VARCHAR(32),
    "reSubmit" BOOLEAN NOT NULL DEFAULT false,
    "commentedAt" TIMESTAMP(3),

    CONSTRAINT "review_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_dependencies" (
    "id" TEXT NOT NULL,
    "preCaseId" TEXT NOT NULL,
    "postCaseId" TEXT NOT NULL,

    CONSTRAINT "case_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_demand_refs" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "platform" VARCHAR(32) NOT NULL,
    "demandKey" VARCHAR(128) NOT NULL,
    "demandJson" JSONB,

    CONSTRAINT "case_demand_refs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" TEXT NOT NULL,
    "entityType" VARCHAR(64) NOT NULL,
    "entityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" VARCHAR(4000) NOT NULL,
    "mentions" JSONB NOT NULL DEFAULT '[]',
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_logs" (
    "id" TEXT NOT NULL,
    "entityType" VARCHAR(64) NOT NULL,
    "entityId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "action" VARCHAR(32) NOT NULL,
    "diff" JSONB,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follows" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityType" VARCHAR(64) NOT NULL,
    "entityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_plans" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "groupId" TEXT,
    "type" VARCHAR(8) NOT NULL DEFAULT 'PLAN',
    "name" VARCHAR(256) NOT NULL,
    "description" VARCHAR(2000),
    "moduleId" TEXT,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "tags" JSONB NOT NULL DEFAULT '[]',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "status" VARCHAR(32) NOT NULL DEFAULT 'NOT_STARTED',
    "archivedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "test_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_points" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" VARCHAR(256) NOT NULL,
    "inheritConfig" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL DEFAULT '{}',
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "test_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_case_refs" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "pointId" TEXT,
    "refType" VARCHAR(32) NOT NULL,
    "refId" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "execUserId" TEXT,
    "status" VARCHAR(32) NOT NULL DEFAULT 'NOT_RUN',

    CONSTRAINT "plan_case_refs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bugs" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "templateId" TEXT,
    "num" INTEGER NOT NULL,
    "title" VARCHAR(512) NOT NULL,
    "description" VARCHAR(8000) NOT NULL,
    "fields" JSONB NOT NULL DEFAULT '{}',
    "platform" VARCHAR(32) NOT NULL DEFAULT 'LOCAL',
    "platformKey" VARCHAR(128),
    "syncState" VARCHAR(32) NOT NULL DEFAULT 'NONE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bugs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bug_case_refs" (
    "id" TEXT NOT NULL,
    "bugId" TEXT NOT NULL,
    "refType" VARCHAR(32) NOT NULL,
    "refId" TEXT NOT NULL,

    CONSTRAINT "bug_case_refs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_sync_configs" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "platform" VARCHAR(32) NOT NULL,
    "projectKey" VARCHAR(128),
    "bugTypes" JSONB NOT NULL DEFAULT '[]',
    "mode" VARCHAR(16) NOT NULL DEFAULT 'INCREMENT',
    "cron" VARCHAR(64),
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_sync_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_definitions" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "num" INTEGER NOT NULL,
    "protocol" VARCHAR(32) NOT NULL DEFAULT 'HTTP',
    "method" VARCHAR(16) NOT NULL,
    "path" VARCHAR(1024) NOT NULL,
    "name" VARCHAR(512) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'DEBUG',
    "version" INTEGER NOT NULL DEFAULT 1,
    "request" JSONB NOT NULL,
    "response" JSONB NOT NULL DEFAULT '{}',
    "deletedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_cases" (
    "id" TEXT NOT NULL,
    "apiId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "num" INTEGER NOT NULL,
    "name" VARCHAR(512) NOT NULL,
    "level" VARCHAR(8) NOT NULL DEFAULT 'P2',
    "status" VARCHAR(32) NOT NULL DEFAULT 'UNDERWAY',
    "tags" JSONB NOT NULL DEFAULT '[]',
    "request" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_mocks" (
    "id" TEXT NOT NULL,
    "apiId" TEXT NOT NULL,
    "name" VARCHAR(256) NOT NULL,
    "matchers" JSONB NOT NULL,
    "response" JSONB NOT NULL,
    "followApi" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_mocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scenarios" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "num" INTEGER NOT NULL,
    "name" VARCHAR(512) NOT NULL,
    "level" VARCHAR(8) NOT NULL DEFAULT 'P2',
    "status" VARCHAR(32) NOT NULL DEFAULT 'UNDERWAY',
    "tags" JSONB NOT NULL DEFAULT '[]',
    "config" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scenario_steps" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "parentId" TEXT,
    "stepType" VARCHAR(32) NOT NULL,
    "refId" TEXT,
    "name" VARCHAR(256) NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "scenario_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exec_tasks" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" VARCHAR(32) NOT NULL,
    "refType" VARCHAR(32),
    "refId" VARCHAR(64),
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "clientTaskId" VARCHAR(128),
    "poolId" TEXT,
    "envId" TEXT,
    "payload" JSONB NOT NULL,
    "failureKind" VARCHAR(32),
    "message" VARCHAR(2000),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exec_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exec_items" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "refType" VARCHAR(32) NOT NULL,
    "refId" TEXT NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "result" JSONB,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "exec_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exec_step_results" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "frame" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exec_step_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "planId" TEXT,
    "reportType" VARCHAR(32) NOT NULL,
    "name" VARCHAR(256) NOT NULL,
    "summary" VARCHAR(4000),
    "snapshot" JSONB,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_shares" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "token" VARCHAR(128) NOT NULL,
    "expireAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "false_alarm_hits" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "ruleId" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "false_alarm_hits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "org_members_userId_idx" ON "org_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "org_members_orgId_userId_key" ON "org_members"("orgId", "userId");

-- CreateIndex
CREATE INDEX "projects_deletedAt_idx" ON "projects"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "projects_orgId_num_key" ON "projects"("orgId", "num");

-- CreateIndex
CREATE INDEX "project_members_userId_idx" ON "project_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "project_members_projectId_userId_key" ON "project_members"("projectId", "userId");

-- CreateIndex
CREATE INDEX "groups_scope_idx" ON "groups"("scope");

-- CreateIndex
CREATE UNIQUE INDEX "group_members_groupId_userId_key" ON "group_members"("groupId", "userId");

-- CreateIndex
CREATE INDEX "audit_logs_projectId_createdAt_idx" ON "audit_logs"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_userId_createdAt_idx" ON "audit_logs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "module_nodes_projectId_scene_idx" ON "module_nodes"("projectId", "scene");

-- CreateIndex
CREATE UNIQUE INDEX "field_defs_scene_key_orgId_key" ON "field_defs"("scene", "key", "orgId");

-- CreateIndex
CREATE INDEX "templates_scene_projectId_idx" ON "templates"("scene", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_transitions_fromStateId_toStateId_key" ON "workflow_transitions"("fromStateId", "toStateId");

-- CreateIndex
CREATE INDEX "environments_projectId_deletedAt_idx" ON "environments"("projectId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "global_params_projectId_key" ON "global_params"("projectId");

-- CreateIndex
CREATE INDEX "file_items_projectId_deletedAt_idx" ON "file_items"("projectId", "deletedAt");

-- CreateIndex
CREATE INDEX "functional_cases_projectId_deletedAt_name_idx" ON "functional_cases"("projectId", "deletedAt", "name");

-- CreateIndex
CREATE INDEX "functional_cases_projectId_deletedAt_level_idx" ON "functional_cases"("projectId", "deletedAt", "level");

-- CreateIndex
CREATE UNIQUE INDEX "functional_cases_projectId_num_key" ON "functional_cases"("projectId", "num");

-- CreateIndex
CREATE UNIQUE INDEX "review_cases_reviewId_caseId_key" ON "review_cases"("reviewId", "caseId");

-- CreateIndex
CREATE UNIQUE INDEX "case_dependencies_preCaseId_postCaseId_key" ON "case_dependencies"("preCaseId", "postCaseId");

-- CreateIndex
CREATE UNIQUE INDEX "case_demand_refs_caseId_platform_demandKey_key" ON "case_demand_refs"("caseId", "platform", "demandKey");

-- CreateIndex
CREATE INDEX "comments_entityType_entityId_createdAt_idx" ON "comments"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "change_logs_entityType_entityId_createdAt_idx" ON "change_logs"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "change_logs_entityType_entityId_seq_key" ON "change_logs"("entityType", "entityId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "follows_userId_entityType_entityId_key" ON "follows"("userId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "test_plans_projectId_deletedAt_idx" ON "test_plans"("projectId", "deletedAt");

-- CreateIndex
CREATE INDEX "plan_case_refs_refType_refId_idx" ON "plan_case_refs"("refType", "refId");

-- CreateIndex
CREATE UNIQUE INDEX "plan_case_refs_planId_refType_refId_key" ON "plan_case_refs"("planId", "refType", "refId");

-- CreateIndex
CREATE INDEX "bugs_projectId_deletedAt_idx" ON "bugs"("projectId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "bugs_projectId_num_key" ON "bugs"("projectId", "num");

-- CreateIndex
CREATE UNIQUE INDEX "bug_case_refs_bugId_refType_refId_key" ON "bug_case_refs"("bugId", "refType", "refId");

-- CreateIndex
CREATE UNIQUE INDEX "platform_sync_configs_projectId_key" ON "platform_sync_configs"("projectId");

-- CreateIndex
CREATE INDEX "api_definitions_projectId_deletedAt_name_idx" ON "api_definitions"("projectId", "deletedAt", "name");

-- CreateIndex
CREATE UNIQUE INDEX "api_definitions_projectId_num_key" ON "api_definitions"("projectId", "num");

-- CreateIndex
CREATE UNIQUE INDEX "api_cases_projectId_num_key" ON "api_cases"("projectId", "num");

-- CreateIndex
CREATE UNIQUE INDEX "scenarios_projectId_num_key" ON "scenarios"("projectId", "num");

-- CreateIndex
CREATE INDEX "scenario_steps_scenarioId_parentId_idx" ON "scenario_steps"("scenarioId", "parentId");

-- CreateIndex
CREATE INDEX "exec_tasks_projectId_type_createdAt_idx" ON "exec_tasks"("projectId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "exec_tasks_status_idx" ON "exec_tasks"("status");

-- CreateIndex
CREATE UNIQUE INDEX "exec_tasks_projectId_clientTaskId_key" ON "exec_tasks"("projectId", "clientTaskId");

-- CreateIndex
CREATE INDEX "exec_items_taskId_idx" ON "exec_items"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "exec_step_results_itemId_seq_key" ON "exec_step_results"("itemId", "seq");

-- CreateIndex
CREATE INDEX "reports_projectId_createdAt_idx" ON "reports"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "report_shares_token_key" ON "report_shares"("token");

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "robots" ADD CONSTRAINT "robots_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "module_nodes" ADD CONSTRAINT "module_nodes_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "module_nodes" ADD CONSTRAINT "module_nodes_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "module_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_fromStateId_fkey" FOREIGN KEY ("fromStateId") REFERENCES "workflow_states"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_toStateId_fkey" FOREIGN KEY ("toStateId") REFERENCES "workflow_states"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "environments" ADD CONSTRAINT "environments_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "env_groups" ADD CONSTRAINT "env_groups_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "global_params" ADD CONSTRAINT "global_params_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_items" ADD CONSTRAINT "file_items_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_items" ADD CONSTRAINT "file_items_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "file_repos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_repos" ADD CONSTRAINT "file_repos_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_scripts" ADD CONSTRAINT "public_scripts_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "false_alarm_rules" ADD CONSTRAINT "false_alarm_rules_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "functional_cases" ADD CONSTRAINT "functional_cases_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "functional_cases" ADD CONSTRAINT "functional_cases_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "module_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_cases" ADD CONSTRAINT "review_cases_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "case_reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_cases" ADD CONSTRAINT "review_cases_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "functional_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_logs" ADD CONSTRAINT "change_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follows" ADD CONSTRAINT "follows_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_plans" ADD CONSTRAINT "test_plans_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_points" ADD CONSTRAINT "test_points_planId_fkey" FOREIGN KEY ("planId") REFERENCES "test_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_points" ADD CONSTRAINT "test_points_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "test_points"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_case_refs" ADD CONSTRAINT "plan_case_refs_planId_fkey" FOREIGN KEY ("planId") REFERENCES "test_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_case_refs" ADD CONSTRAINT "plan_case_refs_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "test_points"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bugs" ADD CONSTRAINT "bugs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bugs" ADD CONSTRAINT "bugs_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bug_case_refs" ADD CONSTRAINT "bug_case_refs_bugId_fkey" FOREIGN KEY ("bugId") REFERENCES "bugs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_definitions" ADD CONSTRAINT "api_definitions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_definitions" ADD CONSTRAINT "api_definitions_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "module_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_cases" ADD CONSTRAINT "api_cases_apiId_fkey" FOREIGN KEY ("apiId") REFERENCES "api_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_cases" ADD CONSTRAINT "api_cases_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_mocks" ADD CONSTRAINT "api_mocks_apiId_fkey" FOREIGN KEY ("apiId") REFERENCES "api_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "module_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenario_steps" ADD CONSTRAINT "scenario_steps_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "scenarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenario_steps" ADD CONSTRAINT "scenario_steps_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "scenario_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exec_tasks" ADD CONSTRAINT "exec_tasks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exec_tasks" ADD CONSTRAINT "exec_tasks_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "resource_pools"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exec_items" ADD CONSTRAINT "exec_items_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "exec_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exec_step_results" ADD CONSTRAINT "exec_step_results_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "exec_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "exec_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_shares" ADD CONSTRAINT "report_shares_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "false_alarm_hits" ADD CONSTRAINT "false_alarm_hits_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "false_alarm_hits" ADD CONSTRAINT "false_alarm_hits_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "exec_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
