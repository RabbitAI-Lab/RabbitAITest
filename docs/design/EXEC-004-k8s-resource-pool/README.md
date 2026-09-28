# EXEC-004 K8S 型资源池 · 高保真原型

- 画板一：NODE 型池详情（type Tag + 社区版单池说明条——基线同款文案）
- 画板二：编辑对话框（类型 Radio NODE/K8S + K8S 四项表单 apiServer/命名空间/Token/镜像 + 测试连接按钮）
- 画板三：测试连接三态（loading ≤5s / 成功显 k8sVersion 且不落库 / 失败 502·50423 行内）
- 画板四：K8S 型详情（token 掩码「已设置」+ loadTest/uiTest 占位字段「—」）与休眠保留/调度零变化说明

走查要点：Token 只写不读、试连不保存语义、K8S→NODE→K8S 配置保留、ENTP-006 建池禁用口径不变。
