-- Sprint future K8S 型资源池：resource_pools 补 config 列（apiServer/namespace/token/image）
-- 门禁 3 例外登记：test-domain-model §6（S-future，2026-09-28）——K8S 池配置结构在 EXEC-002 时点未冻结（ENTP-006 边界未定），
-- 以 Json 载体一次补齐；后续 K8S 细化只动 Json 内部结构不动 DDL
ALTER TABLE "resource_pools" ADD COLUMN "config" JSONB NOT NULL DEFAULT '{}';
