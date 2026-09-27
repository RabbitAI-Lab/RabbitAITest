-- Sprint 6：插件 name+kind 唯一约束（并发上传竞态防护——INTG e2e 定位的双 id 缺陷）
CREATE UNIQUE INDEX "plugins_name_kind_key" ON "plugins"("name", "kind");
