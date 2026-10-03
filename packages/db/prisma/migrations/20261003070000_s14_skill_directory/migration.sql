-- S14 技能目录格式：zip 上传解压——format(markdown|directory) + storage_key
ALTER TABLE "agent_skills" ADD COLUMN "format" VARCHAR(16) NOT NULL DEFAULT 'markdown';
ALTER TABLE "agent_skills" ADD COLUMN "storage_key" VARCHAR(512);
