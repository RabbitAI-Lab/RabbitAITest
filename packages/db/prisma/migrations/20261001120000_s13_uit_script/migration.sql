-- S13 UIT-003：UI 测试脚本模式（mode=script：Playwright 直录直执行）。
-- 增列理由（门禁 3）：脚本模式需求诞生于 2026-10-01（用户直提），S11 建表时该能力不存在——
-- 属新能力域而非漏建；存量行 mode 缺省 steps、steps 模式语义零变化。
ALTER TABLE "ui_test_cases" ADD COLUMN "mode" VARCHAR(16) NOT NULL DEFAULT 'steps';
ALTER TABLE "ui_test_cases" ADD COLUMN "script" TEXT;
ALTER TABLE "ui_test_cases" ADD COLUMN "params" JSONB NOT NULL DEFAULT '[]';
