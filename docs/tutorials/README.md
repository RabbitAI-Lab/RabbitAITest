# RabbitAITest 教学视频系列 — 制作主计划

> 本目录是《RabbitAITest 功能教学》系列（7 系列 23 集，全集约 95 分钟）的**分镜 / 内容 / 提示词**唯一事实源。
> 每集一份制作稿，供三条生产线共用：AI 素材生成（MiniMax）、配音合成（MiniMax T2A）、录屏与合成（Playwright + ffmpeg）。

## 目录结构

```
docs/tutorials/
├── README.md                  ← 本文件：使用说明与命名约定
├── series-outline.md          ← 总纲：23 集总表、统一视觉风格、共享 AI 素材（片头）、配音与参数规范
├── series-01-intro/           ← 系列一：课程简介（1.1 / 1.2）
├── series-02-test-mgmt/       ← 系列二：测试管理（2.1 ~ 2.5）
├── series-03-api-testing/     ← 系列三：接口测试（3.1 ~ 3.6）
├── series-04-collab/          ← 系列四：团队协作（4.1 ~ 4.3）
├── series-05-ai/              ← 系列五：AI 能力（5.1 ~ 5.3）
├── series-06-extension/       ← 系列六：扩展与集成（6.1 / 6.2）
└── series-07-ui-load/         ← 系列七：UI 与性能测试（7.1 / 7.2，收官段）
```

## 每集制作稿的结构（统一模板）

| 章节          | 内容                                            | 谁消费                                        |
| ------------- | ----------------------------------------------- | --------------------------------------------- |
| 元信息        | 集号 / 标题 / 时长 / AI 素材 / 涉及路由 / 状态  | 人                                            |
| 教学目标      | 看完本集观众能做什么                            | 人（验收口径）                                |
| 录制数据准备  | 录屏前必须预置的数据与账号                      | `record.mjs` 前置                             |
| 分镜表        | 镜号 / 类型 / 时长 / 画面与动作 / 运镜与交互    | `record.mjs`（录屏段）、`compose.mjs`（时序） |
| 配音脚本      | 按镜号切分的口播文案                            | `narrate.mjs` → T2A                           |
| AI 素材提示词 | 本集专属概念动画的完整 prompt + 参数 + 负面提示 | `broll.mjs` → MiniMax                         |
| 录制要点      | 运镜细节、二态对比、易错点                      | `record.mjs`                                  |

分镜「类型」枚举：`片头`（全系列复用素材）/ `AI`（本集概念动画）/ `录屏` / `字卡`（HTML/ffmpeg 渲染，**不用 AI 生成**，文字必须清晰）/ `转场` / `片尾`。

## 命名与产出约定

| 产物        | 路径                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------- |
| AI 素材 ID  | `broll-intro`（片头，一次生成全系列复用）、`broll-{ep}`（如 `broll-2.5`）                   |
| AI 生成视频 | `portal/assets/tutor/broll/{素材ID}.mp4`                                                    |
| 配音音频    | `portal/assets/tutor/vo/{ep}/{镜号}.mp3`                                                    |
| 录屏脚本    | `tests/demo/tutor-{ep}-{slug}.mjs`（复用 `tests/demo/fp-demo-record.mjs` 的脚本化录制模式） |
| 字卡/转场   | `portal/assets/tutor/cards/{ep}-{镜号}.png`（HTML 渲染导出）                                |
| 成片        | `portal/assets/tutor/{ep}-{slug}.mp4`（1920×1080 / 30fps）                                  |

## 制作管线（四脚本，落在 scripts/tutor/）

1. `broll.mjs` — 读各集制作稿的提示词块，调 MiniMax 视频生成 API（T2V/I2V 异步任务），按 prompt 哈希缓存幂等；**额度感知**：每日提交任务数 ≤ 当前套餐每日条数（默认 3，可配 `TUTOR_BROLL_DAILY_LIMIT`）。
2. `narrate.mjs` — 读配音脚本表，逐镜调 T2A 合成 mp3，按镜号落盘。
3. `record.mjs` — Playwright 起栈（复用 e2e 环境与槽位端口），按分镜表执行操作并录制；支持**注入运镜**（目标元素 CSS transform 平滑缩放、spotlight 聚焦遮罩、光标高亮）。
4. `compose.mjs` — ffmpeg 按分镜时序拼接 片头/AI 段/录屏段/字卡，混入配音轨，烧录字幕（文案即配音脚本，无需 ASR），输出成片。

密钥：`MINIMAX_API_KEY`（同 `visual:diff` 需 `GLM_API_KEY` 的先例）；成片与素材不进 CI。

## 与仓库规范的关系

- 本目录是**内容制作主计划**，不是功能规格；正式开工时建 `docs/sprint-11-tutorials/TUTO-001-tutorial-series.md` 引用本目录，状态流转与 PR 纪律照常适用。
- 录屏脚本的造数与选择器可直接参考 `tests/e2e/{MODULE}-*.spec.ts`（同一套 UI，用例即操作脚本底稿）。
- 教学内容必须与 main 分支实际功能一致：功能变更时同步更新对应分镜稿并在 PR 中链接。
