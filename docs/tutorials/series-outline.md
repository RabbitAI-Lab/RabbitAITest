# 教学系列总纲 — 《RabbitAITest 功能教学》

对标飞致云《MeterSphere v3.0 功能演示》合集（5 系列 14 集）的编排方式，按 RabbitAITest 实际交付功能面扩展为 **7 系列 23 集**，全集约 95 分钟。发布形态：B 站合集 + `portal/` 挂载 + 每集文字版。

> **勘误 1（2026-10-08 补全）**：初版 20 集定稿于 2026-09-30，彼时 S13/S14 功能尚未合入 main。现补 3 集对齐功能面：5.3 项目 Agent（AGENT-001/002/005：管理/调试台/A2A/技能上传/生成管线）、7.1 UI 测试（UIT-002/003/004：元素库/步骤与脚本双模式/Runner 自检）、7.2 性能测试（LOAD-003：计划/监控/报告/阈值判定）；6.2 新增代码仓库段（SCM-001）；1.1 导览补性能/UI/Agent 入口。SSO（ENTP-002）为 License 门控面，教学片不排。全系列收官页由 6.2 迁至 7.2。

## 1. 23 集总表

| 集  | 标题                  | 时长 | 本集 AI 概念动画   | 主要路由                                                           | 制作稿                                                    |
| --- | --------------------- | ---- | ------------------ | ------------------------------------------------------------------ | --------------------------------------------------------- |
| 1.1 | 课程简介 — 三大能力面 | 3:20 | 三道光流汇成工作台 | 工作台/全导航                                                      | [1.1](series-01-intro/1.1-course-intro.md)                |
| 1.2 | 五分钟上手            | 4:00 | 种子长成界面之树   | 终端、/register、/org/projects                                     | [1.2](series-01-intro/1.2-quick-start.md)                 |
| 2.1 | 测试管理 — 基本概念   | 3:00 | 发光图书馆与卡片树 | /cases、/settings/templates、/settings/public-scripts、/files      | [2.1](series-02-test-mgmt/2.1-concepts.md)                |
| 2.2 | 功能用例 — 创建与编辑 | 6:00 | 卡片流水线三站成型 | /cases、/cases/new、/cases/[id]                                    | [2.2](series-02-test-mgmt/2.2-functional-cases.md)        |
| 2.3 | 用例评审              | 4:00 | 多束光审视蓝图     | /reviews、/reviews/[id]                                            | [2.3](series-02-test-mgmt/2.3-case-review.md)             |
| 2.4 | 缺陷管理              | 4:00 | 警示灯球装罐归架   | /bugs、/bugs/new、/bugs/[id]                                       | [2.4](series-02-test-mgmt/2.4-bug-management.md)          |
| 2.5 | 测试计划              | 5:00 | 轨道列车调度进站   | /plans、/plans/[id]、/plans/groups、/share/plan/[token]            | [2.5](series-02-test-mgmt/2.5-test-plans.md)              |
| 3.1 | 接口测试 — 基本概念   | 3:00 | 插头与插座对接     | /apis、/settings/environments、/debug                              | [3.1](series-03-api-testing/3.1-concepts.md)              |
| 3.2 | 接口调试              | 4:00 | 示波器波形校准     | /debug                                                             | [3.2](series-03-api-testing/3.2-api-debug.md)             |
| 3.3 | 接口定义与接口用例    | 6:00 | 蓝图生成实体与卡片 | /apis、/apis/[id]、/settings/swagger-sync                          | [3.3](series-03-api-testing/3.3-definitions-and-cases.md) |
| 3.4 | 接口自动化场景        | 5:00 | 齿轮链传动闭环     | /scenarios、/scenarios/[id]、/scenarios/false-alarm                | [3.4](series-03-api-testing/3.4-scenarios.md)             |
| 3.5 | 执行任务与资源池      | 4:00 | 并行泳道水闸调度   | /tasks、/system/pools、/personal/local-runner                      | [3.5](series-03-api-testing/3.5-execution-and-pools.md)   |
| 3.6 | 测试报告              | 4:00 | 数据粒子排成图表   | /reports、/reports/[taskId]、/reports/stats、/share/report/[token] | [3.6](series-03-api-testing/3.6-reports.md)               |
| 4.1 | 组织、项目与成员      | 4:00 | 立体城市楼层点亮   | /org/*                                                             | [4.1](series-04-collab/4.1-org-projects-members.md)       |
| 4.2 | 用户组与权限          | 4:00 | 钥匙长廊试锁       | /system/groups、/settings/groups、/system/audit-logs               | [4.2](series-04-collab/4.2-groups-permissions.md)         |
| 4.3 | 消息与通知            | 3:00 | 信使光点飞回灯塔   | /personal/notifications、/settings/messages                        | [4.3](series-04-collab/4.3-messages-notifications.md)     |
| 5.1 | AI 助手               | 4:00 | 星云瞳孔点亮晶体   | /system/ai-models、/personal/ai-model                              | [5.1](series-05-ai/5.1-ai-assistant.md)                   |
| 5.2 | AI 生成用例           | 5:00 | 光尘折成卡片矩阵   | /settings/ai-prompts、用例生成入口                                 | [5.2](series-05-ai/5.2-ai-generate-cases.md)              |
| 5.3 | 项目 Agent            | 6:00 | 机器人助手编织卡片 | /settings/agents、[id]/debug、[id]/generate、runs/[runId]/drafts   | [5.3](series-05-ai/5.3-project-agents.md)                 |
| 6.1 | 插件体系              | 4:00 | 模块压入主板点亮   | /system/plugins                                                    | [6.1](series-06-extension/6.1-plugins.md)                 |
| 6.2 | 开放集成              | 5:30 | 光桥连通群岛       | /personal/api-keys、/settings/integrations、/settings/code-repos、/system/params | [6.2](series-06-extension/6.2-open-integration.md) |
| 7.1 | UI 测试               | 5:30 | 光笔自动描摹画板   | /ui-test、/ui-test/elements、/ui-test/tasks/[taskId]               | [7.1](series-07-ui-load/7.1-ui-testing.md)                |
| 7.2 | 性能测试              | 4:00 | 光浪冲击悬索桥     | /load、/load/tasks/[taskId]、/load/reports/[taskId]                | [7.2](series-07-ui-load/7.2-load-testing.md)              |

## 2. 统一视觉与录制规范（全系列锁定）

- **画布**：1920×1080 / 30fps；录屏以 DPR=2 采集后缩放，保证文字锐利。
- **界面主题**：统一浅色主题；浏览器 zh-CN；隐藏书签栏；鼠标高亮光标（录屏注入）。
- **节奏**：一集只讲一个闭环任务；操作后停顿 0.5s 再口播结论；每镜不超过 50s。
- **字幕**：由配音脚本直接生成（不经过 ASR）；白字 + 靛蓝描边，底部居中。
- **运镜**（录屏段注入）：进入新页面 = 全景 1s → 缩放至操作区（CSS transform 平滑过渡 600ms）；强调 = spotlight 遮罩聚焦目标元素 1.5s；禁止快速晃动镜头。

## 3. 共享 AI 素材与提示词规范

### 3.1 统一风格前缀（STYLE，每集 prompt 已内联拼接，此处为维护基准）

> 扁平低多边形3D插画风格，深蓝色科技空间背景（由深靛蓝到暗夜蓝的柔和渐变），主体以靛蓝色 #2545eb 与白色发光材质为主，辅以青色粒子光效点缀，电影级柔光，画面干净克制，无人物，

### 3.2 通用负面提示（NEG，每段生成都必须带）

> 画面中不得出现任何文字、字母、数字、单词、Logo、UI 界面、按钮、水印、签名；不要人脸特写、不要畸变的手部、不要闪烁噪点、不要低分辨率噪感

**铁律**：AI 生成段只做抽象概念隐喻，**绝不生成界面/文字画面**（必然失真）；所有带文字的画面一律用字卡（HTML 渲染）。

### 3.3 全系列统一片头（素材 ID：`broll-intro`，只生成一次）

- **提示词**：扁平低多边形3D插画风格，深蓝色科技空间背景（由深靛蓝到暗夜蓝的柔和渐变），主体以靛蓝色 #2545eb 与白色发光材质为主，辅以青色粒子光效点缀，电影级柔光，画面干净克制，无人物。一只发光的白色卡通兔子剪影站在悬浮的环形全息工作台中央，抬手轻点，三道靛蓝色光流从画面三个方向汇入工作台，工作台亮起并升腾起环绕的粒子星环，镜头围绕工作台缓慢环绕上升，最后收束定格为一枚发光的兔耳形几何徽标。
- **参数**：T2V · 768P · 6s（预算允许可用 H3 提升质感）；生成后叠加 1s 淡出。
- **片尾**：片头素材静帧徽标 + 1.5s 淡入淡出，不再单独生成。
- **勘误 1（2026-09-30 首版实拍）**：已生成 `portal/assets/tutor/broll/broll-intro.mp4`（1366×768 / 5.88s）。前 ~5s 合格（兔子剪影/工作台/三道光流/星环/品牌配色/无文字水印），但「兔耳形几何徽标」未生成——结尾为能量收束后 0.5s 骤降至黑场。**处置**：compose 时裁掉尾部约 12 帧（黑场），徽标定格改为 HTML/CSS 渲染的兔耳徽标 PNG 叠加 0.8s（文字与形状由渲染保证清晰），不重生成。教训再次验证 §3.2 铁律：具象形状/文字交后期渲染，AI 只做抽象动态。

### 3.4 字卡与转场（非 AI）

- 章节字卡：深蓝底 + 靛蓝描边标题（HTML/CSS 渲染导出 PNG），停留 4~6s。
- 转场：统一 8 帧交叉溶解；系列间可加 1s 品牌色 wipe。

## 4. 配音规范（MiniMax T2A）

- **音色**：全系列锁定一个「沉稳讲解型青年男声」（控制台试听选定；候选 `male-qn-qingse` 等），语速 0.9x。
- **切分**：按镜号逐段合成（`vo/{ep}/{镜号}.mp3`），段落即字幕单元。
- **停顿**：长句用 T2A 停顿标签控制节奏；英文术语（Swagger、quickjs、APIKEY）前后留 200ms 停顿。
- **文案口径**：口播 = 分镜表「配音脚本」列原文，不得临场改词（保证字幕一致）。

## 5. MiniMax 生成参数与成本速查

| 项                        | 口径                                                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Hailuo 2.3（图/文生视频） | 768P：6s ≈ ¥2 / 10s ≈ ¥4 —— **每集概念动画首选**                                                                           |
| MiniMax H3（全模态）      | ≤15s、最高 2K、原生双声道（教学片中静音使用）；约 $0.08~0.13/s —— 用于片头等关键素材                                       |
| 套餐每日免费条数          | Coding Plan/Token Plan 仅 Ultra 档官方明确「5 条/天」；Max 档「3 条/天」见第三方口径，**以控制台权益中心为准**；额度不结转 |
| 管线策略                  | `broll.mjs` 每日提交 ≤ `TUTOR_BROLL_DAILY_LIMIT`（默认 3）个任务，剩余队列次日续跑；prompt 哈希缓存，失败不重复扣额度      |
| 全系列预算                | 23 段概念动画（10s 档）+ 1 片头 ≈ ¥95 起步；按 3 倍重生成系数 ≈ ¥280 封顶（全按量价）                                      |

## 6. 制作顺序与试点

1. **试点**：先做 1.1 一集走通全管线（片头生成 + 录屏运镜 + T2A + ffmpeg 合成），验收观感/单集工时/实际成本。
2. **批次 A（主体）**：2.2、2.5、3.2、3.3、3.4、3.6 —— 教学价值最高的六集。
3. **批次 B**：系列一余量 1.2 + 2.1/2.3/2.4 + 3.1/3.5。
4. **批次 C**：系列四、五、六（依赖演示数据较多，最后收尾）。
5. **批次 D（勘误 1 补集）**：5.3、7.1、7.2 + 6.2 补录 SCM 段——依赖 S13/S14 功能走查翻 Verified 后开录；三集新增概念动画素材（`broll-5.3`/`broll-7.1`/`broll-7.2`）随批次排产。

## 7. 数据与账号基线（全系列通用）

- 演示栈：`pnpm dev`（embedded-postgres 自动初始化），槽位端口按 `scripts/rabbit-env.mjs`。
- 账号：`admin@rabbit.test / rabbit-admin-123`（seed 内置）；每集另需的专项数据见各集「录制数据准备」。
- 造数底稿：参考 `tests/e2e/{MODULE}-*.spec.ts` 中同名能力的造数步骤与选择器；录制脚本与其共享 UI 入口。
