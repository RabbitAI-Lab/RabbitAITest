/** PROJ-001：组织成员、项目生命周期（软删 30 天可撤销/结束只读）、项目成员与信息编辑。 */
import { DomainError, ErrCode } from "@rabbit/shared";
import type { ProjectUpdateInput } from "@rabbit/shared";
import { prisma, initOrgAndProjectPresets } from "@rabbit/db";

// ── 组织成员（PROJ-001 成员搜索添加数据源）──

export async function listOrgMembers(
  orgId: string,
  q: { keyword?: string; page: number; pageSize: number },
) {
  const where = {
    orgId,
    user: {
      deletedAt: null,
      ...(q.keyword
        ? {
            OR: [
              { email: { contains: q.keyword, mode: "insensitive" as const } },
              { name: { contains: q.keyword, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
  };
  const [total, items] = await Promise.all([
    prisma.orgMember.count({ where }),
    prisma.orgMember.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      select: {
        userId: true,
        createdAt: true,
        user: { select: { id: true, email: true, name: true, phone: true } },
      },
    }),
  ]);
  return { total, items: items.map((m) => ({ ...m.user, joinedAt: m.createdAt.toISOString() })) };
}

// ── 组织项目列表/新建（PROJ-001）──

export async function listOrgProjects(
  orgId: string,
  query: { deleted?: string; keyword?: string },
) {
  const where = {
    orgId,
    ...(query.deleted === "1" ? { deletedAt: { not: null } } : { deletedAt: null }),
    ...(query.keyword ? { name: { contains: query.keyword, mode: "insensitive" as const } } : {}),
  };
  const projects = await prisma.project.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      num: true,
      description: true,
      status: true,
      deletedAt: true,
      purgeAt: true,
      createdAt: true,
      modules: true,
      _count: { select: { members: true } },
    },
  });
  return {
    total: projects.length,
    items: projects.map((p) => ({
      id: p.id,
      name: p.name,
      num: p.num,
      description: p.description,
      status: p.status,
      modules: p.modules,
      memberCount: p._count.members,
      deletedAt: p.deletedAt?.toISOString() ?? null,
      purgeAt: p.purgeAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
    })),
  };
}

export async function createOrgProject(
  orgId: string,
  actorId: string,
  input: { name: string; description?: string },
) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
      "projects",
      orgId,
    );
    const rows = (await tx.$queryRawUnsafe<{ n: bigint | number }[]>(
      "SELECT COALESCE(MAX(num), 0) + 1 AS n FROM projects WHERE org_id = $1",
      orgId,
    )) as { n: bigint | number }[];
    const num = Number(rows[0]?.n ?? 1); // 组织内递增（advisory lock 按组织）
    const project = await tx.project.create({
      data: { orgId, name: input.name, description: input.description, num },
      select: { id: true, name: true },
    });
    await tx.projectMember.create({
      data: { projectId: project.id, userId: actorId, role: "OWNER" },
    });
    for (const [scene, name] of [
      ["case", "未规划用例"],
      ["api", "未规划接口"],
    ] as const) {
      await tx.moduleNode.create({ data: { projectId: project.id, scene, name, isDefault: true } });
    }
    await initOrgAndProjectPresets(tx, orgId, project.id, actorId);
    return project;
  });
}

// ── 项目信息与状态（PROJ-001）──

export async function getProjectInfo(projectId: string) {
  const p = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: {
      id: true,
      name: true,
      num: true,
      description: true,
      modules: true,
      status: true,
      createdAt: true,
      org: { select: { id: true, name: true } },
    },
  });
  if (!p) throw new DomainError(ErrCode.PROJECT_NOT_FOUND, "项目不存在或无权访问");
  return {
    ...p,
    modules: p.modules as Record<string, boolean>,
    createdAt: p.createdAt.toISOString(),
  };
}

export async function updateProject(projectId: string, actorId: string, input: ProjectUpdateInput) {
  const existing = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { id: true, status: true },
  });
  if (!existing) throw new DomainError(ErrCode.PROJECT_NOT_FOUND, "项目不存在或无权访问");
  if (existing.status === "ENDED")
    throw new DomainError(ErrCode.PROJECT_ENDED, "项目已结束，禁止修改");
  const updated = await prisma.project.update({
    where: { id: projectId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.modules !== undefined ? { modules: input.modules } : {}),
    },
    select: { id: true, name: true, description: true, modules: true, status: true },
  });
  await prisma.auditLog
    .create({
      data: {
        userId: actorId,
        scope: "project",
        projectId,
        action: "project.update",
        objectType: "project",
        objectId: projectId,
      },
    })
    .catch(() => undefined);
  return { ...updated, modules: updated.modules as Record<string, boolean> };
}

