"use client";

import { Star } from "lucide-react";

/**
 * DASH-002 通用关注星：纯展示组件——星形（filled=amber-400），点击回调 onToggle 翻转；
 * 乐观更新由调用方 mutation 处理（本组件不改状态，仅上报目标态）。
 */
export function FollowStar({
  entityType,
  entityId,
  followed,
  onToggle,
  testid = "follow-star",
}: {
  entityType: "test_plan" | "scenario" | "case_review" | "api_case" | "functional_case" | "bug";
  entityId: string;
  followed: boolean;
  onToggle: (on: boolean) => Promise<unknown>;
  testid?: string;
}) {
  return (
    <button
      type="button"
      title={followed ? "取消关注" : "关注"}
      aria-label={followed ? "取消关注" : "关注"}
      aria-pressed={followed}
      data-testid={testid}
      data-entity-type={entityType}
      data-entity-id={entityId}
      className={`inline-flex items-center justify-center rounded-md p-1 transition-colors shrink-0 ${
        followed ? "text-amber-400" : "text-[#C9CDD4] hover:text-amber-400"
      }`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle(!followed).catch(() => undefined);
      }}
    >
      <Star size={15} strokeWidth={1.8} fill={followed ? "currentColor" : "none"} />
    </button>
  );
}
