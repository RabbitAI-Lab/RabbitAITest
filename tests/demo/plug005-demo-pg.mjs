// PLUG-005 演示栈内嵌 PG（临时，不入库）
import EmbeddedPostgres from "embedded-postgres";
const pg = new EmbeddedPostgres({
  databaseDir: ".pgdata-demo-plug005",
  user: "postgres",
  password: "postgres",
  port: 5440,
  persistent: false,
});
process.on("SIGTERM", () => {
  pg.stop().finally(() => process.exit(0));
});
process.on("SIGINT", () => {
  pg.stop().finally(() => process.exit(0));
});
await pg.initialise();
await pg.start();
await pg.createDatabase("rabbit_demo");
console.log("PG_READY");
setInterval(() => {}, 1 << 30);
