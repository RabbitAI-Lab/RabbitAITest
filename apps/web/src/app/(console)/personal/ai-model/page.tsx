"use client";

import { Alert, Button, Radio, Space, Tag, message } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { listEnabledAiModels, personalApi } from "@rabbit/api-client";

interface PickerModel {
  id: string;
  name: string;
  provider: string;
  model: string;
  isDefault: boolean;
}

/** SYS-007：个人默认模型（S7 挂点兑现：助手/生成优先使用 > 系统默认）。 */
export default function PersonalAiModelPage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const models = useQuery({
    queryKey: ["ai-model-picker"],
    queryFn: () => listEnabledAiModels(),
  });
  const pref = useQuery({
    queryKey: ["personal-ai-model"],
    queryFn: () => personalApi.aiModel(),
  });
  if (pref.data && !loaded) {
    setLoaded(true);
    setSelected(pref.data.modelId);
  }
  const list: PickerModel[] = models.data?.list ?? [];

  const save = useMutation({
    mutationFn: (modelId: string | null) => personalApi.saveAiModel(modelId),
    onSuccess: () => {
      message.success("已保存");
      void qc.invalidateQueries({ queryKey: ["personal-ai-model"] });
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "保存失败"),
  });

  return (
    <div className="rabbit-card p-4 max-w-lg" data-testid="page-personal-ai-model">
      {list.length === 0 ? (
        <Alert
          type="warning"
          showIcon
          message="系统内暂无启用的模型，请前往 系统管理-模型设置 配置"
          description={<a href="/system/ai-models">去系统管理-模型设置</a>}
        />
      ) : (
        <div className="space-y-3">
          <Radio.Group
            className="w-full"
            value={selected ?? undefined}
            onChange={(e) => setSelected(e.target.value)}
            data-testid="personal-ai-model-group"
          >
            <div className="border rounded divide-y text-[13px]">
              {list.map((m) => (
                <div key={m.id} className="flex items-center gap-2 px-3 py-2" data-testid={`personal-model-${m.name}`}>
                  <Radio value={m.id} />
                  <span className="font-medium">{m.name}</span>
                  <Tag>{m.provider}</Tag>
                  <span className="text-gray-400 font-mono text-xs">{m.model}</span>
                  {m.isDefault && (
                    <span className="ml-auto text-[10px] text-amber-500">★ 系统默认</span>
                  )}
                </div>
              ))}
            </div>
          </Radio.Group>
          <Space>
            <Button type="primary" loading={save.isPending} onClick={() => save.mutate(selected)} data-testid="personal-ai-model-save">
              保存
            </Button>
            <a className="text-xs text-[#574BFF] cursor-pointer" onClick={() => { setSelected(null); save.mutate(null); }} data-testid="personal-ai-model-clear">
              清除（用系统默认）
            </a>
          </Space>
          <Alert type="info" showIcon message="解析顺序：个人默认（启用中） > 系统默认；停用后自动回退系统默认" />
        </div>
      )}
    </div>
  );
}
