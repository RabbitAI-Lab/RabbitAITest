export default async function globalTeardown() {
  const env = globalThis.__e2eEnv;
  if (!env) return;
  for (const { p } of env.procs ?? []) {
    try {
      p.kill("SIGTERM");
    } catch {
      /* noop */
    }
  }
  if (env.pg) {
    try {
      await env.pg.stop();
    } catch {
      /* noop */
    }
  }
  console.log("[e2e-teardown] done");
}
