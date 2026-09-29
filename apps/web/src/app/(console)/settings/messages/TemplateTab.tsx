"use client";

import { Alert, Button, Drawer, Input, Popconfirm, Table } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { MESSAGE_EVENTS, TEMPLATE_VARS, type MessageEventKey } from "@rabbit/shared";
import { messageTemplateApi, type MessageTemplateRow } from "@rabbit/api-client";
import { useApp } from "@/hooks/useApp";
import { usePermissions } from "@/hooks/usePermissions";

/** ENTP-005 模板 Tab：左事件列表右编辑器（变量插入/实时预览/恢复默认）；MSG_TEMPLATE 门控。 */

export function TemplateTab({ projectId, enabled }: { projectId: string; enabled: boolean }) {
  const qc = useQueryClient();
  const { message } = useApp();
  const { can } = usePermissions();
  const canUpdate = can("PROJECT_MESSAGE:UPDATE");

  const [selectedEvent, setSelectedEvent] = useState<MessageEventKey>("BUG_CREATED");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [loadedEvent, setLoadedEvent] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ title: string; content: string } | null>(null);

  const templatesQ = useQuery({
    queryKey: ["message-templates", projectId],
    queryFn: () => messageTemplateApi.list(projectId),
  });

  const rows: MessageTemplateRow[] = templatesQ.data?.items ?? [];
  const current = rows.find((r) => r.event === selectedEvent) ?? null;

  // 选中事件时回填（仅切换时）
  if (loadedEvent !== selectedEvent) {
    setLoadedEvent(selectedEvent);
    setTitle(current?.title ?? "");
    setContent(current?.content ?? "");
    setPreview(null);
  }

  const refresh = () => void qc.invalidateQueries({ queryKey: ["message-templates", projectId] });

  const saveMut = useMutation({
    mutationFn: () =>
      messageTemplateApi.upsert(projectId, { event: selectedEvent, title, content }),
    onSuccess: () => {
      message.success("模板已保存（该事件通知将按模板渲染）");
      refresh();
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "保存失败"),
  });

  const resetMut = useMutation({
    mutationFn: () => messageTemplateApi.reset(projectId, selectedEvent),
    onSuccess: () => {
      message.success("已恢复默认模板");
      setTitle("");
      setContent("");
      setPreview(null);
      refresh();
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "恢复失败"),
  });

  const previewMut = useMutation({
    mutationFn: () =>
      messageTemplateApi.preview(projectId, { event: selectedEvent, title, content }),
    onSuccess: (r) => setPreview(r),
    onError: (e) => message.error(e instanceof Error ? e.message : "预览失败"),
  });

  const vars = useMemo(() => TEMPLATE_VARS[selectedEvent] ?? [], [selectedEvent]);
  const insert = (name: string) => {
    setContent((c) => `${c}\${${name}}`);
  };

  const editable = canUpdate && enabled;

  return (
    <div className="flex gap-4">
      {/* 左：事件列表 */}
      <div className="w-64 shrink-0 border rounded-md" data-testid="template-events">
        <div className="px-3 py-2 border-b text-sm font-medium flex items-center gap-2">
          消息模板
          <span className="text-[10px] text-[#A8ABB0] font-normal">
            {MESSAGE_EVENTS.length} 事件 · 5 大类
          </span>
        </div>
        {Array.from(new Set(MESSAGE_EVENTS.map((e) => e.group))).map((group) => (
          <div key={group}>
            <p className="px-3 pt-2 text-[11px] text-[#A8ABB0]">{group}</p>
            {MESSAGE_EVENTS.filter((e) => e.group === group).map((e) => {
              const row = rows.find((r) => r.event === e.key);
              return (
                <div
                  key={e.key}
                  className={`px-3 py-1.5 text-[13px] cursor-pointer flex items-center justify-between ${selectedEvent === e.key ? "bg-[#574BFF]/10 text-[#574BFF]" : "hover:bg-slate-50"}`}
                  onClick={() => setSelectedEvent(e.key)}
                  data-testid={`template-event-${e.key}`}
                >
                  <span>{e.label}</span>
                  {row?.customized ? (
                    <span className="text-[9px] border rounded px-1 border-[#574BFF]/40 text-[#574BFF]">
                      已定制
                    </span>
                  ) : (
                    <span className="text-[9px] text-[#A8ABB0]">默认</span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        {!enabled && (
          <Alert
            className="m-3"
            type="info"
            showIcon
            message="自定义消息模板为企业版能力（MSG_TEMPLATE）"
            data-testid="template-locked-alert"
          />
        )}
      </div>

      {/* 右：编辑器 */}
      <div className="flex-1 space-y-3">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">
            {MESSAGE_EVENTS.find((e) => e.key === selectedEvent)?.label}
          </span>
          <span className="text-[11px] text-[#A8ABB0]">
            模板渲染结果进全部渠道：站内信 / 邮件 / 机器人
          </span>
        </div>
        <div
          className={editable ? "" : "opacity-60 pointer-events-none"}
          data-testid="template-editor"
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-[#646A73] text-xs">标题（≤128）</span>
            <span className="text-[10px] text-[#A8ABB0]">{title.length}/128</span>
          </div>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={128}
            className="font-mono text-xs"
            placeholder="如：[${project}] ${actorName} 提交了缺陷 ${title}"
            data-testid="input-template-title"
          />
          <div className="flex items-center justify-between mb-1 mt-2">
            <span className="text-[#646A73] text-xs">内容（≤1024，支持换行）</span>
            <span className="text-[10px] text-[#A8ABB0]">{content.length}/1024</span>
          </div>
          <Input.TextArea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            maxLength={1024}
            rows={5}
            className="font-mono text-xs"
            placeholder={"【${title}】\n处理人：${assignee} · 状态：${status}\n操作时间：${time}"}
            data-testid="input-template-content"
          />
          <div className="border rounded p-2 bg-slate-50 mt-2">
            <p className="text-[#646A73] text-xs mb-1.5">插入变量（点击插入到内容光标处）</p>
            <div className="flex flex-wrap gap-1">
              {vars.map((v) => (
                <button
                  key={v.name}
                  className="border rounded px-2 py-0.5 text-[11px] bg-white hover:border-[#574BFF]"
                  onClick={() => insert(v.name)}
                  title={v.label}
                  data-testid={`var-chip-${v.name}`}
                >
                  {`\${${v.name}}`}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-[#A8ABB0] mt-1.5">
              未知变量渲染时保留原样；用例自定义字段变量登记 Backlog
            </p>
          </div>
          <div className="flex gap-2 mt-3">
            <Button
              type="primary"
              disabled={!editable || !title.trim() || !content.trim()}
              loading={saveMut.isPending}
              onClick={() => saveMut.mutate()}
              data-testid="btn-template-save"
            >
              保存
            </Button>
            <Button
              disabled={!editable || !title.trim() || !content.trim()}
              loading={previewMut.isPending}
              onClick={() => previewMut.mutate()}
              data-testid="btn-template-preview"
            >
              实时预览
            </Button>
            <Popconfirm
              title="恢复该事件默认模板？"
              onConfirm={() => resetMut.mutate()}
              disabled={!editable || !current?.customized}
            >
              <Button
                danger
                disabled={!editable || !current?.customized}
                data-testid="btn-template-reset"
              >
                恢复默认
              </Button>
            </Popconfirm>
          </div>
        </div>
        {preview && (
          <div className="border rounded p-3 bg-slate-50" data-testid="template-preview">
            <p className="text-[#646A73] text-xs mb-2">实时预览（示例数据填充，服务端渲染）</p>
            <div className="bg-white border rounded p-2.5 text-xs space-y-1">
              <p className="font-medium">{preview.title}</p>
              <p className="text-[#646A73] whitespace-pre-wrap font-mono">{preview.content}</p>
            </div>
          </div>
        )}
        {/* 变量目录表（走查参考） */}
        <Table
          size="small"
          rowKey="name"
          dataSource={vars}
          pagination={false}
          columns={[
            {
              title: "变量",
              dataIndex: "name",
              render: (v: string) => <span className="font-mono text-xs">{`$\{${v}}`}</span>,
            },
            { title: "说明", dataIndex: "label" },
          ]}
        />
      </div>
      <Drawer open={false} title="预览">
        <span />
      </Drawer>
    </div>
  );
}
