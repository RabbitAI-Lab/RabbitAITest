/**
 * 本地执行 CLI（验收标准 6）：
 *   pnpm --filter engine local -- --url https://httpbin.org/get --expect-status 200 \
 *        --task-id <uuid> [--server http://localhost:3000]
 * 与 worker 同一 kernel 与事件流，回环上报 web。
 * 注意：--server 必须在动态 import 前注入 env（shared/config 在首次 import 时求值）。
 */
interface CliArgs {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD' | 'CONNECT';
  expectStatus: string;
  taskId: string;
  server?: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const get = (k: string, fallback?: string): string => {
    const i = args.indexOf(`--${k}`);
    const v = i >= 0 ? args[i + 1] : undefined;
    return v ?? fallback ?? '';
  };
  const url = get('url', 'https://httpbin.org/get');
  if (!/^https?:\/\//.test(url)) {
    console.error('用法: --url <http-url> [--method GET] [--expect-status 200] --task-id <uuid> [--server http://localhost:3000]');
    process.exit(2);
  }
  return {
    url,
    method: (get('method', 'GET') || 'GET') as CliArgs['method'],
    expectStatus: get('expect-status', '200'),
    taskId: get('task-id') || crypto.randomUUID(),
    server: get('server') || undefined,
  };
}

async function main() {
  const args = parseArgs();
  if (args.server) process.env.WEB_URL = args.server;
  const { config } = await import('@rabbit/shared');
  const { runTask } = await import('./runner/worker.js');
  const Redis = (await import('ioredis')).default;
  const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  const outcome = await runTask(redis, {
    taskId: args.taskId,
    projectId: '00000000-0000-0000-0000-000000000000',
    type: 'api_debug',
    request: { method: args.method, url: args.url, headers: [], body: { kind: 'none', content: '' } },
    asserts: [{ kind: 'status_code', path: '', op: 'eq', expected: args.expectStatus }],
  });
  redis.disconnect();
  console.log(`[local] outcome=${outcome}`);
  process.exit(outcome === 'success' ? 0 : 1);
}

void main();
