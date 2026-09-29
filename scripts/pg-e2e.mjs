import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
import { execSync } from "node:child_process";
import { rabbitEnv } from "./rabbit-env.mjs";

const ENV = rabbitEnv();
const mod = await import("embedded-postgres");
const EP = mod.default ?? mod.EmbeddedPostgres ?? mod;
const pg = new EP({
  databaseDir: path.join(root, ENV.e2e.pgDataDir),
  user: "postgres",
  password: "postgres",
  port: ENV.e2e.pgPort,
  persistent: true,
});
if (!existsSync(`${ENV.e2e.pgDataDir}/PG_VERSION`)) await pg.initialise();
else rmSync(`${ENV.e2e.pgDataDir}/postmaster.pid`, { force: true });
await pg.start();
try {
  await pg.createDatabase(ENV.e2e.database);
} catch {}
console.log(`E2E_PG_READY ${ENV.e2e.pgPort} (slot=${ENV.slot})`);
setInterval(() => {}, 60000);
