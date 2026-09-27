-- Sprint 5 Git 仓库文件：file_items 补仓库溯源列（branch/repo_path）+ repo_id 索引
-- 门禁 3 例外登记：test-domain-model §6（S5，2026-09-28）——分支/路径属仓库文件行级属性，依赖 FILE-001 规格定型
ALTER TABLE "file_items" ADD COLUMN "branch" VARCHAR(128);
ALTER TABLE "file_items" ADD COLUMN "repo_path" VARCHAR(512);
CREATE INDEX "file_items_repo_id_idx" ON "file_items"("repo_id");