/** 结束=只读（写端点统一 422 code 10005，由守卫 requireWritable 兜底）；开启恢复。 */
export async function setProjectEnded(projectId: string, actorId: string, ended: boolean) {
  const r = await prisma.project.updateMany({
    where: { id: projectId, deletedAt: null },
    data: { status: ended ? "ENDED" : "ENABLED" },
  });
  if (r.count === 0) throw new DomainError(ErrCode.PROJECT_NOT_FOUND, "项目不存在或无权访问");
  await prisma.auditLog
    .create({
      data: {
        userId: actorId,
        scope: "project",
        projectId,
        action: ended ? "project.close" : "project.reopen",
        objectType: "project",
        objectId: projectId,
      },
    })
    .catch(() => undefined);
  return { id: projectId, status: ended ? "ENDED" : "ENABLED" };
}

/** 软删（30 天后由清理 job 物理删除）与撤销。 */
export async function softDeleteProject(projectId: string, actorId: string) {
  const r = await prisma.project.updateMany({
    where: { id: projectId, deletedAt: null },
    data: { deletedAt: new Date(), purgeAt: new Date(Date.now() + 30 * 86400_000) },
  });
  if (r.count === 0) throw new DomainError(ErrCode.PROJECT_NOT_FOUND, "项目不存在或已在回收站");
  await prisma.auditLog
    .create({
      data: {
        userId: actorId,
        scope: "project",
        projectId,
        action: "project.delete",
        objectType: "project",
        objectId: projectId,
      },
    })
    .catch(() => undefined);
}

export async function restoreProject(projectId: string, actorId: string) {
  const r = await prisma.project.updateMany({
    where: { id: projectId, deletedAt: { not: null } },
    data: { deletedAt: null, purgeAt: null },
  });
  if (r.count === 0) throw new DomainError(ErrCode.PROJECT_NOT_FOUND, "项目不在回收站");
  await prisma.auditLog
    .create({
      data: {
        userId: actorId,
        scope: "project",
        projectId,
        action: "project.restore",
        objectType: "project",
        objectId: projectId,
      },
    })
    .catch(() => undefined);
  return { id: projectId };
}

/** 物理删除（级联手写：横切表 → 业务子表 → 主表；清理 job 对超期 purgeAt 项目调用）。 */
export async function purgeProject(projectId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const caseIds = (
      await tx.functionalCase.findMany({ where: { projectId }, select: { id: true } })
    ).map((c) => c.id);
    const bugIds = (await tx.bug.findMany({ where: { projectId }, select: { id: true } })).map(
      (b) => b.id,
    );
    const reviewIds = (
      await tx.caseReview.findMany({ where: { projectId }, select: { id: true } })
    ).map((r) => r.id);
    const planIds = (
      await tx.testPlan.findMany({ where: { projectId }, select: { id: true } })
    ).map((p) => p.id);
    const execTaskIds = (
      await tx.execTask.findMany({ where: { projectId }, select: { id: true } })
    ).map((t) => t.id);
    const entityIds = [
      ...caseIds.map((id) => `functional_case:${id}`),
      ...bugIds.map((id) => `bug:${id}`),
      ...planIds.map((id) => `test_plan:${id}`),
    ];
    // 横切
    if (entityIds.length) {
      await tx.comment.deleteMany({ where: { entityId: { in: entityIds } } });
      await tx.follow.deleteMany({ where: { entityId: { in: entityIds } } });
    }
    await tx.changeLog.deleteMany({ where: { entityId: { in: entityIds } } });
    await tx.attachment.deleteMany({ where: { projectId } });
    // case 域
    await tx.caseDependency.deleteMany({
      where: { OR: [{ preCaseId: { in: caseIds } }, { postCaseId: { in: caseIds } }] },
    });
    await tx.reviewCase.deleteMany({ where: { reviewId: { in: reviewIds } } });
    await tx.caseReview.deleteMany({ where: { projectId } });
    // plan 域
    await tx.planCaseRef.deleteMany({ where: { planId: { in: planIds } } });
    await tx.testPoint.deleteMany({ where: { planId: { in: planIds } } });
    await tx.report.deleteMany({ where: { projectId } });
    await tx.testPlan.deleteMany({ where: { projectId } });
    // bug 域
    await tx.bugCaseRef.deleteMany({ where: { bugId: { in: bugIds } } });
    await tx.bug.deleteMany({ where: { projectId } });
    // exec 域
    await tx.execStepResult.deleteMany({ where: { item: { taskId: { in: execTaskIds } } } });
    await tx.execItem.deleteMany({ where: { taskId: { in: execTaskIds } } });
    await tx.execTask.deleteMany({ where: { projectId } });
    // 其余
    await tx.functionalCase.deleteMany({ where: { projectId } });
    await tx.apiCase.deleteMany({ where: { projectId } });
    await tx.apiMock.deleteMany({ where: { api: { projectId } } });
    await tx.apiDefinition.deleteMany({ where: { projectId } });
    await tx.scenarioStep.deleteMany({ where: { scenario: { projectId } } });
    await tx.scenario.deleteMany({ where: { projectId } });
    await tx.environment.deleteMany({ where: { projectId } });
    await tx.envGroup.deleteMany({ where: { projectId } });
    await tx.globalParam.deleteMany({ where: { projectId } });
    await tx.fileItem.deleteMany({ where: { projectId } });
    await tx.fileRepo.deleteMany({ where: { projectId } });
    await tx.publicScript.deleteMany({ where: { projectId } });
    await tx.falseAlarmRule.deleteMany({ where: { projectId } });
    await tx.appSetting.deleteMany({ where: { projectId } });
    await tx.template.deleteMany({ where: { projectId } });
    await tx.moduleNode.deleteMany({ where: { projectId } });
    await tx.groupMember.deleteMany({ where: { group: { projectId } } });
    await tx.group.deleteMany({ where: { projectId } });
    await tx.projectMember.deleteMany({ where: { projectId } });
    await tx.auditLog.deleteMany({ where: { projectId } });
    await tx.project.delete({ where: { id: projectId } });
  });
}

