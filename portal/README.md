# RabbitAITest 门户站（portal/）

项目官方门户/落地页：**独立静态站点**（无构建依赖，Tailwind Play CDN + 原生 JS），中英双语。

- `index.html` — 中文版（默认入口）
- `en/index.html` — English version
- `assets/shots/*.png` — 真实系统截图（1440×900，Playwright 对运行中系统实拍）
- `assets/demo-s5.webm` — Sprint 5 验收演示录屏（复制自 `docs/sprint-5-collaboration/demo/`）

## 内容真实性约定

本页所有功能描述、测试规模数字、性能数据均可追溯到仓库出处（`CHANGELOG.md`、`docs/README.md`、各 sprint-overview、OpenAPI 快照）。修改功能描述前先核对出处；截图与视频为真实系统产物，禁止替换为效果图。

## 本地预览

```bash
pnpm dlx serve portal          # 或 npx http-server portal
# 打开 http://localhost:3000（serve 默认端口以其输出为准）
```

直接双击 `index.html` 也可浏览（所有资源均为相对路径）。

## 部署

纯静态，任意托管均可：

- **GitHub Pages**：仓库 Settings → Pages → 选择分支与 `/portal` 目录（或拷为 `docs/` 发布目录/独立 gh-pages 分支）
- **Vercel / Netlify / Nginx**：根目录指向 `portal/` 即可

## 截图刷新

截图由 `tests/e2e/PORTAL-shots.spec.ts` 采集（复用 e2e 全家桶：global-setup 起 PG/Redis/engine/mock/web）：

```bash
# 全新口径（自管 PG，慢）或直接：
pnpm exec playwright test -c tests/playwright.config.ts PORTAL-shots

# 复用常驻库（快，需先 node scripts/pg-e2e.mjs + docker redis :6381）：
E2E_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5434/rabbit_e2e \
E2E_REDIS_URL=redis://127.0.0.1:6381 \
pnpm exec playwright test -c tests/playwright.config.ts PORTAL-shots
```

产物直接写入 `portal/assets/shots/`。注意：跑之前确认没有其他 worktree 的 engine 进程残留（会抢 Redis 队列导致任务 PENDING）。
