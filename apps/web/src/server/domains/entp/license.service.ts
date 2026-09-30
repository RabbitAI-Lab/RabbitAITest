/**
 * ENTP-007 License 体系：三段式签名校验 / 状态机 / 六特性门控（全仓唯一门控入口）。
 * 格式：RABBIT-ENT1.<b64url(payloadJson)>.<b64url(hmac-sha256(b64url(payload), secret))>
 * 状态机：NONE（无记录）→ VALID；读时 expiresAt 已过 → EXPIRED（惰性降级，门控按 NONE 处理）。
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  DomainError,
  ErrCode,
  config,
  licensePayloadSchema,
  ENTP_FEATURE_KEYS,
  featureGateEnabled,
  type EntpFeature,
  type LicensePayload,
  type LicenseStatus,
} from "@rabbit/shared";
import { prisma } from "@rabbit/db";

const LICENSE_PREFIX = "RABBIT-ENT1";

function b64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function sign(payloadSeg: string): string {
  return createHmac("sha256", config.licenseSigningSecret).update(payloadSeg).digest("base64url");
}

export function signLicensePayload(payload: LicensePayload): string {
  const seg = b64url(JSON.stringify(payload));
  return `${LICENSE_PREFIX}.${seg}.${sign(seg)}`;
}

/** 四步校验管线：分段→payload 解析→验签→期限（全部通过返回 payload）。 */
export function verifyLicenseCode(code: string): LicensePayload {
  const parts = code.trim().split(".");
  if (parts.length !== 3 || parts[0] !== LICENSE_PREFIX)
    throw new DomainError(
      ErrCode.LICENSE_FORMAT_INVALID,
      "License 内容不合法（须为三段式 RABBIT-ENT1 格式）",
    );
  let payloadJson: string;
  try {
    payloadJson = Buffer.from(parts[1] ?? "", "base64url").toString("utf8");
  } catch {
    throw new DomainError(ErrCode.LICENSE_FORMAT_INVALID, "License payload 无法解码");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(payloadJson);
  } catch {
    throw new DomainError(ErrCode.LICENSE_FORMAT_INVALID, "License payload 不是合法 JSON");
  }
  const parsed = licensePayloadSchema.safeParse(raw);
  if (!parsed.success)
    throw new DomainError(
      ErrCode.LICENSE_FORMAT_INVALID,
      `License 字段不合法：${parsed.error.issues[0]?.message ?? ""}`,
    );
  const expected = sign(parts[1] ?? "");
  const given = parts[2] ?? "";
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  if (a.length !== b.length || !timingSafeEqual(a, b))
    throw new DomainError(
      ErrCode.LICENSE_SIGNATURE_INVALID,
      "License 验签失败（内容被篡改或密钥不匹配）",
    );
  if (new Date(parsed.data.expiresAt).getTime() <= Date.now())
    throw new DomainError(ErrCode.LICENSE_EXPIRED, "License 已过期，拒绝添加");
  return parsed.data;
}

interface LicenseRow {
  code: string;
  payload: unknown;
  status: string;
}

function toState(row: LicenseRow | null): {
  payload: LicensePayload | null;
  status: "NONE" | "VALID" | "EXPIRED";
} {
  if (!row) return { payload: null, status: "NONE" };
  const parsed = licensePayloadSchema.safeParse(row.payload);
  if (!parsed.success) return { payload: null, status: "EXPIRED" };
  if (new Date(parsed.data.expiresAt).getTime() <= Date.now())
    return { payload: parsed.data, status: "EXPIRED" };
  return { payload: parsed.data, status: "VALID" };
}

/** 当前有效授权（惰性降级：过期即按无授权处理并落库 EXPIRED）。 */
export async function validLicense(): Promise<LicensePayload | null> {
  // 写读一致性兜底（S11 e2e 教训：生产形态下 addLicense POST 200 后紧随读偶发 NONE——
  // 事务提交→可见性的微窗口；NONE 时 50ms 复询一次再判，调用方零感知）
  let row = await prisma.license.findFirst({ orderBy: { updatedAt: "desc" } });
  if (!row) {
    await new Promise((r) => setTimeout(r, 50));
    row = await prisma.license.findFirst({ orderBy: { updatedAt: "desc" } });
  }

  const { payload, status } = toState(row);
  if (row && status === "EXPIRED" && row.status !== "EXPIRED") {
    await prisma.license
      .update({ where: { id: row.id }, data: { status: "EXPIRED" } })
      .catch(() => {});
  }
  return status === "VALID" ? payload : null;
}

