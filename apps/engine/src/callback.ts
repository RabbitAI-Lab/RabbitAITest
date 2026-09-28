import { config } from "@rabbit/shared";
import { logFor } from "@rabbit/shared/logger";
import type { ExecCallback } from "@rabbit/shared";

/** 终态回调：指数退避 ≤5 次，失败转 dead（由 web 侧任务超时兜底回收）。 */
export async function postCallback(taskId: string, cb: ExecCallback): Promise<boolean> {
  const url = `${config.webUrl}/api/v1/internal/exec/${taskId}/callback`;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Internal-Token": config.internalToken },
        body: JSON.stringify(cb),
      });
      if (res.ok) return true;
      logFor("engine").warn(
        { execTaskId: taskId, status: res.status, attempt: attempt + 1 },
        "callback http error",
      );
    } catch (e) {
      logFor("engine").warn(
        { execTaskId: taskId, err: e, attempt: attempt + 1 },
        "callback network error",
      );
    }
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
  }
  return false;
}
