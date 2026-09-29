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
  it("预置组映射：SYSTEM_ADMIN（全量）/PROJECT_ADMIN 授予；PROJECT_MEMBER 不授予", () => {
    expect(PRESET_GROUP_PERMISSIONS.SYSTEM_ADMIN).toContain("PROJECT_LOAD:READ");
    expect(PRESET_GROUP_PERMISSIONS.PROJECT_ADMIN).toContain("PROJECT_UIT:READ");
    expect(PRESET_GROUP_PERMISSIONS.PROJECT_ADMIN).toContain("PROJECT_LOAD:READ");
    expect(PRESET_GROUP_PERMISSIONS.PROJECT_MEMBER).not.toContain("PROJECT_LOAD:READ");
  });
});

describe("模块开关缺省语义（load/uit 缺省=关，存量四键缺省=开）", () => {
  it("空对象 parse 后 load/uit=false 而 case/api/plan/bug=true", () => {
    const m = moduleFlagsSchema.parse({});
    expect(m).toMatchObject({
      case: true,
      api: true,
      plan: true,
      bug: true,
      load: false,
      uit: false,
    });
  });
  it("开启语义可持久化", () => {
    expect(moduleFlagsSchema.parse({ load: true, uit: true }).load).toBe(true);
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
