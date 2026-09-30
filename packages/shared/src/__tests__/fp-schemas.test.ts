/** S-future shared 契约单测：占位权限点入清单与预置组 / 模块开关缺省语义 / 新错误码。 */
import { describe, expect, it } from "vitest";
import {
  PERMISSION_POINTS,
  PRESET_GROUP_PERMISSIONS,
  moduleFlagsSchema,
  ErrCode,
  ErrMsg,
} from "../index";

describe("LOAD-001-T1 / UIT-001-T1 占位权限点", () => {
  it("PROJECT_LOAD:READ / PROJECT_UIT:READ 入清单", () => {
    expect(PERMISSION_POINTS).toContain("PROJECT_LOAD:READ");
    expect(PERMISSION_POINTS).toContain("PROJECT_UIT:READ");
  });
  it("预置组映射：SYSTEM_ADMIN（全量）/PROJECT_ADMIN 授予；S11 起 PROJECT_MEMBER 授予 READ（与 PROJECT_API:READ 同口径，写/执行仍门禁）", () => {
    expect(PRESET_GROUP_PERMISSIONS.SYSTEM_ADMIN).toContain("PROJECT_LOAD:READ");
    expect(PRESET_GROUP_PERMISSIONS.PROJECT_ADMIN).toContain("PROJECT_UIT:READ");
    expect(PRESET_GROUP_PERMISSIONS.PROJECT_ADMIN).toContain("PROJECT_LOAD:READ");
    expect(PRESET_GROUP_PERMISSIONS.PROJECT_MEMBER).toContain("PROJECT_LOAD:READ");
    expect(PRESET_GROUP_PERMISSIONS.PROJECT_MEMBER).toContain("PROJECT_UIT:READ");
    expect(PRESET_GROUP_PERMISSIONS.PROJECT_MEMBER).not.toContain("PROJECT_LOAD:CREATE");
    expect(PRESET_GROUP_PERMISSIONS.PROJECT_MEMBER).not.toContain("PROJECT_UIT:EXECUTE");
  });
});

describe("模块开关缺省语义（ENTP-009 起六键缺省全开；显式 false 持久化不翻转）", () => {
  it("空对象 parse 后六键均 true（开源全功能口径，2026-09-30 前 load/uit 缺省为关）", () => {
    const m = moduleFlagsSchema.parse({});
    expect(m).toMatchObject({
      case: true,
      api: true,
      plan: true,
      bug: true,
      load: true,
      uit: true,
    });
  });
  it("显式开关可持久化（管理员关闭 load/uit 不被缺省翻转）", () => {
    expect(moduleFlagsSchema.parse({ load: true, uit: true }).load).toBe(true);
    expect(moduleFlagsSchema.parse({ load: false, uit: false }).uit).toBe(false);
  });
});

describe("S-future 错误码分段与文案", () => {
  it.each([
    [ErrCode.OPEN_SYNC_VALIDATION_FAILED, 10023],
    [ErrCode.OPEN_SYNC_LIMIT_EXCEEDED, 10024],
    [ErrCode.OPEN_CAPTURE_INVALID, 10025],
    [ErrCode.POOL_CONFIG_INVALID, 50422],
    [ErrCode.POOL_K8S_UNREACHABLE, 50423],
    [ErrCode.REPORT_STATS_INVALID, 60422],
  ])("%s = %i 且有文案", (code, num) => {
    expect(code).toBe(num);
    expect(ErrMsg[code]).toBeTruthy();
  });
});
