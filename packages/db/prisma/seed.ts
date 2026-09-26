/** 种子数据：幂等，可重复执行（rules/database §6.5）。Sprint 1 扩展：系统参数四组 + 预置组/模板回填 + 管理员。 */
import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";
import {
  ensureSystemPresetGroups,
  ensureOrgPresetGroups,
  ensureProjectPresetGroups,
  ensureDefaultTemplates,
  ensureBugModule,
  addGroupMember,
} from "../src/presets";

const prisma = new PrismaClient();

/** 系统管理员（SYS-004/SYS-005 演示与接口测试账号；密码仅本地/CI 种子，不入文档） */
const ADMIN_EMAIL = "admin@rabbit.test";
const ADMIN_PASSWORD = "rabbit-admin-123";

async function main() {
  // 1) 系统参数四组（SYS-005）
  for (const [key, value] of [
    ["base", { siteUrl: "http://localhost:3000", loginBanner: "" }],
    ["smtp", { host: "", port: 465, user: "", pass: "", ssl: true, from: "" }],
    ["file", { maxSizeMb: 50 }],
    [
      "cleanup",
      { logRetentionDays: 90, changeLogRetentionDays: 90, lastRunAt: null, lastRunCount: 0 },
    ],
  ] as const) {
    await prisma.systemParam.upsert({
      where: { key },
      update: {},
      create: { key, value: value as object },
    });
  }

  // 2) 默认资源池（社区版唯一，isDefault=true）
  await prisma.resourcePool.upsert({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000001",
      name: "默认资源池",
      type: "NODE",
      isDefault: true,
      maxConcurrency: 4,
    },
  });

  // 3) 系统预置组 + 管理员用户（含管理员自己的组织/项目上下文）
  await ensureSystemPresetGroups(prisma);
  let admin = await prisma.user.findFirst({ where: { email: ADMIN_EMAIL }, select: { id: true } });
  if (!admin) {
    admin = await prisma.user.create({
      data: { email: ADMIN_EMAIL, name: "系统管理员", passwordHash: await hash(ADMIN_PASSWORD) },
      select: { id: true },
    });
    const org = await prisma.organization.create({
      data: { name: "管理员组织", ownerId: admin.id },
      select: { id: true },
    });
    await prisma.orgMember.create({ data: { orgId: org.id, userId: admin.id } });
    const project = await prisma.project.create({
      data: { orgId: org.id, name: "管理项目", num: 1 },
      select: { id: true },
    });
    await prisma.projectMember.create({
      data: { projectId: project.id, userId: admin.id, role: "OWNER" },
    });
    for (const [scene, name] of [
      ["case", "未规划用例"],
      ["api", "未规划接口"],
    ] as const) {
      await prisma.moduleNode.create({
        data: { projectId: project.id, scene, name, isDefault: true },
      });
    }
    await initContext(org.id, project.id, admin.id);
  }
  const sysAdminGroup = await prisma.group.findFirst({
    where: { scope: "system", name: "系统管理员" },
    select: { id: true },
  });
  if (sysAdminGroup) await addGroupMember(prisma, sysAdminGroup.id, admin.id);

  // 4) 存量组织/项目回填（老库升级：预置组 + 默认模板 + bug 模块 + 权限治愈——
  //    org owner → 组织管理员组；项目 OWNER → 项目管理员组；其余成员 → 项目成员组）
  const orgs = await prisma.organization.findMany({ select: { id: true, ownerId: true } });
  for (const org of orgs) {
    await ensureOrgPresetGroups(prisma, org.id);
    await ensureDefaultTemplates(prisma, org.id);
    const orgAdminGroup = await prisma.group.findFirst({ where: { scope: 'org', orgId: org.id, name: '组织管理员' }, select: { id: true } });
    if (orgAdminGroup) await addGroupMember(prisma, orgAdminGroup.id, org.ownerId);
  }
  const projects = await prisma.project.findMany({ select: { id: true } });
  for (const project of projects) {
    await ensureProjectPresetGroups(prisma, project.id);
    await ensureBugModule(prisma, project.id);
    const memberGroup = await prisma.group.findFirst({
      where: { scope: "project", projectId: project.id, name: "项目成员" },
      select: { id: true },
    });
    const members = await prisma.projectMember.findMany({
      where: { projectId: project.id },
      select: { userId: true },
    });
    if (memberGroup) {
      for (const m of members) await addGroupMember(prisma, memberGroup.id, m.userId);
    }
  }
}

async function initContext(orgId: string, projectId: string, userId: string): Promise<void> {
  await ensureOrgPresetGroups(prisma, orgId);
  await ensureProjectPresetGroups(prisma, projectId);
  await ensureDefaultTemplates(prisma, orgId);
  await ensureBugModule(prisma, projectId);
  const orgAdmin = await prisma.group.findFirst({
    where: { scope: "org", orgId, name: "组织管理员" },
    select: { id: true },
  });
  if (orgAdmin) await addGroupMember(prisma, orgAdmin.id, userId);
  const projAdmin = await prisma.group.findFirst({
    where: { scope: "project", projectId, name: "项目管理员" },
    select: { id: true },
  });
  if (projAdmin) await addGroupMember(prisma, projAdmin.id, userId);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
