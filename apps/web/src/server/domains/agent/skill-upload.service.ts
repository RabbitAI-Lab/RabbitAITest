/**
 * AGENT-001 技能上传（zip→目录技能）+ 模板下载。
 * zip 结构：{name}/SKILL.md（必需）+ 可选 scripts/ templates/ 子目录。
 * 解压到本地存储（路径安全：basename 白名单 + 根目录边界断言）。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rm, readFile, writeFile, readdir, stat } from "node:fs/promises";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { DomainError } from "@rabbit/shared";
import { prisma } from "@rabbit/db";

const execFileAsync = promisify(execFile);
const MAX_ZIP_SIZE = 10 * 1024 * 1024;
const MAX_FILES = 100;

function skillStorageRoot(): string {
  return process.env.RABBIT_SKILL_STORAGE ?? path.join(process.cwd(), ".data", "agent-skills");
}

/** 安全路径检查：目标必须在指定根目录内（防穿越） */
function assertSafePath(root: string, target: string): void {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if (!resolvedTarget.startsWith(resolvedRoot + path.sep) && resolvedTarget !== resolvedRoot) {
    throw new DomainError(70624, `路径越界：${target}`);
  }
}

export interface ParsedSkillZip {
  name: string;
  description: string;
  content: string;
  files: { path: string; size: number }[];
  extractDir: string;
}

export async function extractSkillZip(
  projectId: string,
  zipBuffer: Buffer,
  originalName: string,
): Promise<ParsedSkillZip> {
  if (zipBuffer.length > MAX_ZIP_SIZE) {
    throw new DomainError(70624, `zip 超过 10MB 上限（实际 ${(zipBuffer.length / 1024 / 1024).toFixed(1)}MB）`);
  }

  const skillId = randomUUID();
  const extractDir = path.join(skillStorageRoot(), projectId, skillId);
  await mkdir(extractDir, { recursive: true });

  // 写入临时 zip → execFile unzip（参数数组，无 shell 拼接——防注入）
  const tmpZip = path.join(skillStorageRoot(), projectId, `${skillId}.zip`);
  assertSafePath(path.join(skillStorageRoot(), projectId), tmpZip);
  await writeFile(tmpZip, zipBuffer);
  try {
    await execFileAsync("/usr/bin/unzip", ["-q", "-o", tmpZip, "-d", extractDir]);
  } catch {
    // 回退到 PATH 中的 unzip
    try {
      await execFileAsync("unzip", ["-q", "-o", tmpZip, "-d", extractDir]);
    } catch {
      await rm(tmpZip, { force: true });
      await rm(extractDir, { recursive: true, force: true });
      throw new DomainError(70624, "zip 解压失败——请确认是有效的 zip 文件");
    }
  }
  await rm(tmpZip, { force: true });

  // 找 SKILL.md（根目录或单层子目录）
  const entries = await readdir(extractDir, { withFileTypes: true });
  let skillMdPath: string | null = null;
  let rootDir: string = extractDir;

  const rootSkillMd = path.join(extractDir, "SKILL.md");
  try {
    await readFile(rootSkillMd, "utf8");
    skillMdPath = rootSkillMd;
  } catch {
    for (const e of entries) {
      if (e.isDirectory()) {
        const safeDir = path.join(extractDir, path.basename(e.name));
        assertSafePath(extractDir, safeDir);
        const sub = path.join(safeDir, "SKILL.md");
        try {
          await readFile(sub, "utf8");
          skillMdPath = sub;
          rootDir = safeDir;
          break;
        } catch {
          continue;
        }
      }
    }
  }

  if (!skillMdPath) {
    await rm(extractDir, { recursive: true, force: true });
    throw new DomainError(70624, "zip 中未找到 SKILL.md——请确保压缩包根目录或唯一子目录内有 SKILL.md 文件");
  }

  // 解析 SKILL.md 头部（YAML frontmatter 或 # 标题）
  const skillMdContent = await readFile(skillMdPath, "utf8");
  let name = path.basename(originalName.replace(/\.zip$/i, "")).slice(0, 64);
  let description = "";

  const fmMatch = skillMdContent.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch?.[1]) {
    const fm = fmMatch[1];
    const nameMatch = fm?.match(/^name:\s*(.+)$/m);
    const descMatch = fm?.match(/^description:\s*(.+)$/m);
    if (nameMatch?.[1]) name = nameMatch[1].trim().slice(0, 64);
    if (descMatch?.[1]) description = descMatch[1].trim().slice(0, 512);
  }
  if (!description) {
    const h1 = skillMdContent.match(/^#\s+(.+)$/m);
    description = h1?.[1]?.slice(0, 512) ?? "目录技能（zip 上传）";
  }

  // 列出所有文件（排除隐藏文件；路径安全断言）
  const allFiles: { path: string; size: number }[] = [];
  const walkDir = async (dir: string, prefix: string) => {
    const items = await readdir(dir, { withFileTypes: true });
    for (const item of items) {
      const safeName = path.basename(item.name);
      if (safeName.startsWith(".") || safeName === "__MACOSX") continue;
      const full = path.join(dir, safeName);
      assertSafePath(extractDir, full);
      if (item.isDirectory()) {
        await walkDir(full, `${prefix}${safeName}/`);
      } else {
        const st = await stat(full);
        allFiles.push({ path: `${prefix}${safeName}`, size: st.size });
      }
    }
  };
  await walkDir(rootDir, "");
  if (allFiles.length > MAX_FILES) {
    await rm(extractDir, { recursive: true, force: true });
    throw new DomainError(70624, `文件数超过 ${MAX_FILES} 上限（实际 ${allFiles.length}）`);
  }

  return { name, description, content: skillMdContent, files: allFiles, extractDir };
}