export async function getLicenseState(): Promise<LicenseStatus> {
  const payload = await validLicense();
  if (!payload)
    return {
      edition: "COMMUNITY",
      expiresAt: null,
      features: [...ENTP_FEATURE_KEYS],
      daysLeft: null,
      lic: null,
      maxUsers: null,
      featureGateEnabled: featureGateEnabled(),
    };
  const daysLeft = Math.max(
    0,
    Math.ceil((new Date(payload.expiresAt).getTime() - Date.now()) / 86_400_000),
  );
  return {
    edition: "ENTERPRISE",
    expiresAt: payload.expiresAt,
    features: payload.features ?? [...ENTP_FEATURE_KEYS],
    daysLeft,
    lic: payload.lic,
    maxUsers: payload.maxUsers ?? null,
    featureGateEnabled: featureGateEnabled(),
  };
}

/**
 * 特性门控（rbac §6 兑现）：无有效 License → 90001；features 不含该特性 → 90005。
 * 企业版端点必须在服务层入口调用；与 RBAC 10003 正交（先权限后门控）。
 * ENTP-009（2026-09-30 开源决策）：门控默认停用——featureGateEnabled()=false 时直接放行，
 * License 体系（签发/验签/状态/增删）全量保留，置 RABBIT_FEATURE_GATE=1 一键恢复企业口径。
 */
export async function assertEntpEnabled(feature: EntpFeature): Promise<void> {
  if (!featureGateEnabled()) return;
  const payload = await validLicense();
  if (!payload) throw new DomainError(ErrCode.LICENSE_REQUIRED, "该功能需企业版授权（License）");
  const features = payload.features ?? [...ENTP_FEATURE_KEYS];
  if (!features.includes(feature))
    throw new DomainError(ErrCode.LICENSE_FEATURE_NOT_ENABLED, `当前授权未包含特性 ${feature}`);
}

/** 非抛错判定（消费侧回退用，如 ENTP-005 dispatch 模板渲染）。ENTP-009：门控停用期恒 true。 */
export async function entpFeatureActive(feature: EntpFeature): Promise<boolean> {
  if (!featureGateEnabled()) return true;
  const payload = await validLicense().catch(() => null);
  if (!payload) return false;
  const features = payload.features ?? [...ENTP_FEATURE_KEYS];
  return features.includes(feature);
}

/** License 下有效用户上限（ENTP-008）：有= payload.maxUsers ?? Infinity；无=config.userLimit。
 *  ENTP-009：开源全功能期不设用户上限（config.userLimit 仅门控恢复后生效）。 */
export async function effectiveUserLimit(): Promise<number> {
  if (!featureGateEnabled()) return Number.POSITIVE_INFINITY;
  const payload = await validLicense();
  if (!payload) return config.userLimit;
  return payload.maxUsers ?? Number.POSITIVE_INFINITY;
}

export async function addLicense(code: string): Promise<LicenseStatus> {
  const payload = verifyLicenseCode(code); // 三重校验：格式/验签/期限
  await prisma.$transaction([
    prisma.license.deleteMany({}),
    prisma.license.create({
      data: { code: code.trim(), status: "VALID", payload: payload as unknown as object },
    }),
  ]);
  // 写读一致性（S11 e2e 教训：embedded-pg 下 POST 返回后紧随的公开状态 GET 偶发读回 NONE——
  // 回源 read-back 至本行可见（≤2s），保证「addLicense 200 = 状态已可读」的调用方契约）
  const deadline = Date.now() + 2000;
  for (;;) {
    const row = await prisma.license.findFirst({
      where: { status: "VALID" },
      select: { id: true },
    });
    if (row || Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  return getLicenseState();
}

export async function removeLicense(): Promise<LicenseStatus> {
  await prisma.license.deleteMany({});
  return getLicenseState();
}

export { getLicenseState as licenseStatus };
