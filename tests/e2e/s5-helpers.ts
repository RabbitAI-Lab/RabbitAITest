/**
 * S5 e2e helpers（MSG-001/FILE-001）：e2e 栈 mock（随 worktree 槽位，INFRA-005）交互封装。
 * 口径同 s6-helpers.PLATFORM_MOCK_BASE：webhook/Git 平台指向测试栈 mock 为被测行为，
 * 栈注入 OUTBOUND_ALLOW_PRIVATE=1（e2e 约定）；生产面出站守卫由单测与 422 用例覆盖。
 */
import type { APIRequestContext } from "@playwright/test";
import { MOCK_BASE } from "./env";

export const S5_MOCK_BASE = MOCK_BASE;

/** 三平台机器人 webhook（mock 接收端点） */
export function robotWebhookUrl(channel: "dingtalk" | "wecom" | "feishu"): string {
  return `${S5_MOCK_BASE}/mock-robot/${channel}`;
}

/** mock Git 仓库地址（任意 owner/repo @ main，固定小文件集） */
export function mockGitRepoUrl(platform: "gitea" | "github" | "gitlab" | "gitee"): string {
  return `${S5_MOCK_BASE}/qa/testdata-${platform}`;
}

export interface RobotCall {
  channel: string;
  text: string;
  at: string;
}

export async function robotCalls(): Promise<RobotCall[]> {
  const res = await fetch(`${S5_MOCK_BASE}/mock-robot/_test/calls`);
  const body = (await res.json()) as { items: RobotCall[] };
  return body.items ?? [];
}

export async function clearRobotCalls(): Promise<void> {
  await fetch(`${S5_MOCK_BASE}/mock-robot/_test/clear`, { method: "POST" });
}

/** 以指定会话读取未读通知（跨用户视角断言用）。
 *  S8 改造：原签名 (baseUrl, cookie) 以裸 fetch 拼 env 基址 URL + 响应 cookie 显式注入——
 *  构成「env→fetch」与「响应 cookie→网络调用」污点链被 Mimosa 判 SSRF 入口（FP 台账 #3）；
 *  改为接收独立浏览器上下文的 request（cookie 由 jar 自动管理，相对路径无 URL 拼接）。 */
export async function readUnreadTitles(request: APIRequestContext): Promise<string[]> {
  const res = await request.get("/api/v1/personal/notifications?unread=true");
  const body = (await res.json()) as { data: { items: { title: string }[] } };
  return (body.data?.items ?? []).map((n) => n.title);
}
