import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
import { execSync } from "node:child_process";
const mod = await import("embedded-postgres");
const EP = mod.default ?? mod.EmbeddedPostgres ?? mod;
const pg = new EP({
  databaseDir: path.join(root, ".pgdata-e2e"),
  user: "postgres",
  password: "postgres",
  port: 5434,
  persistent: true,
});
if (!existsSync(".pgdata-e2e/PG_VERSION")) await pg.initialise();
await pg.start();
try {
  await pg.createDatabase("rabbit_e2e");
} catch {}
console.log("E2E_PG_READY 5434");
setInterval(() => {}, 60000);
