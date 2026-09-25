import { serve } from '@hono/node-server';
import { Hono } from 'hono';

/** Mock 服务占位（Sprint 2 API-005 完整规则匹配）。P0 提供健康端点与稳定 JSON 端点（E2E/引擎测试目标）。 */
const app = new Hono();
app.get('/healthz', (c) => c.json({ status: 'UP' }));
app.get('/hello', (c) => c.json({ message: 'hello', status: 'UP' }));

serve({ fetch: app.fetch, port: Number(process.env.MOCK_PORT ?? 4000) }, (info) => {
  console.log(`[mock] listening :${info.port}`);
});
