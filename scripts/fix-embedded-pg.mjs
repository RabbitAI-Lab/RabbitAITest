#!/usr/bin/env node
/**
 * 修复 pnpm 安装 embedded-postgres 平台包时丢失的 dylib 版本符号链接。
 * 例：libzstd.1.5.7.dylib → libzstd.1.dylib；libicudata.68.2.dylib → libicudata.68.dylib
 * （二进制以主版本名加载；pnpm 不保留包内 symlink 导致 dyld Library not loaded）。
 * 幂等：已存在则跳过。挂在根 package.json postinstall。
 */
import { existsSync, readdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';

function fixLibDir(libDir) {
  if (!existsSync(libDir)) return 0;
  let fixed = 0;
  for (const f of readdirSync(libDir)) {
    // libfoo.<major>[.<minor>[.<patch>]].dylib → libfoo.<major>.dylib 与 libfoo.dylib
    const m = /^(.+?)\.(\d+)(?:\.\d+)*\.dylib$/.exec(f);
    if (!m) continue;
    for (const short of [`${m[1]}.${m[2]}.dylib`, `${m[1]}.dylib`]) {
      const shortPath = join(libDir, short);
      if (short !== f && !existsSync(shortPath)) {
        symlinkSync(f, shortPath);
        fixed += 1;
      }
    }
  }
  return fixed;
}

let total = 0;
// pnpm 布局：node_modules/.pnpm/@embedded-postgres+<platform>@<ver>/node_modules/@embedded-postgres/<platform>/native/lib
const pnpmDir = 'node_modules/.pnpm';
if (existsSync(pnpmDir)) {
  for (const entry of readdirSync(pnpmDir)) {
    if (!entry.startsWith('@embedded-postgres+')) continue;
    for (const plat of ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64']) {
      total += fixLibDir(join(pnpmDir, entry, 'node_modules', '@embedded-postgres', plat, 'native', 'lib'));
    }
  }
}
// npm 兼容布局
total += fixLibDir('node_modules/embedded-postgres/node_modules/@embedded-postgres/darwin-arm64/native/lib');
if (total > 0) console.log(`[fix-embedded-pg] created ${total} dylib symlinks`);
