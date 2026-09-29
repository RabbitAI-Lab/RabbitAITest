"use client";

import { Button, Empty, Segmented, Spin, Tabs } from "antd";
import { ArrowDownRight, ArrowUpRight, Settings2 } from "lucide-react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { dashApi, prefApi, type DashItem } from "@rabbit/api-client";
import { useProjectStore } from "@/stores/project";
import { useApp } from "@/hooks/useApp";
import { useEffect, useState } from "react";

/** DASH-001/DASH-002：工作台首页（看板 + 我的待办/我关注的/我创建的——七维度子筛选）。 */
const KIND_META: Record<string, { label: string; cls: string }> = {
  case: { label: "用例", cls: "bg-blue-50 text-blue-600 border-blue-200" },
  review: { label: "评审", cls: "bg-purple-50 text-purple-600 border-purple-200" },
  plan: { label: "计划", cls: "bg-cyan-50 text-cyan-600 border-cyan-200" },
  bug: { label: "缺陷", cls: "bg-red-50 text-red-600 border-red-200" },
  exec: { label: "执行", cls: "bg-orange-50 text-orange-600 border-orange-200" },
  api_case: { label: "接口", cls: "bg-violet-50 text-violet-600 border-violet-200" },
  scenario: { label: "场景", cls: "bg-teal-50 text-teal-600 border-teal-200" },
};

/** DASH-002：我关注的七枚子筛选（全部 + case/plan/review/api_case/scenario/bug）。 */
const FOLLOWED_KINDS: { k: string; label: string }[] = [
  { k: "all", label: "全部" },
  { k: "case", label: "用例" },
  { k: "plan", label: "测试计划" },
  { k: "review", label: "用例评审" },
  { k: "api_case", label: "接口用例" },
  { k: "scenario", label: "场景" },
  { k: "bug", label: "缺陷" },
];

/** DASH-002：我创建的六枚子筛选（原四枚 + 接口用例/场景）。 */
const CREATED_KINDS: { k: string; label: string }[] = [
  { k: "case", label: "用例" },
  { k: "review", label: "评审" },
  { k: "plan", label: "计划" },
  { k: "bug", label: "缺陷" },
  { k: "api_case", label: "接口用例" },
  { k: "scenario", label: "场景" },
];

/** 我的执行行 refType 徽标（todo exec 项在 kind 之外附 refType：功能/接口/场景 三色小 Tag）。 */
const REF_TYPE_META: Record<string, { label: string; cls: string }> = {
  functional_case: { label: "功能", cls: "bg-blue-50 text-blue-600 border border-blue-200" },
  api_case: { label: "接口", cls: "bg-[#574BFF]/10 text-[#574BFF] border border-[#574BFF]/20" },
  scenario: { label: "场景", cls: "bg-teal-50 text-teal-600 border border-teal-200" },
};

/** todo(exec) 行额外携带 refType（DashItem 类型未声明，本地扩展）。 */
type DashRow = DashItem & { refType?: string };

