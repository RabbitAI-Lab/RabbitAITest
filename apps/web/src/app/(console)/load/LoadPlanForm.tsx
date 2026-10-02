"use client";

/** S11 LOAD-003：施压计划编辑器表单（新建 /load/new 与编辑 /load/[loadTestId] 共用）。 */
import { Button, Input, InputNumber, Select, Space, Table, message } from "antd";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { loadApi, ApiError, type LoadTestRow } from "@rabbit/api-client";
import type { LoadPressure, LoadTarget, LoadThresholds } from "@rabbit/shared";

interface RampRow {
  atSec: number;
  concurrency: number;
}

export function LoadPlanForm({ projectId, initial }: { projectId: string; initial?: LoadTestRow }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [msg, msgCtx] = message.useMessage();
  const [name, setName] = useState(initial?.name ?? "");
  const [method, setMethod] = useState<LoadTarget["method"]>(initial?.target.method ?? "POST");
  const [url, setUrl] = useState(initial?.target.url ?? "");
  const [body, setBody] = useState(initial?.target.body ?? "");
  const [mode, setMode] = useState<LoadPressure["mode"]>(initial?.pressure.mode ?? "concurrency");
  const [durationSec, setDurationSec] = useState(initial?.pressure.durationSec ?? 60);
  const [maxConcurrency, setMaxConcurrency] = useState(
    initial?.pressure.mode === "concurrency" ? initial.pressure.maxConcurrency : 10,
  );
  const [targetTps, setTargetTps] = useState(
    initial?.pressure.mode === "tps" ? initial.pressure.targetTps : 50,
  );
  const [rampSec, setRampSec] = useState(
    initial?.pressure.mode === "tps" ? (initial.pressure.rampSec ?? 10) : 10,
  );
  const [ramp, setRamp] = useState<RampRow[]>(
    initial?.pressure.mode === "concurrency"
      ? initial.pressure.ramp.map((r) => ({ atSec: r.atSec, concurrency: r.concurrency }))
      : [
          { atSec: 0, concurrency: 5 },
          { atSec: 30, concurrency: 10 },
        ],
  );
  const [okRateMin, setOkRateMin] = useState(initial?.thresholds.okRateMin ?? 99);
  const [p95MsMax, setP95MsMax] = useState(initial?.thresholds.p95MsMax ?? 500);
  const [avgMsMax, setAvgMsMax] = useState(initial?.thresholds.avgMsMax ?? 200);

  const saveMut = useMutation({
    mutationFn: () => {
      const pressure: LoadPressure =
        mode === "concurrency"
          ? { mode: "concurrency", durationSec, maxConcurrency, ramp }
          : { mode: "tps", durationSec, targetTps, rampSec };
      const thresholds: LoadThresholds = { okRateMin, p95MsMax, avgMsMax };
      const target: LoadTarget = { method, url, headers: [], body };
      const payload = { name, target, pressure, thresholds };
      return initial
        ? loadApi.update(projectId, initial.id, payload)
        : loadApi.create(projectId, payload);
    },
    onSuccess: (r) => {
      msg.success("已保存");
      void qc.invalidateQueries({ queryKey: ["load-tests"] });
      router.push("/load");
      return r;
    },
    onError: (e) => {
      msg.error(e instanceof ApiError ? `保存失败（${e.code}）：${e.message}` : `保存失败：${e}`);
    },
  });

  return (
    <div className="space-y-4" data-testid="load-plan-form">
      {msgCtx}
      <div className="border rounded p-3 bg-white space-y-3" data-testid="load-target-form">
        <div className="text-sm font-medium text-slate-600">目标请求</div>
        <div className="flex gap-2">
          <span data-testid="load-target-method" className="inline-block">
            <Select
              value={method}
              onChange={(v) => setMethod(v as LoadTarget["method"])}
              options={["GET", "POST", "PUT", "DELETE", "PATCH"].map((m) => ({
                value: m,
                label: m,
              }))}
              style={{ width: 100 }}
            />
          </span>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http(s) 绝对 URL（压测目标）"
            data-testid="load-target-url"
          />
        </div>
        <div className="text-xs text-slate-400">Body（可选）</div>
        <Input.TextArea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          className="font-mono text-xs"
          data-testid="load-target-body"
        />
      </div>

      <div className="border rounded p-3 bg-white space-y-3" data-testid="load-pressure-form">
        <div className="text-sm font-medium text-slate-600">压力模型</div>
        <span data-testid="load-pressure-mode" className="inline-block">
          <Select
            value={mode}
            onChange={(v) => setMode(v as LoadPressure["mode"])}
            options={[
              { value: "concurrency", label: "并发阶梯（爬升→稳态）" },
              { value: "tps", label: "目标 TPS（每秒发压配额）" },
            ]}
            style={{ width: 260 }}
          />
        </span>
        <div className="flex gap-4 flex-wrap">
          <label className="text-sm space-y-1 block">
            <span className="text-xs text-slate-500 block">持续时长（秒，5-600）</span>
            <InputNumber
              min={5}
              max={600}
              value={durationSec}
              onChange={(v) => setDurationSec(v ?? 60)}
              data-testid="load-duration"
            />
          </label>
          {mode === "concurrency" ? (
            <label className="text-sm space-y-1 block">
              <span className="text-xs text-slate-500 block">并发上限（1-200）</span>
              <InputNumber
                min={1}
                max={200}
                value={maxConcurrency}
                onChange={(v) => setMaxConcurrency(v ?? 10)}
                data-testid="load-max-concurrency"
              />
            </label>
          ) : (
            <>
              <label className="text-sm space-y-1 block">
                <span className="text-xs text-slate-500 block">目标 TPS（1-1000）</span>
                <InputNumber
                  min={1}
                  max={1000}
                  value={targetTps}
                  onChange={(v) => setTargetTps(v ?? 50)}
                  data-testid="load-target-tps"
                />
              </label>
              <label className="text-sm space-y-1 block">
                <span className="text-xs text-slate-500 block">爬升时长（秒）</span>
                <InputNumber
                  min={0}
                  max={600}
                  value={rampSec}
                  onChange={(v) => setRampSec(v ?? 10)}
                  data-testid="load-ramp-sec"
                />
              </label>
            </>
          )}
        </div>
        {mode === "concurrency" && (
          <>
            <div className="text-xs text-slate-400">并发阶梯（秒 → 并发；首行 atSec 必须为 0）</div>
            <Table<RampRow>
              rowKey={(r) => `ramp-${r.atSec}`}
              size="small"
              pagination={false}
              dataSource={ramp}
              data-testid="load-ramp-table"
              columns={[
                {
                  title: "起始秒",
                  dataIndex: "atSec",
                  width: 120,
                  render: (v: number, r, i) => (
                    <InputNumber
                      min={0}
                      max={600}
                      value={v}
                      onChange={(nv) =>
                        setRamp(ramp.map((x, j) => (j === i ? { ...x, atSec: nv ?? 0 } : x)))
                      }
                      data-testid={`load-ramp-at-${i}`}
                    />
                  ),
                },
                {
                  title: "并发",
                  dataIndex: "concurrency",
                  width: 120,
                  render: (v: number, r, i) => (
                    <InputNumber
                      min={1}
                      max={200}
                      value={v}
                      onChange={(nv) =>
                        setRamp(ramp.map((x, j) => (j === i ? { ...x, concurrency: nv ?? 1 } : x)))
                      }
                      data-testid={`load-ramp-c-${i}`}
                    />
                  ),
                },
                {
                  title: "",
                  key: "ops",
                  width: 70,
                  render: (_v, _r, i) => (
                    <a
                      className="text-red-400 text-xs"
                      onClick={() => setRamp(ramp.filter((_x, j) => j !== i))}
                    >
                      删除
                    </a>
                  ),
                },
              ]}
            />
            <Button
              size="small"
              data-testid="load-ramp-add"
              onClick={() =>
                setRamp([
                  ...ramp,
                  { atSec: (ramp[ramp.length - 1]?.atSec ?? 0) + 30, concurrency: 10 },
                ])
              }
            >
              + 添加阶梯
            </Button>
          </>
        )}
      </div>

      <div className="border rounded p-3 bg-white space-y-3" data-testid="load-threshold-form">
        <div className="text-sm font-medium text-slate-600">断言阈值（报告结论判定）</div>
        <div className="flex gap-4 flex-wrap">
          <label className="text-sm space-y-1 block">
            <span className="text-xs text-slate-500 block">成功率 ≥（%）</span>
            <InputNumber
              min={0}
              max={100}
              value={okRateMin}
              onChange={(v) => setOkRateMin(v ?? 99)}
              data-testid="load-ok-rate"
            />
          </label>
          <label className="text-sm space-y-1 block">
            <span className="text-xs text-slate-500 block">P95 ≤（ms）</span>
            <InputNumber
              min={1}
              value={p95MsMax}
              onChange={(v) => setP95MsMax(v ?? 500)}
              data-testid="load-p95"
            />
          </label>
          <label className="text-sm space-y-1 block">
            <span className="text-xs text-slate-500 block">平均 RT ≤（ms）</span>
            <InputNumber
              min={1}
              value={avgMsMax}
              onChange={(v) => setAvgMsMax(v ?? 200)}
              data-testid="load-avg"
            />
          </label>
        </div>
      </div>

      <div className="flex gap-2 justify-end">
        <Space>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="计划名称"
            style={{ width: 260 }}
            data-testid="load-name-input"
          />
          <Button onClick={() => router.push("/load")}>取消</Button>
          <Button
            type="primary"
            loading={saveMut.isPending}
            data-testid="load-save-btn"
            onClick={() => saveMut.mutate()}
          >
            保存计划
          </Button>
        </Space>
      </div>
    </div>
  );
}
