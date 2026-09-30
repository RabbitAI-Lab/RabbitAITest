/**
 * 企业版特性目录（S9 ENTP-007；rbac §6 特性枚举兑现）。
 * 六特性与 MeterSphere X-Pack 功能面一一对应（清单 §十二 12.1-12.6/12.11）；
 * 扫码登录归 SSO 特性位（ENTP-003 复用）。
 */
export const ENTP_FEATURES = [
  { key: "MULTI_ORG", label: "多组织管理", spec: "ENTP-001" },
  { key: "SSO", label: "单点认证（SSO）+ 扫码登录", spec: "ENTP-002/003" },
  { key: "MULTI_POOL", label: "多资源池", spec: "ENTP-006" },
  { key: "THEME", label: "自定义主题品牌", spec: "ENTP-004" },
  { key: "MSG_TEMPLATE", label: "自定义消息模板", spec: "ENTP-005" },
  { key: "USER_SCALE", label: "用户扩容与部门", spec: "ENTP-008" },
  { key: "LOAD_TEST", label: "性能测试", spec: "LOAD-003" },
  { key: "UI_TEST", label: "UI 测试", spec: "UIT-002" },
] as const;

export type EntpFeature = (typeof ENTP_FEATURES)[number]["key"];

export const ENTP_FEATURE_KEYS: readonly EntpFeature[] = ENTP_FEATURES.map((f) => f.key);

// ── 开源全功能模式（ENTP-009，2026-09-30 产品决策）──
// false（默认）= License 不门控任何特性：无 License / 任意 License 均全功能（开源发行口径）；
// true = 恢复 ENTP-007 特性门控（企业发行口径，RABBIT_FEATURE_GATE=1 启用；门控代码全量保留可一键回切）。
// 服务端读 env 一次；客户端经 license-status 响应字段 featureGateEnabled 下发（单一事实源，防两端漂移）。
let featureGate = process.env.RABBIT_FEATURE_GATE === "1";

export function featureGateEnabled(): boolean {
  return featureGate;
}

/** 仅供单测翻转门控断言两侧语义（生产恒以 RABBIT_FEATURE_GATE 初始化） */
export function setFeatureGateEnabled(v: boolean): void {
  featureGate = v;
}

export const ENTP_FEATURE_LABELS: Record<EntpFeature, string> = Object.fromEntries(
  ENTP_FEATURES.map((f) => [f.key, f.label]),
) as Record<EntpFeature, string>;
