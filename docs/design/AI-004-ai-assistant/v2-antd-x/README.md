# AI-004 UI v2 原型（Ant Design X 重构）

> 2026-09-28 · 因用户验收反馈 v1 面板视觉简陋，UI 层重构为 @ant-design/x 1.6.1（Bubble / Sender / Conversations / Welcome / Prompts）。
> 本目录为 v2 高保真原型，**取代 v1 index.html 的 UI 口径**（v1 保留作历史对照）；后端契约与交互语义不变，见规格 §9 变更记录。

## 与实现的走查对照点

1. 画板一：面板 720px；Conversations 会话栏（active 高亮/hover ⋯ 菜单=重命名+删除）；Bubble 气泡（助手头像渐变圆/用户右对齐主题色渐变）；Sender 圆角容器（textarea + 底部动作条=模型下拉+圆形发送钮）
2. 画板二：空态 Welcome（渐变图标 + 「我是 RabbitAITest 智能助手」+ 副文案）+ Prompts 三张能力建议卡（点击即填入输入框）
3. 画板三：停止态（半截灰显 + 红色光标 + 「已停止生成」标注）；错误态（红边气泡，testid ai-chat-error）；loading 态发送钮变红色圆形停止钮

## 兼容性登记

- @ant-design/x 选 1.x 线：peer antd ^5.20.3（2.x 需 antd 6，属架构级升级不做）
- e2e 锚点全部保留：空态标题文案、ai-chat-messages 内气泡文本、ai-chat-send/stop 可点
