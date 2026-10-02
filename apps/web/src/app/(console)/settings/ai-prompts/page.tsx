"use client";

import {
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  Popconfirm,
  Switch,
  Table,
  Tabs,
  Tag,
  message,
} from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AI_PROMPT_SCENE_LABEL, PROMPT_PLACEHOLDERS, type AiPromptScene } from "@rabbit/shared";
import {
  createAiPrompt,
  deleteAiPrompt,
  listAiPrompts,
  updateAiPrompt,
  type AiPromptRow,
} from "@rabbit/api-client";
import { PageHeader } from "@/components/PageHeader";
import { useProjectStore } from "@/stores/project";
import { usePermissions } from "@/hooks/usePermissions";

interface FormValues {
  name: string;
  template: string;
  designMethod?: string;
  isDefault: boolean;
  enabled: boolean;
}

const DESIGN_SUGGESTIONS = ["等价类划分", "边界值分析", "场景法", "判定表", "错误推测"];

/** AI-005 提示词自定义：项目级模板 CRUD（scene 两类 Tab + 占位符定义域 + 默认语义）。 */
export default function AiPromptsPage() {
  const qc = useQueryClient();
  const { currentProjectId: projectId } = useProjectStore();
  const { can } = usePermissions();
  const canCreate = can("PROJECT_AI:CREATE");
  const canUpdate = can("PROJECT_AI:UPDATE");
  const canDelete = can("PROJECT_AI:DELETE");

  const [scene, setScene] = useState<AiPromptScene>("case_gen");
  const [editing, setEditing] = useState<AiPromptRow | null>(null);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<FormValues>();

  const listQ = useQuery({
    queryKey: ["ai-prompts", projectId],
    queryFn: () => listAiPrompts(projectId!),
    enabled: Boolean(projectId),
  });
  const rows = (listQ.data?.list ?? []).filter((r) => r.scene === scene);
  const placeholders = PROMPT_PLACEHOLDERS[scene];

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ isDefault: false, enabled: true });
    setOpen(true);
  };
  const openEdit = (row: AiPromptRow) => {
    setEditing(row);
    form.resetFields();
    form.setFieldsValue({
      name: row.name,
      template: row.template,
      designMethod: row.designMethod ?? "",
      isDefault: row.isDefault,
      enabled: row.enabled,
    });
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: async (v: FormValues) => {
      const body = {
        name: v.name,
        scene,
        template: v.template,
        designMethod: v.designMethod || undefined,
        isDefault: v.isDefault,
        enabled: v.enabled,
      };
      if (editing) return updateAiPrompt(projectId!, editing.id, body);
      return createAiPrompt(projectId!, body);
    },
    onSuccess: () => {
      message.success(editing ? "模板已更新" : "模板已创建");
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ["ai-prompts", projectId] });
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "保存失败"),
  });

  const setDefault = useMutation({
    mutationFn: async (row: AiPromptRow) => {
      const body = {
        name: row.name,
        scene: row.scene,
        template: row.template,
        designMethod: row.designMethod ?? undefined,
        isDefault: true,
        enabled: row.enabled,
      };
      return updateAiPrompt(projectId!, row.id, body);
    },
    onSuccess: () => {
      message.success("已设为默认");
      void qc.invalidateQueries({ queryKey: ["ai-prompts", projectId] });
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "操作失败"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteAiPrompt(projectId!, id),
    onSuccess: () => {
      message.success("已删除");
      void qc.invalidateQueries({ queryKey: ["ai-prompts", projectId] });
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "删除失败"),
  });

  const SceneTable = () => (
    <Table<AiPromptRow>
      rowKey="id"
      size="small"
      loading={listQ.isLoading}
      dataSource={rows}
      locale={{ emptyText: <Empty description="暂无模板" data-testid="ai-prompt-empty" /> }}
      pagination={false}
      data-testid="ai-prompt-table"
      columns={[
        {
          title: "名称",
          dataIndex: "name",
          width: 180,
          render: (v, r) => <span data-testid={`ai-prompt-row-${r.name}`}>{v}</span>,
        },
        {
          title: "设计方法",
          dataIndex: "designMethod",
          width: 140,
          render: (v: string | null) =>
            v ? <Tag color="blue">{v}</Tag> : <span className="text-slate-300">—</span>,
        },
        {
          title: "默认",
          dataIndex: "isDefault",
          width: 70,
          render: (v: boolean) =>
            v ? (
              <span className="text-amber-500">★</span>
            ) : (
              <span className="text-slate-300">—</span>
            ),
        },
        {
          title: "启用",
          dataIndex: "enabled",
          width: 70,
          render: (v: boolean, r) => (
            <Switch
              size="small"
              checked={v}
              disabled={!canUpdate}
              loading={save.isPending}
              onChange={(checked) =>
                save.mutate({
                  name: r.name,
                  template: r.template,
                  designMethod: r.designMethod ?? undefined,
                  isDefault: checked ? r.isDefault : false,
                  enabled: checked,
                })
              }
            />
          ),
        },
        {
          title: "更新时间",
          dataIndex: "updatedAt",
          width: 140,
          render: (s: string) => (
            <span className="text-slate-400 text-xs">{s.replace("T", " ").slice(0, 16)}</span>
          ),
        },
        {
          title: "操作",
          key: "ops",
          width: 200,
          render: (_, r) => (
            <span className="space-x-2">
              {canUpdate && (
                <>
                  <a onClick={() => openEdit(r)}>编辑</a>
                  {!r.isDefault && r.enabled && (
                    <a
                      onClick={() => setDefault.mutate(r)}
                      data-testid={`ai-prompt-default-${r.name}`}
                    >
                      设为默认
                    </a>
                  )}
                </>
              )}
              {canDelete && (
                <Popconfirm title="删除该模板？" onConfirm={() => remove.mutate(r.id)}>
                  <a className="text-red-500">删除</a>
                </Popconfirm>
              )}
            </span>
          ),
        },
      ]}
    />
  );

  return (
    <div>
      <PageHeader
        title="AI 提示词"
        sub="用例生成的提示词模板（项目级共享）"
        extra={
          canCreate && (
            <Button type="primary" onClick={openCreate} data-testid="ai-prompt-create">
              ＋ 新建模板
            </Button>
          )
        }
      />
      {/* 一体式 Tabs（对齐消息管理）：内容挂在 children；padding 放卡片 div 上——
          Tailwind 工具类直接挂 antd 组件根（Tabs className）会被 antd 无层样式整体压制（实测 px-4 失效贴边） */}
      <div className="border rounded-lg bg-white px-4 pt-2 pb-3">
        <Tabs
          activeKey={scene}
          onChange={(k) => setScene(k as AiPromptScene)}
          items={(["case_gen", "api_gen"] as AiPromptScene[]).map((s) => ({
            key: s,
            label: AI_PROMPT_SCENE_LABEL[s],
            children: (
              <>
                <div className="pb-2 text-xs text-slate-400">
                  合法占位符：
                  {PROMPT_PLACEHOLDERS[s].map((p) => (
                    <Tag
                      key={p}
                      className="font-mono !text-[10px]"
                      color="purple"
                    >{`{{${p}}}`}</Tag>
                  ))}
                  ；无模板时生成抽屉回退「内置默认」；停用模板不出现在生成抽屉且不可为默认
                </div>
                <SceneTable />
              </>
            ),
          }))}
        />
      </div>
      <Drawer
        title={`${editing ? "编辑" : "新建"}模板 · ${AI_PROMPT_SCENE_LABEL[scene]}`}
        open={open}
        onClose={() => setOpen(false)}
        width={460}
        destroyOnClose
        extra={
          <Button
            type="primary"
            loading={save.isPending}
            onClick={() => form.validateFields().then((v) => save.mutate(v))}
            data-testid="ai-prompt-save"
          >
            保存
          </Button>
        }
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, message: "名称必填" }, { max: 64 }]}
          >
            <Input placeholder="如：边界值侧重" data-testid="ai-prompt-form-name" />
          </Form.Item>
          <Form.Item label="模板正文（占位符可点击插入）">
            <div className="flex gap-1 mb-1 flex-wrap">
              {placeholders.map((p) => (
                <Button
                  key={p}
                  size="small"
                  className="!px-1.5 !text-[10px] font-mono"
                  onClick={() => {
                    const cur = form.getFieldValue("template") ?? "";
                    form.setFieldValue("template", `${cur}{{${p}}}`);
                  }}
                >{`{{${p}}}`}</Button>
              ))}
            </div>
          </Form.Item>
          <Form.Item
            name="template"
            label="正文"
            rules={[{ required: true, message: "模板正文必填" }, { max: 8000 }]}
          >
            <Input.TextArea
              rows={8}
              className="font-mono text-xs"
              placeholder="提示词正文…占位符渲染时替换，缺失变量替换为空串"
              data-testid="ai-prompt-form-template"
            />
          </Form.Item>
          <Form.Item name="designMethod" label="设计方法">
            <Input placeholder="如：边界值分析" data-testid="ai-prompt-form-design" />
          </Form.Item>
          <div className="flex gap-1 flex-wrap mb-4">
            {DESIGN_SUGGESTIONS.map((d) => (
              <Button
                key={d}
                size="small"
                shape="round"
                className="!text-[10px]"
                onClick={() => form.setFieldValue("designMethod", d)}
              >
                {d}
              </Button>
            ))}
          </div>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="isDefault" label="设为该场景默认（同场景唯一）" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  );
}