// ── 项目成员（PROJ-001）──

export async function listProjectMembers(
  projectId: string,
  q: { keyword?: string; page: number; pageSize: number },
) {
  const where = {
    projectId,
    user: {
      deletedAt: null,
      ...(q.keyword
        ? {
            OR: [
              { email: { contains: q.keyword, mode: "insensitive" as const } },
              { name: { contains: q.keyword, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
  };
  const [total, items] = await Promise.all([
    prisma.projectMember.count({ where }),
    prisma.projectMember.findMany({
      where,
      orderBy: { createdAt: "asc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      select: {
        userId: true,
        role: true,
        createdAt: true,
        user: { select: { id: true, email: true, name: true } },
      },
    }),
  ]);
  // 成员所在项目组（展示用）
  const userIds = items.map((i) => i.userId);
  const gms = userIds.length
    ? await prisma.groupMember.findMany({
        where: { userId: { in: userIds }, group: { projectId } },
        include: { group: { select: { name: true, isSystem: true } } },
      })
    : [];
  return {
    total,
    items: items.map((m) => ({
      ...m.user,
      role: m.role,
      joinedAt: m.createdAt.toISOString(),
      groups: gms
        .filter((g) => g.userId === m.userId)
        .map((g) => ({ name: g.group.name, isSystem: g.group.isSystem })),
    })),
  };
}

/** 批量添加成员：入 ProjectMember + 默认进「项目成员」组（PROJ-001）。 */
export async function addProjectMembers(projectId: string, actorId: string, userIds: string[]) {
  const org = await prisma.project.findFirst({ where: { id: projectId }, select: { orgId: true } });
  if (!org) throw new DomainError(ErrCode.PROJECT_NOT_FOUND, "项目不存在");
  const users = await prisma.user.findMany({
    where: { id: { in: userIds }, deletedAt: null },
    select: { id: true },
  });
  if (users.length !== userIds.length)
    throw new DomainError(ErrCode.VALIDATION_FAILED, "含不存在或已删除的用户");
  // 组织成员校验（从组织用户搜索添加）
  const orgMembers = await prisma.orgMember.findMany({
    where: { orgId: org.orgId, userId: { in: userIds } },
    select: { userId: true },
  });
  const orgUserIds = new Set(orgMembers.map((m) => m.userId));
  const notInOrg = userIds.filter((id) => !orgUserIds.has(id));
  if (notInOrg.length)
    throw new DomainError(ErrCode.VALIDATION_FAILED, "仅可添加组织成员（先由系统管理员创建用户）");
  const memberGroup = await prisma.group.findFirst({
    where: { scope: "project", projectId, name: "项目成员" },
    select: { id: true },
  });
  let added = 0;
  for (const u of users) {
    const pm = await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId, userId: u.id } },
      update: {},
      create: { projectId, userId: u.id },
    });
    if (pm) added += 1;
    if (memberGroup) {
      await prisma.groupMember.upsert({
        where: { groupId_userId: { groupId: memberGroup.id, userId: u.id } },
        update: {},
        create: { groupId: memberGroup.id, userId: u.id },
      });
    }
  }
  await prisma.auditLog
    .create({
      data: {
        userId: actorId,
        scope: "project",
        projectId,
        action: "project.members.add",
        objectType: "project",
        objectId: projectId,
        detail: { count: users.length },
      },
    })
    .catch(() => undefined);
  return { added };
}

/** 移除成员：同时移出该项目全部用户组。 */
export async function removeProjectMember(projectId: string, actorId: string, userId: string) {
  const r = await prisma.projectMember.deleteMany({ where: { projectId, userId } });
  if (r.count === 0) throw new DomainError(ErrCode.VALIDATION_FAILED, "该用户不是项目成员");
  await prisma.groupMember.deleteMany({ where: { userId, group: { projectId } } });
  await prisma.auditLog
    .create({
      data: {
        userId: actorId,
        scope: "project",
        projectId,
        action: "project.members.remove",
        objectType: "user",
        objectId: userId,
      },
    })
    .catch(() => undefined);
  return { removed: r.count };
}

// ── P-2：组织成员加入/移出（coverage-audit §10；对齐基线：组织管理员拉系统用户进组织）──

/** 批量添加组织成员（ORG_MEMBER:UPDATE）：校验用户存在且未入组织。 */
export async function addOrgMembers(orgId: string, userIds: string[]) {
  const org = await prisma.organization.findFirst({ where: { id: orgId, deletedAt: null }, select: { id: true } });
  if (!org) throw new DomainError(ErrCode.PROJECT_NOT_FOUND, '组织不存在或无权访问');
  const users = await prisma.user.findMany({ where: { id: { in: userIds }, deletedAt: null }, select: { id: true } });
  if (users.length !== userIds.length) throw new DomainError(ErrCode.VALIDATION_FAILED, '含不存在或已删除的用户');
  const existing = await prisma.orgMember.findMany({ where: { orgId, userId: { in: userIds } }, select: { userId: true } });
  const existingSet = new Set(existing.map((e) => e.userId));
  let added = 0;
  for (const u of users) {
    if (existingSet.has(u.id)) continue;
    await prisma.orgMember.create({ data: { orgId, userId: u.id } });
    added += 1;
  }
  return { added };
}

/** 移出组织成员：组织 owner 不可移除；联动清除其项目内成员与项目组（保持一致性）。 */
export async function removeOrgMember(orgId: string, userId: string) {
  const org = await prisma.organization.findFirst({ where: { id: orgId }, select: { ownerId: true } });
  if (!org) throw new DomainError(ErrCode.PROJECT_NOT_FOUND, '组织不存在或无权访问');
  if (org.ownerId === userId) throw new DomainError(ErrCode.VALIDATION_FAILED, '组织所有者不可移除');
  const r = await prisma.orgMember.deleteMany({ where: { orgId, userId } });
  if (r.count === 0) throw new DomainError(ErrCode.VALIDATION_FAILED, '该用户不是组织成员');
  // 联动：清除该组织项目内此人的成员关系与项目组成员资格
  const projects = await prisma.project.findMany({ where: { orgId }, select: { id: true } });
  const pids = projects.map((p) => p.id);
  if (pids.length) {
    await prisma.projectMember.deleteMany({ where: { projectId: { in: pids }, userId } });
    await prisma.groupMember.deleteMany({ where: { userId, group: { projectId: { in: pids } } } });
  }
  return { removed: r.count };
}

/** P-2：可加入组织的候选用户（系统用户 - 已在组织；ORG_MEMBER:UPDATE 可调，不暴露系统管理端点）。 */
export async function orgMemberCandidates(orgId: string, q: { keyword?: string; page: number; pageSize: number }) {
  const where = {
    deletedAt: null,
    ...(q.keyword
      ? { OR: [{ email: { contains: q.keyword, mode: 'insensitive' as const } }, { name: { contains: q.keyword, mode: 'insensitive' as const } }] }
      : {}),
  };
  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      select: { id: true, email: true, name: true, phone: true },
    }),
  ]);
  const members = await prisma.orgMember.findMany({ where: { orgId }, select: { userId: true } });
  const memberSet = new Set(members.map((m) => m.userId));
  return { total, items: users.filter((u) => !memberSet.has(u.id)) };
}
