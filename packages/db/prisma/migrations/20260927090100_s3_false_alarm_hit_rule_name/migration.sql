-- S3 API-010：误报命中留痕规则名冗余列（规则删除后报告仍可展示命中规则名——门禁 3 评审补齐）
ALTER TABLE "false_alarm_hits" ADD COLUMN "rule_name" VARCHAR(128) NOT NULL DEFAULT '';
ALTER TABLE "false_alarm_hits" ADD COLUMN "step_path" VARCHAR(64);
