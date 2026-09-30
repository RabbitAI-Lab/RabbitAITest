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

export const ENTP_FEATURE_LABELS: Record<EntpFeature, string> = Object.fromEntries(
  ENTP_FEATURES.map((f) => [f.key, f.label]),
) as Record<EntpFeature, string>;
