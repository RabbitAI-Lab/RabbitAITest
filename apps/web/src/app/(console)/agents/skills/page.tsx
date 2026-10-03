"use client";

import { Button, Form, Input, Modal, Popconfirm, Table, Typography } from "antd";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { agentSkillApi, type AgentSkillView } from "@rabbit/api-client";
import { useApp } from "@/hooks/useApp";
import { useProjectStore } from "@/stores/project";

export default function AgentSkillsPage() {
  const { message } = useApp();
  const qc = useQueryClient();
  const { currentProjectId: projectId } = useProjectStore();
  const [skillModal, setSkillModal] = useState<AgentSkillView | "new" | null>(null);
  const [skillForm] = Form.useForm<{
    name: string;
    description: string;
    content: string;
    enabled?: boolean;
  }>();

  const skills = useQuery({
    queryKey: ["agent-skills", projectId],
    queryFn: () => agentSkillApi.list(projectId!),
    enabled: Boolean(projectId),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["agent-skills", projectId] });
    void qc.invalidateQueries({ queryKey: ["agents", projectId] });
  };

  return (
    <div className="p-6" data-testid="agents-skills-page">
      <div className="mb-4 flex items-center gap-3">
        <div>
          <Typography.Title level={5} style={{ margin: 0 }}>
            项目技能库
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            可复用指令包（markdown）：注入 Agent 系统提示词，单个 Agent 最多引用 5 个
          </Typography.Text>
        </div>
        <div className="ml-auto flex gap-2">
          <Button type="primary" onClick={() => setSkillModal("new")} data-testid="agent-skill-create">
            新建技能
          </Button>
        </div>
      </div>

      <Table
        rowKey="id"
        size="small"
        loading={skills.isLoading}
        dataSource={skills.data?.items ?? []}
        columns={[
          { title: "名称", dataIndex: "name" },
          { title: "触发说明", dataIndex: "description", ellipsis: true },
          {
            title: "引用 Agent",
            dataIndex: "refCount",
            width: 100,
            render: (v: number) => v ?? 0,
          },
          {
            title: "启用",
            dataIndex: "enabled",
            width: 80,
            render: (v: boolean) => (v ? "是" : "否"),
          },
          {
            title: "操作",
            width: 140,
            render: (_: unknown, r: AgentSkillView) => (
              <>
                <Button size="small" type="link" onClick={() => setSkillModal(r)}>
                  编辑
                </Button>
                <Popconfirm
                  title="确认删除该技能？"
                  onConfirm={() =>
                    void agentSkillApi
                      .remove(projectId!, r.id)
                      .then(invalidate)
                      .catch((e: Error) => message.error(e.message))
                  }
                >
                  <Button size="small" type="link" danger>
                    删除
                  </Button>
                </Popconfirm>
              </>
            ),
          },
        ]}
      />

      {/* 技能编辑弹窗 */}
      <Modal
        title={skillModal && skillModal !== "new" ? `编辑技能 · ${skillModal.name}` : "新建技能"}
        open={Boolean(skillModal)}
        onCancel={() => setSkillModal(null)}
        data-testid="agent-skill-modal"
        onOk={async () => {
          const v = await skillForm.validateFields();
          const p = skillModal && skillModal !== "new" ? skillModal.id : null;
          const action = p
            ? agentSkillApi.update(projectId!, p, {
                name: v.name,
                description: v.description,
                content: v.content,
                enabled: skillModal && skillModal !== "new" ? skillModal.enabled : true,
              })
            : agentSkillApi.create(projectId!, {
                name: v.name,
                description: v.description,
                content: v.content,
                enabled: true,
              });
          await action
            .then(invalidate)
            .then(() => {
              message.success("已保存");
              setSkillModal(null);
            })
            .catch((e: Error) => message.error(e.message));
        }}
      >
        <Form
          form={skillForm}
          layout="vertical"
          initialValues={
            skillModal && skillModal !== "new"
              ? {
                  name: skillModal.name,
                  description: skillModal.description,
                  content: skillModal.content,
                }
              : undefined
          }
        >
          <Form.Item name="name" label="名称（项目内唯一）" rules={[{ required: true, max: 64 }]}>
            <Input data-testid="agent-skill-name" />
          </Form.Item>
          <Form.Item
            name="description"
            label="触发说明（何时使用）"
            rules={[{ required: true, max: 512 }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="content" label="指令内容（markdown ≤16KB）" rules={[{ required: true }]}>
            <Input.TextArea rows={8} showCount maxLength={16384} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
