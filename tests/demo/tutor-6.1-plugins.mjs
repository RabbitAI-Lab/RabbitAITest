/**
 * 教学视频 6.1 插件体系 场景模块（分镜表 S3~S7 录屏镜；片头/AI/字卡/片尾由 compose 管）。
 * 驱动：node scripts/tutor/record.mjs 6.1
 * 造数口径：演示插件包=仓库现成 plugins/dist/mqtt-1.0.0.tgz（PLUG-001-T5 multipart 直传口径，
 *  同名同版本幂等 201/409，天然「存在即复用」）。
 *
 * 与分镜表的已知差异（报告不改 docs）：
 *  - S4：「查看插件详情（配置 schema 表单）」在 UI 无详情抽屉/独立页——插件元数据（类型/版本/SPI/组织范围）
 *        以列表行内列呈现，本镜以行特写 + 表格缩放替代。
 *  - S5：「在执行链路以插件能力发起一次调试」依赖 websocket 类插件上传+启用+mock ws 栈——
 *        演示止步于接口调试页协议选择（插件注册的协议出现在下拉）、配置与执行入口特写，不真实执行。
 */
import path from "node:path";
import { sleep, ROOT } from "../../scripts/tutor/record-core.mjs";

const PLUGIN_TGZ = path.join(ROOT, "plugins/dist/mqtt-1.0.0.tgz");

/** 末尾补足：录屏镜总时长 ≥ 分镜表时长。 */
async function pad(t0, sec) {
  const need = sec * 1000 - (Date.now() - t0);
  if (need > 0) await sleep(need);
}

