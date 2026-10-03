"use client";

import { Alert, Button, Card, Checkbox, Input, Select, Space, Spin, Steps, Typography } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useParams } from "next/navigation";
import { useState } from "react";
import { agentApi } from "@rabbit/api-client";
import { useApp } from "@/hooks/useApp";
import { useProjectStore } from "@/stores/project";

/** AGENT-002 生成向导：三步（上下文源 → 阶段与选项 → 运行进度）。 */
export default function GenerateWizardPage() {
  const { message } = useApp();
  const router = useRouter();
  const params = useParams<{ agentId: string }>();
  const agentId = params.agentId;
  const { currentProjectId: projectId } = useProjectStore();
  const [step, setStep] = useState(0);
  const [requirementText, setRequirementText] = useState("请根据文档，及所选代码库，生成测试用例。");
  const [stageA, setStageA] = useState(true);
  const [stageB, setStageB] = useState(true);
  const [stageC, setStageC] = useState(true);
  const [runId, setRunId] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<string>("");

  const agent = useQuery({
    queryKey: ["agent", projectId, agentId],
    queryFn: () => agentApi.get(projectId!, agentId),
    enabled: Boolean(projectId && agentId),
  });

  const startGenerate = async () => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/agents/${agentId}/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
        sources: { repoIds: [], docPaths: [], platformDocIds: [], requirementText, referenceCases: false },
          stages: { a: stageA, b: stageB ? "auto" : "off", c: stageC ? { scenario: true, ui: true, playwright: true } : undefined },
        }),
      });
      const r = (await res.json()) as { data?: { runId?: string }; code: number };
      if (r?.data?.runId) {
        setRunId(r.data.runId);
        setStep(2);
        // 轮询运行状态
        const poll = setInterval(async () => {
          const detail = await agentApi.runDetail(projectId!, r!.data!.runId!);
          setRunStatus(detail.run.status);
          if (["COMPLETED", "FAILED", "CANCELED"].includes(detail.run.status)) {
            clearInterval(poll);
          }
        }, 3000);
      }
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  return (
    <div className="p-6" data-testid="generate-wizard-page">
      <div className="mb-4 flex items-center gap-3">
        <Button onClick={() => router.push("/agents")} data-testid="generate-back">返回</Button>
        <Typography.Title level={5} style={{ margin: 0 }}>
          发起生成 · {agent.data?.name ?? "Agent"}
        </Typography.Title>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>pipeline 模式 · 产物进入草稿区，人工确认后导入</Typography.Text>
      </div>

      <Steps current={step} items={[{ title: "上下文源" }, { title: "阶段与选项" }, { title: "运行" }]} />

      {step === 0 && (
        <Card className="!mt-6" data-testid="generate-step-sources">
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>仓库与平台文档从 Agent 配置读取；此处填写需求文本</Typography.Text>
          <div className="!mt-4">
            <Typography.Text strong style={{ fontSize: 13 }}>需求文本</Typography.Text>
            <Input.TextArea
              rows={4}
              value={requirementText}
              onChange={(e) => setRequirementText(e.target.value)}
              data-testid="generate-requirement-input"
            />
          </div>
          <div className="!mt-6 flex justify-end">
            <Button type="primary" onClick={() => setStep(1)} data-testid="generate-next-stages">下一步：阶段与选项</Button>
          </div>
        </Card>
      )}

      {step === 1 && (
        <Card className="!mt-6" data-testid="generate-step-stages">
          <Space direction="vertical" size="large" style={{ width: "100%" }}>
            <div>
              <Checkbox checked={stageA} onChange={(e) => setStageA(e.target.checked)} data-testid="generate-stage-a">
                阶段 A · 需求分析（→ 测试点 + 功能用例）
              </Checkbox>
            </div>
            <div>
              <Checkbox checked={stageB} onChange={(e) => setStageB(e.target.checked)} data-testid="generate-stage-b">
                阶段 B · 接口资产提取（→ 接口定义 + API 用例）
              </Checkbox>
            </div>
            <div>
              <Checkbox checked={stageC} onChange={(e) => setStageC(e.target.checked)} data-testid="generate-stage-c">
                阶段 C · 脚本生成（→ 场景 / UI 用例 / 脚本）
              </Checkbox>
            </div>
          </Space>
          <div className="!mt-6 flex justify-between">
            <Button onClick={() => setStep(0)}>上一步</Button>
            <Button type="primary" onClick={startGenerate} data-testid="generate-start">开始生成</Button>
          </div>
        </Card>
      )}

      {step === 2 && (
        <Card className="!mt-6" data-testid="generate-step-run">
          {runStatus === "COMPLETED" ? (
            <Alert type="success" message="生成完成" description={`共产生草稿若干条，点击查看产物。`} />
          ) : runStatus === "FAILED" ? (
            <Alert type="error" message="生成失败" description="请检查模型配置或日志。" />
          ) : (
            <div className="flex items-center gap-3 py-8">
              <Spin />
              <Typography.Text type="secondary">运行中…（{runStatus || "PENDING"}）</Typography.Text>
            </div>
          )}
          {["COMPLETED", "FAILED"].includes(runStatus) && runId && (
            <div className="!mt-4 flex justify-end gap-2">
              <Button onClick={() => setStep(0)}>重新生成</Button>
              <Button type="primary" onClick={() => router.push(`/agents/${agentId}/runs/${runId}/drafts`)}>
                查看产物
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
