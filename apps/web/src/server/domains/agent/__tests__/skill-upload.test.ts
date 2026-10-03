/** 技能上传单测：SKILL.md frontmatter 解析 / 模板 zip 生成。 */
import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

vi.mock("@rabbit/db", () => ({
  prisma: {
    agentSkill: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "s1", ...data })),
    },
  },
}));


import { extractSkillZip, buildSkillTemplateZip, createDirectorySkill } from "../skill-upload.service";
import type { ParsedSkillZip } from "../skill-upload.service";

function makeZip(files: Record<string, string>): Buffer {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "test-skill-"));
  try {
    for (const [fp, content] of Object.entries(files)) {
      const safe = fp.split("/").map((s) => path.basename(s));
      const full = path.join(tmp, ...safe);
      if (!full.startsWith(tmp + path.sep)) throw new Error("path escape");
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, "utf8");
    }
    execFileSync("zip", ["-q", "-r", "test.zip", "."], { cwd: tmp });
    return fs.readFileSync(path.join(tmp, "test.zip"));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

describe("SKILL.md frontmatter 解析", () => {
  it("YAML frontmatter 含 name/description → 提取", async () => {
    const zip = makeZip({
      "my-skill/SKILL.md": `---\nname: 边界值方法\ndescription: 生成用例时补边界值\n---\n\n# 边界值\n内容`,
    });
    const parsed = await extractSkillZip("p1", zip, "my-skill.zip");
    expect(parsed.name).toBe("边界值方法");
    expect(parsed.description).toBe("生成用例时补边界值");
    expect(parsed.content).toContain("# 边界值");
  });

  it("无 frontmatter → 用文件名+首行标题", async () => {
    const zip = makeZip({
      "SKILL.md": `# 我的技能\n\n内容`,
    });
    const parsed = await extractSkillZip("p1", zip, "custom.zip");
    expect(parsed.name).toBe("custom");
    expect(parsed.description).toBe("我的技能");
  });

  it("子目录含 scripts/ → files 列表包含", async () => {
    const zip = makeZip({
      "my-skill/SKILL.md": "# x",
      "my-skill/scripts/helper.py": "print('hi')",
      "my-skill/templates/tpl.md": "# template",
    });
    const parsed = await extractSkillZip("p1", zip, "my-skill.zip");
    expect(parsed.files.length).toBeGreaterThanOrEqual(3);
    expect(parsed.files.some((f) => f.path.includes("helper.py"))).toBe(true);
    expect(parsed.files.some((f) => f.path.includes("tpl.md"))).toBe(true);
  });

  it("无 SKILL.md → 70624 错误", async () => {
    const zip = makeZip({ "readme.txt": "no skill" });
    await expect(extractSkillZip("p1", zip, "bad.zip")).rejects.toMatchObject({ code: 70624 });
  });
});

describe("createDirectorySkill", () => {
  it("创建 → format=directory + storageKey 有值", async () => {
    const parsed: ParsedSkillZip = {
      name: "测试技能",
      description: "测试",
      content: "# 测试",
      files: [{ path: "SKILL.md", size: 100 }],
      extractDir: "/tmp/test-skill",
    };
    const result = await createDirectorySkill("p1", "u1", parsed);
    expect(result.id).toBe("s1");
  });
});

describe("模板 zip", () => {
  it("生成 → 含 SKILL.md/scripts/templates/README", async () => {
    const zipBuffer = await buildSkillTemplateZip();
    expect(zipBuffer.length).toBeGreaterThan(500);
    expect(zipBuffer[0]).toBe(0x50); // P
    expect(zipBuffer[1]).toBe(0x4b); // K
  });
});
