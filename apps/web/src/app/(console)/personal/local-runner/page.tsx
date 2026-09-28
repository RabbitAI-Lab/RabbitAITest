"use client";

import { Alert, Button, Input, Switch, message } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { personalApi } from "@rabbit/api-client";

/** SYS-007：本地执行配置（环回地址 + 连通检测 + 优先本地开关）。 */
export default function LocalRunnerPage() {
  const qc = useQueryClient();
  const [address, setAddress] = useState<string | null>(null);
  const [preferLocal, setPreferLocal] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // 用户一旦编辑，迟到的初始查询回填不得覆盖（慢网下曾抹掉已填地址致检测钮永久禁用——2026-09-28 竞态修复）
  const dirtyRef = useRef(false);
  const [checkResult, setCheckResult] = useState<{ reachable: boolean; detail: string } | null>(null);

  const q = useQuery({
    queryKey: ["local-runner"],
    queryFn: () => personalApi.localRunner(),
  });
  if (q.data && !loaded) {
    setLoaded(true);
    if (!dirtyRef.current) {
      setAddress(q.data.address);
      setPreferLocal(q.data.preferLocal);
    }
  }

  const loopbackHint =
    address && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]|::1)(:\d+)?\/?/.test(address)
      ? "仅允许环回地址（127.0.0.1 / localhost / ::1）"
      : "";

  const save = useMutation({
    mutationFn: () => personalApi.saveLocalRunner({ address: address || null, preferLocal }),
    onSuccess: () => {
      message.success("已保存");
      void qc.invalidateQueries({ queryKey: ["local-runner"] });
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "保存失败"),
  });
  const check = useMutation({
    mutationFn: () => personalApi.checkLocalRunner(),
    onSuccess: (r) => setCheckResult(r),
    onError: (e) => setCheckResult({ reachable: false, detail: e instanceof Error ? e.message : "检测失败" }),
  });

  return (
    <div className="rabbit-card p-4 max-w-lg" data-testid="page-personal-local-runner">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <p className="text-xs text-gray-500 mb-1">本地 runner 地址（仅限环回）</p>
            <Input
              className="font-mono text-xs"
              placeholder="http://127.0.0.1:7001"
              value={address ?? ""}
              onChange={(e) => {
                dirtyRef.current = true;
                setAddress(e.target.value);
              }}
              data-testid="local-runner-address"
            />
          </div>
          <Button className="self-end" disabled={!address || Boolean(loopbackHint)} loading={check.isPending} onClick={() => check.mutate()} data-testid="local-runner-check">
            检测连通
          </Button>
        </div>
        {loopbackHint && <p className="text-xs text-red-500" data-testid="local-runner-invalid">{loopbackHint}</p>}
        {checkResult && (
          <p className={`text-xs ${checkResult.reachable ? "text-green-600" : "text-red-500"}`} data-testid="local-runner-check-result">
            {checkResult.reachable ? "✓ 连通" : "✗ 不可达"}（{checkResult.detail}）
          </p>
        )}
        <div className="flex items-center gap-2">
          <Switch size="small" checked={preferLocal} onChange={(v) => { dirtyRef.current = true; setPreferLocal(v); }} data-testid="local-runner-prefer" />
          <span className="text-[13px]">优先本地执行</span>
        </div>
        <Button type="primary" disabled={Boolean(loopbackHint)} loading={save.isPending} onClick={() => save.mutate()} data-testid="local-runner-save">
          保存
        </Button>
        <Alert
          type="info"
          showIcon
          message="开关为偏好记录与展示；实际本地执行由 engine --local 拉取模式自决（web 不做调度改向，PROJ-005 §1.2 登记）"
        />
      </div>
    </div>
  );
}
