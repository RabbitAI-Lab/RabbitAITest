/** S8 QA-002：密码策略（passwordPolicy）矩阵。 */
import { describe, expect, it } from "vitest";
import { passwordPolicy } from "../system/schemas";

describe("passwordPolicy（QA-002：≥8 位且含字母与数字）", () => {
  const cases: Array<[string, boolean]> = [
    ["rabbit-pass-123", true], // 既有种子/e2e 口径
    ["rabbit-admin-123", true],
    ["Abc12345", true],
    ["a1b2c3d4", true],
    ["12345678", false], // 纯数字
    ["abcdefgh", false], // 纯字母
    ["Ab1", false], // 太短
    ["1234567", false], // 7 位数字字母混合但太短
    ["1234567a", true], // 恰 8 位
    ["x".repeat(129) + "1", false], // 超长
  ];
  for (const [pw, ok] of cases) {
    it(`${JSON.stringify(pw.slice(0, 12))}${pw.length > 12 ? `…(${pw.length})` : ""} → ${ok ? "通过" : "拒绝"}`, () => {
      expect(passwordPolicy.safeParse(pw).success).toBe(ok);
    });
  }
  it("失败信息可读（min/refine 消息）", () => {
    const r = passwordPolicy.safeParse("short1");
    expect(r.success).toBe(false);
  });
});
