/** S10 INFRA-008：采样器错误分类器矩阵（枚举=规格 §2.1 契约冻结点）。 */
import { describe, expect, it } from "vitest";
import { classifySamplerError } from "../kernel/errors";

/** 仿真 undici 抛出形态：外层 RequestError(fetch failed) + cause 携带系统错误码。 */
function undiciLike(code: string, causeName = "Error"): Error {
  const cause = Object.assign(new Error(`connect ${code} failed`), {
    name: causeName,
    code,
  });
  return Object.assign(new Error("fetch failed"), { name: "RequestError", cause });
}

describe("INFRA-008 classifySamplerError", () => {
  it("dns：ENOTFOUND / EAI_AGAIN（含 cause 链嵌套）", () => {
    expect(classifySamplerError(undiciLike("ENOTFOUND"))).toBe("dns");
    expect(classifySamplerError(undiciLike("EAI_AGAIN"))).toBe("dns");
    const deep = Object.assign(new Error("outer"), {
      cause: Object.assign(new Error("mid"), { cause: undiciLike("ENOTFOUND") }),
    });
    expect(classifySamplerError(deep)).toBe("dns");
  });

  it("connect：ECONNREFUSED / ENETUNREACH / EHOSTUNREACH", () => {
    expect(classifySamplerError(undiciLike("ECONNREFUSED"))).toBe("connect");
    expect(classifySamplerError(undiciLike("ENETUNREACH"))).toBe("connect");
    expect(classifySamplerError(undiciLike("EHOSTUNREACH"))).toBe("connect");
  });

  it("reset：ECONNRESET / EPIPE", () => {
    expect(classifySamplerError(undiciLike("ECONNRESET"))).toBe("reset");
    expect(classifySamplerError(undiciLike("EPIPE"))).toBe("reset");
  });

  it("tls：证书/握手错误码", () => {
    expect(classifySamplerError(undiciLike("UNABLE_TO_VERIFY_LEAF_SIGNATURE"))).toBe("tls");
    expect(classifySamplerError(undiciLike("ERR_TLS_CERT_ALTNAME_INVALID"))).toBe("tls");
    expect(classifySamplerError(undiciLike("DEPTH_ZERO_SELF_SIGNED_CERT"))).toBe("tls");
  });

  it("timeout：undici HeadersTimeoutError 名 / ETIMEDOUT 码", () => {
    expect(classifySamplerError(undiciLike("", "HeadersTimeoutError"))).toBe("timeout");
    expect(classifySamplerError(undiciLike("ETIMEDOUT"))).toBe("timeout");
  });

  it("url：TypeError / InvalidArgumentError", () => {
    expect(classifySamplerError(new TypeError("Invalid URL"))).toBe("url");
    expect(classifySamplerError(undiciLike("", "InvalidArgumentError"))).toBe("url");
  });

  it("aborted：AbortError", () => {
    const e = Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
    expect(classifySamplerError(e)).toBe("aborted");
  });

  it("other_net：普通 Error 兜底；unknown：null/undefined", () => {
    expect(classifySamplerError(new Error("something odd"))).toBe("other_net");
    expect(classifySamplerError(null)).toBe("unknown");
    expect(classifySamplerError(undefined)).toBe("unknown");
  });

  it("非 Error 字符串抛出物不炸（兜底）", () => {
    expect(typeof classifySamplerError("ECONNREFUSED somewhere")).toBe("string");
  });
});
