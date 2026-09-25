/** 种子数据：幂等，可重复执行（rules/database §6.5）。 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.systemParam.upsert({
    where: { key: 'base' },
    update: {},
    create: {
      key: 'base',
      value: {
        siteUrl: 'http://localhost:3000',
        fileMaxSizeMb: 50,
        logRetentionDays: 90,
        changeLogRetentionDays: 90,
      },
    },
  });
  // 默认资源池（社区版唯一，isDefault=true）
  await prisma.resourcePool.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: '默认资源池',
      type: 'NODE',
      isDefault: true,
      maxConcurrency: 4,
    },
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
