# AGENT-001 项目级 Agent 配置与 A2A 接入 · 高保真原型

- 原型：[index.html](./index.html)（浏览器直接打开；Tailwind CDN + lucide，需联网）
- 对应规格：`docs/sprint-14-agent/AGENT-001-project-agents-a2a.md`（§1.2 能力行 ↔ 原型画面）
- 走查要点：
  - 画面① Agent 管理：卡片列表四态（chat 启用/pipeline 启用·含累计采纳率指标/chat 停用/A2A 已开启）、行操作（调试/发起生成[pipeline]/编辑/删除）、启用开关、「从模板新建」四模板弹层（含资产生成 pipeline 模板）、二级 tab 切换（Agent/技能/运行记录）、空态切换（右上 checkbox）；技能库表格+编辑弹窗（markdown 双栏预览）；运行记录（来源 tag/状态/耗时/token/pipeline 行采纳 n/m 徽标）+ 详情抽屉（轨迹回放/产物/A2A 密钥前缀）
  - 画面② 编辑抽屉：左侧八分区导航切换（基本信息/模型与参数/提示词/工具/Skills/代码仓库/高级/A2A）；运行模式 radio（chat·pipeline）；工具目录五分组勾选（权限点 tag+写操作红标+默认不勾组置灰）；repo 未验证态；runAs 警示；A2A 分区（密钥前 8 位常显/轮换/吊销/Card URL/curl 示例）+ 密钥一次显示弹窗
  - 画面③ 调试台：左对话区（工具调用 chip 内联+产物脚注）、右轨迹面板（🧠 LLM/🔧 工具入出参折叠 JSON/📦 产物时间线）、底部输入+停止按钮
- 勘误登记：无（实现走查发现差异时在此编号登记：勘误 1、勘误 2…）