export default function DashboardPage() {
  const { currentProjectId } = useProjectStore();
  const { message } = useApp();
  const [range, setRange] = useState<"3d" | "7d">("7d");
  const [cards, setCards] = useState<Record<string, "hidden" | "half" | "full">>({
    case: "half",
    review: "half",
    plan: "half",
    bug: "half",
  });
  const [cardSetting, setCardSetting] = useState(false);

  const { data: overview, isLoading } = useQuery({
    queryKey: ["dash-overview", currentProjectId, range],
    queryFn: () => dashApi.overview(currentProjectId!, range),
    enabled: Boolean(currentProjectId),
  });

  // 卡片布局偏好持久化（DASH-001：不展示/半屏/全屏）
  useEffect(() => {
    if (!currentProjectId) return;
    prefApi
      .get("dash_cards", currentProjectId)
      .then((r) => {
        const v = r.value as Record<string, "hidden" | "half" | "full"> | null;
        if (v && typeof v === "object") setCards((prev) => ({ ...prev, ...v }));
      })
      .catch(() => undefined);
  }, [currentProjectId]);

  const saveCards = (next: Record<string, "hidden" | "half" | "full">) => {
    setCards(next);
    if (currentProjectId) {
      prefApi
        .put("dash_cards", currentProjectId, next)
        .catch(() => message.warning("布局保存失败"));
    }
  };

  if (!currentProjectId) return <Empty description="请先选择项目" />;

  const cardDef = [
    {
      key: "case",
      title: "用例总数",
      value: String(overview?.caseCard.total ?? 0),
      sub: `筛选期内新增 ${overview?.caseCard.newInRange ?? 0}`,
      up: (overview?.caseCard.newInRange ?? 0) > 0,
    },
    {
      key: "review",
      title: "评审通过率",
      value:
        overview && overview.reviewCard.passRate !== null
          ? `${overview.reviewCard.passRate}%`
          : "—",
      sub: `进行中评审 ${overview?.reviewCard.underway ?? 0}`,
      up: true,
    },
    {
      key: "plan",
      title: "计划执行进度 Top",
      value: overview?.planCard.top[0] ? `${overview.planCard.top[0].progress}%` : "—",
      sub: overview?.planCard.top.map((p) => p.name).join(" / ") || "暂无进行中计划",
      up: true,
    },
    {
      key: "bug",
      title: "缺陷待处理",
      value: String(overview?.bugCard.pending ?? 0),
      sub: `筛选期内新增 ${overview?.bugCard.newInRange ?? 0}`,
      up: (overview?.bugCard.newInRange ?? 0) === 0,
    },
  ].filter((c) => cards[c.key] !== "hidden");

  return (
    <div className="relative" data-testid="dash-home">
      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-lg font-medium">工作台</h1>
        <Segmented
          options={[
            { label: "近 3 天", value: "3d" },
            { label: "近 7 天", value: "7d" },
          ]}
          value={range}
          onChange={(v) => setRange(v as "3d" | "7d")}
          data-testid="dash-range"
        />
        <div className="ml-auto">
          <Button
            icon={<Settings2 size={14} />}
            onClick={() => setCardSetting(!cardSetting)}
            data-testid="dash-card-setting"
          >
            卡片设置
          </Button>
        </div>
      </div>
      {cardSetting && (
        <div
          className="absolute right-0 top-12 bg-white border border-[#E5E6EB] rounded-md shadow p-3 z-20 w-64"
          data-testid="dash-card-popover"
        >
          {(["case", "review", "plan", "bug"] as const).map((k) => (
            <div key={k} className="flex items-center justify-between py-1.5 text-[13px]">
              <span>{{ case: "用例卡", review: "评审卡", plan: "计划卡", bug: "缺陷卡" }[k]}</span>
              <Segmented
                size="small"
                options={[
                  { label: "不展示", value: "hidden" },
                  { label: "半屏", value: "half" },
                  { label: "全屏", value: "full" },
                ]}
                value={cards[k]}
                onChange={(v) => saveCards({ ...cards, [k]: v as "half" })}
              />
            </div>
          ))}
        </div>
      )}

      <Spin spinning={isLoading}>
        <div className="grid grid-cols-2 gap-4 mb-6">
          {cardDef.map((c) => (
            <div
              key={c.key}
              className={`rabbit-card p-4 ${cards[c.key] === "full" ? "col-span-2" : ""}`}
              data-testid={`dash-card-${c.key}`}
            >
              <p className="text-[13px] text-[#646A73]">{c.title}</p>
              <div className="flex items-end gap-2 mt-1">
                <span className="text-3xl font-medium" data-testid={`dash-value-${c.key}`}>
                  {c.value}
                </span>
                {c.up ? (
                  <ArrowUpRight size={16} className="text-[#52C41A] mb-1.5" />
                ) : (
                  <ArrowDownRight size={16} className="text-[#FF4D4F] mb-1.5" />
                )}
              </div>
              <p className="text-xs text-[#A8ABB0] mt-1">{c.sub}</p>
            </div>
          ))}
        </div>
      </Spin>

      <div className="rabbit-card p-4">
        <Tabs
          items={[
            {
              key: "todo",
              label: <span data-testid="dash-tab-todo">我的待办</span>,
              children: <DashList projectId={currentProjectId} kind="todo" />,
            },
            {
              key: "followed",
              label: <span data-testid="dash-tab-followed">我关注的</span>,
              children: <DashList projectId={currentProjectId} kind="followed" />,
            },
            {
              key: "created",
              label: <span data-testid="dash-tab-created">我创建的</span>,
              children: <DashList projectId={currentProjectId} kind="created" />,
            },
          ]}
        />
      </div>
    </div>
  );
}