export const scenes = [
  {
    seg: "S3", // 40s /system/plugins：上传插件包（multipart 直传）→ 列表出现
    run: async (page, h) => {
      const t0 = Date.now();
      await h.goto("/system/plugins");
      await sleep(1000);
      await h.narrate("S3");
      await page
        .getByTestId("page-system-plugins")
        .waitFor({ timeout: 10000 })
        .catch(() => {});
      const hasMqtt = (await page.getByTestId("plugin-toggle-mqtt").count()) > 0;
      if (hasMqtt) {
        // 已上传（幂等复用）：直接列表特写
        await h.spotlight('[data-testid="plugin-toggle-mqtt"]', 1200);
      } else {
        const upload = page.getByTestId("plugin-upload-btn");
        if (await upload.count()) {
          await h.spotlight('[data-testid="plugin-upload-btn"]', 1000);
          await upload.click();
          await sleep(800);
          const fileInput = page.locator(".ant-modal input[type=file]");
          if (await fileInput.count()) {
            await fileInput.setInputFiles(PLUGIN_TGZ);
            await page
              .getByText("mqtt-1.0.0.tgz")
              .first()
              .waitFor({ timeout: 8000 })
              .catch(() => {});
            await sleep(900); // beforeUpload 状态落定（PLUG-001-T5 竞态教训）
            await page
              .getByRole("button", { name: "确认上传" })
              .click()
              .catch(() => {});
            await sleep(2200);
          }
        }
        await page
          .getByTestId("plugin-toggle-mqtt")
          .waitFor({ timeout: 15000 })
          .catch(() => {});
      }
      // 列表新增行特写（禁用态 → 开关）
      await h.spotlight('[data-testid="plugin-toggle-mqtt"]', 1100).catch(() => {});
      await h.zoom("main table, main .ant-table", 1.12, 600).catch(() => {});
      await sleep(1100);
      await h.reset();
      await pad(t0, 40);
    },
  },
  {
    seg: "S4", // 30s 启用插件 → 运行中；类型/版本/SPI 行内元数据特写（无详情抽屉）
    run: async (page, h) => {
      const t0 = Date.now();
      await h.goto("/system/plugins");
      await sleep(1000);
      await h.narrate("S4");
      const toggle = page.getByTestId("plugin-toggle-mqtt");
      if (await toggle.count()) {
        const row = page.locator("tr", { hasText: "mqtt" }).first();
        if (!(await row.getByText("运行中").count())) {
          await h.spotlight('[data-testid="plugin-toggle-mqtt"]', 900);
          await toggle.click().catch(() => {});
          await row
            .getByText("运行中")
            .waitFor({ timeout: 20000 })
            .catch(() => {});
        }
        await h.spotlight('[data-testid="plugin-toggle-mqtt"]', 1000);
        // 行内元数据（类型/版本/SPI/组织范围）特写——详情的 UI 实际形态
        await h.zoom("main table, main .ant-table", 1.18, 600).catch(() => {});
        await sleep(1600);
        await h.panTo("tbody tr:nth-child(1)").catch(() => {});
        await sleep(1000);
      } else {
        await h.spotlight("main", 1200).catch(() => {});
        await sleep(1400);
      }
      await h.reset();
      await pad(t0, 30);
    },
  },
  {
    seg: "S5", // 35s 执行链路使用插件能力：调试页协议下拉（插件注册的协议）+ 配置/执行入口
    run: async (page, h) => {
      const t0 = Date.now();
      await h.goto("/debug");
      await sleep(1200);
      await h.narrate("S5");
      const proto = page.getByTestId("debug-protocol");
      if (await proto.count()) {
        await h.spotlight('[data-testid="debug-protocol"]', 1200);
        // 打开协议下拉：插件注册的协议（tcp/mqtt/websocket…）在此出现
        await proto.click();
        await sleep(1000);
        await h
          .spotlight(".ant-select-dropdown:not(.ant-select-dropdown-hidden)", 1200)
          .catch(() => {});
        // 有 websocket 则选中演示协议面板（PLUG-003 口径），否则收起
        const ws = page
          .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
          .getByText("websocket", { exact: true });
        if (await ws.count()) {
          await ws.click().catch(() => {});
          await sleep(800);
          const tab = page.getByTestId("req-tab-protocol");
          if (await tab.count()) {
            await h.spotlight('[data-testid="req-tab-protocol"]', 900);
            await tab.click().catch(() => {});
            await sleep(800);
          }
          const cfg = page.getByTestId("req-protocol-config");
          if (await cfg.count()) {
            await h.spotlight('[data-testid="req-protocol-config"]', 1100);
          }
          const exec = page.getByTestId("btn-execute");
          if (await exec.count()) await h.spotlight('[data-testid="btn-execute"]', 900);
        } else {
          await page.keyboard.press("Escape");
          await sleep(500);
        }
      } else {
        await h.spotlight("main", 1500).catch(() => {});
        await sleep(1500);
      }
      await h.reset();
      await pad(t0, 35);
    },
  },
  {
    seg: "S6", // 20s 二态：禁用 → 已停用；重新启用恢复运行
    run: async (page, h) => {
      const t0 = Date.now();
      await h.goto("/system/plugins");
      await sleep(1000);
      await h.narrate("S6");
      const toggle = page.getByTestId("plugin-toggle-mqtt");
      if (await toggle.count()) {
        const row = page.locator("tr", { hasText: "mqtt" }).first();
        if (await row.getByText("运行中").count()) {
          await toggle.click().catch(() => {});
          await row
            .getByText("已停用")
            .waitFor({ timeout: 20000 })
            .catch(() => {});
          await h.spotlight('[data-testid="plugin-toggle-mqtt"]', 1100);
          await sleep(900);
          // 重新启用恢复
          await toggle.click().catch(() => {});
          await row
            .getByText("运行中")
            .waitFor({ timeout: 20000 })
            .catch(() => {});
          await sleep(800);
        }
      } else {
        await sleep(1600);
      }
      await h.reset();
      await pad(t0, 20);
    },
  },
  {
    seg: "S7", // 15s /system/audit-logs：插件上传/启停留痕
    run: async (page, h) => {
      const t0 = Date.now();
      await h.goto("/system/audit-logs");
      await sleep(1000);
      await h.narrate("S7");
      await page
        .getByTestId("page-system-audit-logs")
        .waitFor({ timeout: 10000 })
        .catch(() => {});
      const kw = page.getByTestId("audit-keyword");
      if (await kw.count()) {
        await kw.fill("插件");
        const go = page.getByTestId("audit-search-btn");
        if (await go.count()) await go.click();
        await sleep(1600);
      }
      await h.zoom("main table, main .ant-table", 1.12, 500).catch(() => {});
      await sleep(1200);
      await h.reset();
      await pad(t0, 15);
    },
  },
];