/** 创建目录技能（DB 记录 + storageKey） */
export async function createDirectorySkill(
  projectId: string,
  userId: string,
  parsed: ParsedSkillZip,
): Promise<{ id: string }> {
  const dup = await prisma.agentSkill.findFirst({
    where: { projectId, name: parsed.name, deletedAt: null },
  });
  if (dup) throw new DomainError(70619, `技能名称「${parsed.name}」已存在`);

  const skill = await prisma.agentSkill.create({
    data: {
      projectId,
      name: parsed.name,
      description: parsed.description,
      content: parsed.content,
      format: "directory",
      storageKey: parsed.extractDir,
      enabled: true,
      createdById: userId,
    },
    select: { id: true },
  });
  return skill;
}

/** 模板内容（纯字符串——无 shell 命令） */
const TEMPLATE_FILES: Record<string, string> = {
  "my-skill/SKILL.md": `---
name: my-skill
description: 示例技能——描述何时触发本技能
---

# 我的技能

## 使用时机
当需要……时使用本技能。

## 指令
1. 第一步……
2. 第二步……

## 约束
- 不得……
`,
  "my-skill/scripts/helper.py": `#!/usr/bin/env python3
"""示例脚本——技能可携带辅助脚本"""
def validate_case(name: str, steps: list) -> list[str]:
    errors = []
    if not name.strip():
        errors.append("用例名称不能为空")
    if len(steps) == 0:
        errors.append("至少一个步骤")
    return errors
`,
  "my-skill/templates/case-template.md": `# {{case_name}}

## 前置条件
{{precondition}}

## 步骤
{{#each steps}}
{{@index+1}}. {{this.desc}} → 预期：{{this.expect}}
{{/each}}
`,
  "my-skill/README.md": `# 技能目录结构说明

\`\`\`
my-skill/
├── SKILL.md            # 必需——主指令文件（frontmatter: name + description）
├── README.md           # 可选——说明文件
├── scripts/            # 可选——辅助脚本
│   └── helper.py
└── templates/          # 可选——模板文件
    └── case-template.md
\`\`\`

## 打包上传
将 \`my-skill/\` 目录压缩为 zip 后上传：
\`\`\`bash
zip -r my-skill.zip my-skill/
\`\`\`
`,
};

/** 生成模板 zip（安全：tmpDir 隔离 + execFile 参数数组 + mkdtemp） */
export async function buildSkillTemplateZip(): Promise<Buffer> {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "skill-tpl-"));
  try {
    for (const [filePath, content] of Object.entries(TEMPLATE_FILES)) {
      const safePath = path.join(tmpDir, ...filePath.split("/").map((s) => path.basename(s)));
      assertSafePath(tmpDir, safePath);
      mkdirSync(path.dirname(safePath), { recursive: true });
      writeFileSync(safePath, content, "utf8");
    }
    const zipPath = path.join(tmpDir, "skill-template.zip");
    assertSafePath(tmpDir, zipPath);
    await execFileAsync("zip", ["-q", "-r", zipPath, "my-skill/"], { cwd: tmpDir });
    return readFileSync(zipPath);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** 删除目录技能的存储 */
export async function cleanupSkillStorage(storageKey: string | null): Promise<void> {
  if (!storageKey) return;
  const root = skillStorageRoot();
  const resolved = path.resolve(storageKey);
  if (!resolved.startsWith(path.resolve(root) + path.sep)) return; // 越界则忽略
  await rm(resolved, { recursive: true, force: true }).catch(() => {});
}