function DashList({
  projectId,
  kind,
}: {
  projectId: string;
  kind: "todo" | "followed" | "created";
}) {
  const [todoKind, setTodoKind] = useState("review");
  const [createdKind, setCreatedKind] = useState("case");
  const [followedKind, setFollowedKind] = useState("all");
  void useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: [
      "dash-list",
      projectId,
      kind,
      kind === "todo" ? todoKind : kind === "created" ? createdKind : followedKind,
    ],
    queryFn: () =>
      kind === "todo"
        ? dashApi.todo(projectId, todoKind)
        : kind === "followed"
          ? // DASH-002：kind 七维度服务端过滤（all=全部不传）
            dashApi.followed(projectId, followedKind === "all" ? undefined : followedKind)
          : dashApi.created(projectId, createdKind),
  });
  const items: DashRow[] = data?.items ?? [];
  return (
    <div>
      {kind === "todo" && (
        <div className="flex gap-2 mb-3">
          {["review", "exec", "bug"].map((k) => (
            <Button
              key={k}
              size="small"
              type={todoKind === k ? "primary" : "default"}
              onClick={() => setTodoKind(k)}
              data-testid={`dash-todo-${k}`}
            >
              {{ review: "待我评审", exec: "我的执行", bug: "我的缺陷" }[k]}
            </Button>
          ))}
        </div>
      )}
      {kind === "followed" && (
        <div className="flex gap-2 mb-3 flex-wrap">
          {FOLLOWED_KINDS.map((f) => (
            <Button
              key={f.k}
              size="small"
              type={followedKind === f.k ? "primary" : "default"}
              onClick={() => setFollowedKind(f.k)}
              data-testid={`dash-followed-kind-${f.k}`}
            >
              {f.label}
            </Button>
          ))}
        </div>
      )}
      {kind === "created" && (
        <div className="flex gap-2 mb-3 flex-wrap">
          {CREATED_KINDS.map((f) => (
            <Button
              key={f.k}
              size="small"
              type={createdKind === f.k ? "primary" : "default"}
              onClick={() => setCreatedKind(f.k)}
              data-testid={`dash-created-kind-${f.k}`}
            >
              {f.label}
            </Button>
          ))}
        </div>
      )}
      {isLoading ? (
        <Spin />
      ) : items.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />
      ) : (
        <div className="divide-y divide-[#F0F1F3]">
          {items.map((it) => {
            const meta = KIND_META[it.kind] ?? {
              label: it.kind,
              cls: "bg-slate-50 text-slate-600 border-slate-200",
            };
            const refMeta = it.refType ? REF_TYPE_META[it.refType] : undefined;
            return (
              <div key={it.id} data-testid="dash-item">
                <Link
                  href={it.href}
                  className="flex items-center gap-3 py-2.5 hover:bg-[#F7F8FA] px-2 rounded"
                  data-testid={`dash-${kind}-row-${it.id}`}
                >
                  <span
                    className={`w-11 text-center text-xs border rounded px-1 py-0.5 shrink-0 ${meta.cls}`}
                  >
                    {meta.label}
                  </span>
                  {/* 我的执行行：refType 类型徽标（功能/接口/场景） */}
                  {refMeta && (
                    <span
                      className={`text-[10px] rounded px-1 py-0.5 shrink-0 ${refMeta.cls}`}
                      data-testid={`dash-ref-type-${it.id}`}
                    >
                      {refMeta.label}
                    </span>
                  )}
                  <span className="text-[13px] flex-1 truncate">{it.title}</span>
                  {it.context && (
                    <span className="text-xs text-[#A8ABB0] truncate max-w-40">{it.context}</span>
                  )}
                  <span className="text-xs text-[#A8ABB0]">
                    {(it.createdAt ?? it.updatedAt ?? "").replace("T", " ").slice(0, 16)}
                  </span>
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
