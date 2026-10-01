/** SCM-001 单测：parseScmRepoUrl 三形态解析矩阵 + getScmRepoDetail 平台请求形态（fetch 注入）。 */
import { describe, expect, it } from "vitest";
import { DomainError } from "@rabbit/shared";
import { parseScmRepoUrl, getScmRepoDetail, GitAdapterError } from "../../project/git-adapters";

describe("parseScmRepoUrl（https / scp-ssh / ssh:// 三形态）", () => {
  it("https 官方 GitHub → api.github.com", () => {
    const ref = parseScmRepoUrl("github", "https://github.com/RabbitAI-Lab/rabbit-web.git");
    expect(ref).toMatchObject({
      platform: "github",
      owner: "RabbitAI-Lab",
      repo: "rabbit-web",
      host: "github.com",
      apiBase: "https://api.github.com",
    });
  });

  it("GitHub Enterprise 自建 → /api/v3", () => {
    const ref = parseScmRepoUrl("github", "https://git.rabbit.inner/qa/demo.git");
    expect(ref.apiBase).toBe("https://git.rabbit.inner/api/v3");
  });

  it("GitLab 官方/自建 → /api/v4（host 归一）", () => {
    expect(parseScmRepoUrl("gitlab", "https://gitlab.com/backend/order-service.git").apiBase).toBe(
      "https://gitlab.com/api/v4",
    );
    expect(parseScmRepoUrl("gitlab", "http://git.rabbit.inner:8080/be/svc.git").apiBase).toBe(
      "http://git.rabbit.inner:8080/api/v4",
    );
  });

  it("Gitee 官方 → gitee.com/api/v5；自建 host 同形", () => {
    expect(parseScmRepoUrl("gitee", "https://gitee.com/rabbit-lab/testdata.git").apiBase).toBe(
      "https://gitee.com/api/v5",
    );
    expect(parseScmRepoUrl("gitea", "https://git.rabbit.inner/qa/sdk-demo.git").apiBase).toBe(
      "https://git.rabbit.inner/api/v1",
    );
  });

  it("custom → apiBase=null（仅保存不验证）", () => {
    const ref = parseScmRepoUrl("custom", "https://scm.example.cn/svn-mirror/legacy-v1.git");
    expect(ref.apiBase).toBeNull();
    expect(ref.owner).toBe("svn-mirror");
    expect(ref.repo).toBe("legacy-v1");
  });

  it("scp 形态 ssh：git@host:owner/repo.git（绝不出站，解析出 owner/repo）", () => {
    const ref = parseScmRepoUrl("gitlab", "git@git.rabbit.inner:backend/order-service.git");
    expect(ref).toMatchObject({
      host: "git.rabbit.inner",
      owner: "backend",
      repo: "order-service",
    });
    expect(ref.apiBase).toBe("https://git.rabbit.inner/api/v4");
  });

  it("ssh:// 形态（含端口）", () => {
    const ref = parseScmRepoUrl("github", "ssh://git@github.com:22/RabbitAI-Lab/rabbit-web.git");
    expect(ref).toMatchObject({ host: "github.com", owner: "RabbitAI-Lab", repo: "rabbit-web" });
    expect(ref.apiBase).toBe("https://api.github.com");
  });

  it("https 子路径部署取末两段（GHE 前缀形态）", () => {
    const ref = parseScmRepoUrl("github", "https://ghe.corp.cn/git/o/r.git");
    expect(ref.owner).toBe("o");
    expect(ref.repo).toBe("r");
  });

  it("非法地址 → 20422", () => {
    expect(() => parseScmRepoUrl("github", "not-a-url")).toThrow(DomainError);
    expect(() => parseScmRepoUrl("github", "ftp://github.com/o/r")).toThrow(DomainError);
    expect(() => parseScmRepoUrl("github", "https://github.com/onlyowner")).toThrow(DomainError);
  });
});

/** fetch 注入桩：按 URL 前缀路由 JSON。 */
function fakeFetch(
  routes: Record<string, unknown | (() => Response)>,
): Parameters<typeof getScmRepoDetail>[2] {
  return async (url) => {
    for (const [prefix, v] of Object.entries(routes)) {
      if (String(url).startsWith(prefix)) {
        if (typeof v === "function") return v();
        return new Response(JSON.stringify(v), { status: 200 });
      }
    }
    return new Response("{}", { status: 404 });
  };
}

describe("getScmRepoDetail（contents 族 / gitlab 两形态）", () => {
  const ghRef = parseScmRepoUrl("github", "https://github.com/o/r.git");
  const glRef = parseScmRepoUrl("gitlab", "https://gitlab.com/o/r.git");

  it("github：repo 详情 + 最近提交归一", async () => {
    const seen: string[] = [];
    const detail = await getScmRepoDetail(ghRef, { token: "tk" }, async (url, init) => {
      seen.push(String(url));
      if (String(url).endsWith("/repos/o/r")) {
        return new Response(JSON.stringify({ default_branch: "main", private: true }), {
          status: 200,
        });
      }
      expect((init?.headers as Record<string, string>).authorization).toContain("Basic ");
      return new Response(
        JSON.stringify([
          {
            sha: "abc123",
            commit: {
              message: "feat: nav refresh\n\nbody",
              author: { date: "2026-10-01T02:00:00Z" },
            },
          },
        ]),
        { status: 200 },
      );
    });
    expect(detail).toMatchObject({
      defaultBranch: "main",
      visibility: "private",
      latestCommit: {
        sha: "abc123",
        message: "feat: nav refresh",
        committedAt: "2026-10-01T02:00:00Z",
      },
    });
    expect(seen[1]).toContain("/commits?per_page=1");
  });

  it("gitlab：projects/{encoded} + repository/commits（Bearer）", async () => {
    const detail = await getScmRepoDetail(glRef, { token: "tk" }, async (url, init) => {
      const u = String(url);
      if (u.includes("/projects/o%2Fr/repository/commits")) {
        return new Response(
          JSON.stringify([
            { id: "def456", message: "fix: bug", committed_date: "2026-09-30T10:00:00Z" },
          ]),
          { status: 200 },
        );
      }
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer tk");
      return new Response(JSON.stringify({ default_branch: "develop", visibility: "internal" }), {
        status: 200,
      });
    });
    expect(detail.defaultBranch).toBe("develop");
    expect(detail.visibility).toBe("internal");
    expect(detail.latestCommit?.sha).toBe("def456");
  });

  it("账密（gitea/gitee）→ Basic username:password", async () => {
    const giteaRef = parseScmRepoUrl("gitea", "https://git.rabbit.inner/qa/demo.git");
    let auth = "";
    await getScmRepoDetail(giteaRef, { username: "qa-bot", password: "pw" }, async (url, init) => {
      auth = (init?.headers as Record<string, string>).authorization ?? "";
      if (String(url).endsWith("/repos/qa/demo")) {
        return new Response(JSON.stringify({ default_branch: "master" }), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });
    expect(auth).toBe(`Basic ${Buffer.from("qa-bot:pw").toString("base64")}`);
  });

  it("custom（apiBase=null）→ 422 不支持验证", async () => {
    const ref = parseScmRepoUrl("custom", "https://scm.example.cn/a/b.git");
    await expect(getScmRepoDetail(ref, null, fakeFetch({}))).rejects.toMatchObject({
      status: 422,
    });
  });

  it("401 → GitAdapterError（服务层映射 INVALID_CRED）", async () => {
    await expect(
      getScmRepoDetail(ghRef, { token: "bad" }, async () => new Response("{}", { status: 401 })),
    ).rejects.toBeInstanceOf(GitAdapterError);
  });
});
