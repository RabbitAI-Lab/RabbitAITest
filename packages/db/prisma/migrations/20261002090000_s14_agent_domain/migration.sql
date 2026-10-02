-- S14 AGENT-001 项目 Agent 域：project_agents / agent_skills / agent_runs / agent_run_messages 四表
-- （agent_gen_drafts 列随 AGENT-002 一次建齐——门禁 3）

-- CreateTable
CREATE TABLE "project_agents" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "description" VARCHAR(512),
    "role" VARCHAR(32) NOT NULL DEFAULT 'CUSTOM',
    "mode" VARCHAR(16) NOT NULL DEFAULT 'chat',
    "pipeline_config" JSONB,
    "model_id" VARCHAR(64) NOT NULL,
    "system_prompt" TEXT NOT NULL,
    "model_params" JSONB NOT NULL DEFAULT '{"temperature":0.3,"maxTokens":4096}',
    "max_iterations" INTEGER NOT NULL DEFAULT 12,
    "timeout_ms" INTEGER NOT NULL DEFAULT 300000,
    "repo_ids" JSONB NOT NULL DEFAULT '[]',
    "tool_keys" JSONB NOT NULL DEFAULT '[]',
    "skill_ids" JSONB NOT NULL DEFAULT '[]',
    "run_as_user_id" TEXT NOT NULL,
    "a2a_enabled" BOOLEAN NOT NULL DEFAULT false,
    "api_key_prefix" VARCHAR(16),
    "api_key_hash" VARCHAR(128),
    "key_generated_at" TIMESTAMP(3),
    "last_called_at" TIMESTAMP(3),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "project_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_skills" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "description" VARCHAR(512) NOT NULL,
    "content" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "agent_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "source" VARCHAR(16) NOT NULL,
    "context_id" VARCHAR(64) NOT NULL,
    "as_user_id" TEXT NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    "input" JSONB NOT NULL,
    "snapshot" JSONB NOT NULL,
    "output" JSONB,
    "error" VARCHAR(1024),
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER,
    "trigger_user_id" TEXT,
    "a2a_key_prefix" VARCHAR(16),
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_run_messages" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "role" VARCHAR(16) NOT NULL,
    "name" VARCHAR(64),
    "content" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_run_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_gen_drafts" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "stage" VARCHAR(16) NOT NULL,
    "asset_type" VARCHAR(32) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "payload" JSONB NOT NULL,
    "meta" JSONB,
    "conflict_status" VARCHAR(16) NOT NULL DEFAULT 'NEW',
    "conflict_ref" JSONB,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "import_status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "imported_ref" JSONB,
    "error" VARCHAR(512),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_gen_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_agents_project_id_name_key" ON "project_agents"("project_id", "name");
CREATE INDEX "project_agents_project_id_deleted_at_idx" ON "project_agents"("project_id", "deleted_at");
CREATE UNIQUE INDEX "agent_skills_project_id_name_key" ON "agent_skills"("project_id", "name");
CREATE INDEX "agent_skills_project_id_deleted_at_idx" ON "agent_skills"("project_id", "deleted_at");
CREATE INDEX "agent_runs_project_id_agent_id_created_at_idx" ON "agent_runs"("project_id", "agent_id", "created_at");
CREATE INDEX "agent_runs_project_id_context_id_created_at_idx" ON "agent_runs"("project_id", "context_id", "created_at");
CREATE UNIQUE INDEX "agent_run_messages_run_id_seq_key" ON "agent_run_messages"("run_id", "seq");
CREATE INDEX "agent_run_messages_run_id_seq_idx" ON "agent_run_messages"("run_id", "seq");
CREATE INDEX "agent_gen_drafts_run_id_asset_type_idx" ON "agent_gen_drafts"("run_id", "asset_type");
CREATE INDEX "agent_gen_drafts_project_id_created_at_idx" ON "agent_gen_drafts"("project_id", "created_at");

-- AddForeignKey
ALTER TABLE "project_agents" ADD CONSTRAINT "project_agents_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_agents" ADD CONSTRAINT "project_agents_run_as_user_id_fkey" FOREIGN KEY ("run_as_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_agents" ADD CONSTRAINT "project_agents_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "project_agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "agent_run_messages" ADD CONSTRAINT "agent_run_messages_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "agent_gen_drafts" ADD CONSTRAINT "agent_gen_drafts_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "agent_gen_drafts" ADD CONSTRAINT "agent_gen_drafts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
