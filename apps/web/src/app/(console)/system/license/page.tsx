"use client";

import { Alert, Badge, Button, Empty, Input, Modal, Popconfirm, Space, Table, Tag } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { licenseApi, type LicenseStatus } from "@rabbit/api-client";
import { ENTP_FEATURES } from "@rabbit/shared";
import { PageHeader } from "@/components/PageHeader";
import { useApp } from "@/hooks/useApp";
import { usePermissions } from "@/hooks/usePermissions";
import { useInvalidateEntp } from "@/hooks/useEntp";

/** ENTP-007 授权管理：状态卡（社区版⇄企业版）+ 功能矩阵 + 添加/移除。 */

export default function LicensePage() {
  const qc = useQueryClient();
  const invalidateEntp = useInvalidateEntp();
  const { message } = useApp();
  const { canGlobal } = usePermissions();
  const canRead = canGlobal("SYSTEM_LICENSE:READ");
  const canUpdate = canGlobal("SYSTEM_LICENSE:UPDATE");

  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState("");

  const statusQ = useQuery({
    queryKey: ["system-license"],
    queryFn: () => licenseApi.status(),
    enabled: canRead,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["system-license"] });
    invalidateEntp();
  };

  const addMut = useMutation({
    mutationFn: () => licenseApi.add(code.trim()),
    onSuccess: (s) => {
      message.success(
        s.edition === "ENTERPRISE" ? `企业版授权已生效（剩余 ${s.daysLeft} 天）` : "已保存",
      );
      setAdding(false);
      setCode("");
      refresh();
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "添加失败"),
  });

  const removeMut = useMutation({
    mutationFn: () => licenseApi.remove(),
    onSuccess: () => {
      message.success("已移除授权，回退社区版");
      refresh();
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "移除失败"),
  });

  if (!canRead) {
    return (
      <div>
        <PageHeader title="授权管理" sub="系统 › 授权管理" />
        <Empty className="py-24" description="无访问权限（SYSTEM_LICENSE:READ）" />
      </div>
    );
  }

  const s: LicenseStatus | undefined = statusQ.data;
  const enterprise = s?.edition === "ENTERPRISE";
  const expiringSoon = enterprise && (s?.daysLeft ?? 999) <= 30;
  // ENTP-009：开源全功能模式（默认）——License 仅作授权信息，不门控任何功能
  const gate = s?.featureGateEnabled ?? false;

  return (
    <div>
      <PageHeader
        title="授权管理"
        sub={
          gate
            ? "系统 › 授权管理 · 企业版功能总开关（License）"
            : "系统 › 授权管理 · 授权信息管理（开源全功能：License 不门控，ENTP-009）"
        }
        extra={
          canUpdate && (
            <Space>
              {enterprise ? (
                <>
                  <Button onClick={() => setAdding(true)} data-testid="btn-replace-license">
                    更换
                  </Button>
                  <Popconfirm
                    title={
                      gate
                        ? "移除后回退社区版（多组织/SSO/多资源池等将锁定）"
                        : "移除授权信息（开源全功能模式下所有功能不受影响）"
                    }
                    onConfirm={() => removeMut.mutate()}
                  >
                    <Button danger data-testid="btn-remove-license">
                      移除
                    </Button>
                  </Popconfirm>
                </>
              ) : (
                <Button
                  type="primary"
                  onClick={() => setAdding(true)}
                  data-testid="btn-add-license"
                >
                  添加 License
                </Button>
              )}
            </Space>
          )
        }
      />

      {/* 到期提醒（基线 ms-expire-alert 语义） */}
      {enterprise && expiringSoon && (
        <Alert
          type={s?.daysLeft === 0 ? "error" : "warning"}
          showIcon
          className="mb-4"
          message={
            s?.daysLeft === 0
              ? "企业版授权已过期（现有数据保留）"
              : gate
                ? `企业版授权将于 ${s?.daysLeft} 天后到期，到期后企业功能将锁定`
                : `企业版授权将于 ${s?.daysLeft} 天后到期（开源全功能模式，功能不受影响）`
          }
          data-testid="license-expire-banner"
        />
      )}

      {/* 状态卡 */}
      <div className="rabbit-card p-5 mb-4" data-testid="license-status-card">
        <div className="flex items-center gap-3">
          <span
            className={`w-12 h-12 rounded-lg flex items-center justify-center text-2xl ${enterprise ? "bg-[#574BFF] text-white" : "bg-slate-100"}`}
          >
            🐇
          </span>
          <div>
            <p className="font-medium text-[15px] flex items-center gap-2">
              RabbitAITest
              {enterprise ? (
                <Tag color="purple" bordered={false} data-testid="license-badge-enterprise">
                  企业版
                </Tag>
              ) : (
                <Tag bordered={false} data-testid="license-badge-community">
                  社区版
                </Tag>
              )}
            </p>
            <p className="text-xs text-[#87888D]" data-testid="license-status-sub">
              {enterprise
                ? `序列号 ${s?.lic ?? "—"} · 剩余 ${s?.daysLeft} 天（${s?.expiresAt?.slice(0, 10)} 到期） · 用户上限 ${s?.maxUsers ?? "不限"}`
                : gate
                  ? "开源许可 · 当前部署为社区版"
                  : "开源全功能 · 所有能力开放，License 不门控（ENTP-009）"}
            </p>
          </div>
        </div>
        {!enterprise && (
          <div className="mt-3 border-t border-[#F0F1F3] pt-3">
            <p className="text-xs text-[#646A73] mb-1.5">
              {gate ? "社区版容量与能力" : "开源版（全功能）"}
            </p>
            <div
              className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-[#646A73] md:grid-cols-3"
              data-testid="community-limits"
            >
              {gate ? (
                <>
                  <span>· 1 个组织</span>
                  <span>· 30 名用户</span>
                  <span>· 1 个默认资源池</span>
                  <span>· 默认主题</span>
                  <span>· 固定消息模板</span>
                  <span>· 账号密码登录</span>
                </>
              ) : (
                <>
                  <span>· 多组织 / 部门</span>
                  <span>· 用户数不限</span>
                  <span>· 多资源池</span>
                  <span>· 自定义主题</span>
                  <span>· 自定义消息模板 / SSO</span>
                  <span>· 性能测试 / UI 测试</span>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 功能矩阵 */}
      <div className="rabbit-card">
        <div className="p-3 border-b border-[#F0F1F3] font-medium text-sm">企业能力矩阵</div>
        <Table
          rowKey={(f) => f.key}
          loading={statusQ.isLoading}
          dataSource={ENTP_FEATURES.map((f) => ({
            ...f,
            enabled: s?.features?.includes(f.key) ?? false,
          }))}
          data-testid="license-feature-matrix"
          pagination={false}
          columns={[
            { title: "企业能力", dataIndex: "label" },
            {
              title: "规格",
              dataIndex: "spec",
              width: 130,
              render: (v: string) => <span className="font-mono text-xs text-[#87888D]">{v}</span>,
            },
            {
              title: "状态",
              dataIndex: "enabled",
              width: 160,
              render: (enabled: boolean) =>
                enterprise && enabled ? (
                  <Badge
                    status="processing"
                    text={<span data-testid={`feature-${enabled ? "on" : "off"}`}>已授权</span>}
                  />
                ) : !gate ? (
                  <Badge
                    status="success"
                    text={<span data-testid="feature-on">已开放（开源版）</span>}
                  />
                ) : (
                  <span className="text-xs text-[#A8ABB0]" data-testid="feature-state">
                    {enterprise ? "未包含在当前授权中" : "🔒 未授权"}
                  </span>
                ),
            },
          ]}
        />
      </div>

      {/* 添加弹窗 */}
      <Modal
        title="添加 License"
        open={adding}
        onCancel={() => setAdding(false)}
        okText="校验并添加"
        confirmLoading={addMut.isPending}
        okButtonProps={{ disabled: code.trim().length < 16 }}
        onOk={() => addMut.mutate()}
      >
        <Input.TextArea
          rows={5}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="粘贴 License 内容（RABBIT-ENT1.….…）"
          className="font-mono text-xs"
          data-testid="input-license-code"
        />
        <p className="text-xs text-[#A8ABB0] mt-2">
          三重校验：结构（90002）→ 验签（90003）→ 期限（90004）；开发模式可用
          scripts/gen-license.mjs 签发。
        </p>
      </Modal>
    </div>
  );
}
