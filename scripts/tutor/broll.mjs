#!/usr/bin/env node
/**
 * broll.mjs — MiniMax 海螺（Hailuo）视频生成客户端（scripts/tutor 四件套之一）
 *
 * 用法:
 *   node scripts/tutor/broll.mjs <assetId> [--force]   # 单个素材：提交→轮询→下载（幂等，断点续查）
 *   node scripts/tutor/broll.mjs batch <n>             # 批量：按注册顺序生成 n 个未完成素材
 *   node scripts/tutor/broll.mjs status                # 全部素材完成度一览
 *
 * 约定（见 docs/tutorials/README.md）:
 * - 密钥只从环境变量 MINIMAX_API_KEY 读取；仓库根 .env.local（gitignored）作为无人值守兜底加载
 * - 素材提示词唯一事实源: docs/tutorials/series-outline.md（片头）与各集制作稿，此处登记必须一字不差
 * - 幂等: portal/assets/tutor/broll/.state.json 记录 taskId/fileId/status，重跑续查；Fail 自动重提
 * - 产物: portal/assets/tutor/broll/{assetId}.mp4
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const OUT_DIR = path.join(ROOT, "portal", "assets", "tutor", "broll");
const STATE_FILE = path.join(OUT_DIR, ".state.json");

// 无人值守兜底：环境变量优先，其次加载 gitignored 的 .env.local（仅本仓库根）
for (const [k, v] of Object.entries(loadLocalEnv())) {
  if (!process.env[k]) process.env[k] = v;
}
function loadLocalEnv() {
  const file = path.join(ROOT, ".env.local");
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(\S+)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const BASE = process.env.MINIMAX_BASE_URL ?? "https://api.minimax.cn";
const KEY = process.env.MINIMAX_API_KEY;
if (!KEY) {
  console.error("[fatal] 缺 MINIMAX_API_KEY（环境变量或 .env.local）");
  process.exit(1);
}

const STYLE =
  "扁平低多边形3D插画风格，深蓝色科技空间背景（由深靛蓝到暗夜蓝的柔和渐变），主体以靛蓝色 #2545eb 与白色发光材质为主，辅以青色粒子光效点缀，电影级柔光，画面干净克制，无人物。";

// 素材注册表：与 docs/tutorials 制作稿一字不差；顺序即生成顺序（集号序）
const ASSETS = {
  "broll-intro": {
    src: "series-outline.md §3.3",
    prompt:
      STYLE +
      "一只发光的白色卡通兔子剪影站在悬浮的环形全息工作台中央，抬手轻点，三道靛蓝色光流从画面三个方向汇入工作台，工作台亮起并升腾起环绕的粒子星环，镜头围绕工作台缓慢环绕上升，最后收束定格为一枚发光的兔耳形几何徽标。",
    duration: 6,
  },
  "broll-1.1": {
    src: "1.1-course-intro.md",
    prompt:
      STYLE +
      "三道发着微光的光流分别从画面左、右、下方汇入中央一座悬浮的环形工作台装置：第一道光流携带着发光的卡片与图表几何体，第二道光流携带着插头与接口的几何造型，第三道光流携带着神经元般的星尘；三道光在工作台上方交汇，装置整体亮起，绽放出一圈缓缓扩散的光环。",
    duration: 10,
  },
  "broll-1.2": {
    src: "1.2-quick-start.md",
    prompt:
      STYLE +
      "一颗发光的种子落入深蓝色的数字土壤，迅速生根发芽，长成一棵由发光几何面板与卡片组成的界面之树，枝头结出一枚枚青色光点果实，一只白色兔子剪影绕树奔跑，经过的枝条依次被点亮，整棵树最终稳定地悬浮发光，镜头缓慢环绕上升。",
    duration: 10,
  },
  "broll-2.1": {
    src: "2.1-concepts.md",
    prompt:
      STYLE +
      "一座悬浮在深空中的发光图书馆，中央一根发光的主干像树一样向上分出层层枝干，每根枝干上依次亮起一张张悬浮的发光卡片，卡片沿分支整齐归档排列；镜头从底部主干缓缓上升并轻微环绕，展现整棵卡片树的层级结构，最后整树脉动一次确认归档完成。",
    duration: 10,
  },
  "broll-2.2": {
    src: "2.2-functional-cases.md",
    prompt:
      STYLE +
      "一条发光的悬浮流水线横贯画面，一张白色的空白卡片从左侧进入：经过第一站，卡片边缘被靛蓝色光描出轮廓；经过第二站，卡片内部亮起几何图形的结构；经过第三站，卡片升起一枚青色对勾光标，最终成型，飞入画面右上方一面由众多发光卡片组成的弧形卡片墙，墙面涟漪般亮起。镜头缓慢横移跟随卡片。",
    duration: 10,
  },
  "broll-2.3": {
    src: "2.3-case-review.md",
    prompt:
      STYLE +
      "一张巨大的发光蓝图悬浮在画面中央，四束来自不同角度的锥形光束同时投向蓝图，被照到的区域逐块由线框变为实心发光体；随后一枚青色圆形印章光效从上方缓缓落下，盖在蓝图一角激起一圈光环，蓝图整体亮度提升一级并轻微旋转展示。镜头先缓慢推近再环绕四分之一圈。",
    duration: 10,
  },
  "broll-2.4": {
    src: "2.4-bug-management.md",
    prompt:
      STYLE +
      "一台精密的机械装置中，一颗闪烁的红色警示灯球被两根发光机械臂轻柔捕获，装入一只透明的青边玻璃罐，罐口合拢时激起一圈光环；随后玻璃罐被平稳放上身后一面多层悬浮货架，货架上既有红灯罐也有已变为柔和绿色的罐子，新罐落位后整排货架灯带依次点亮。镜头从装置近景缓慢拉远展现整面货架。",
    duration: 10,
  },
  "broll-2.5": {
    src: "2.5-test-plans.md",
    prompt:
      STYLE +
      "一座悬浮的环形轨道调度场，多列由发光车厢组成的列车沿不同轨道并行驶向中央站台；中央一座灯塔状调度塔向每节车厢发出青色点名光束，被照到的车厢亮起并转为绿色；完成的列车缓缓升起一圈绿色光环后驶入内环停稳。镜头从高处俯瞰缓慢下降环绕四分之一圈。",
    duration: 10,
  },
  "broll-3.1": {
    src: "3.1-concepts.md",
    prompt:
      STYLE +
      "画面左右两侧各悬浮一个巨大的发光几何体：左侧是插头造型，右侧是插座造型，二者在镜头前缓缓相向移动并精准对接；对接瞬间接触点迸发一圈光环，白色电流光束沿电缆奔涌向前，在画面深处分成三条支路，每条支路末端依次亮起青色指示灯。镜头从侧面缓慢推近对接点再微微拉远。",
    duration: 10,
  },
  "broll-3.2": {
    src: "3.2-api-debug.md",
    prompt:
      STYLE +
      "一台未来感的悬浮示波器，屏幕上起初跳动着杂乱扭曲的白色波形；一只发光的机械臂转动侧面的圆形旋钮，每转一格，波形就变得规整一分，杂乱波峰逐渐收敛为整齐的绿色脉冲序列，屏幕边缘的环形仪表指针从红区缓缓摆入绿区，最终整块屏幕泛起柔和的绿色辉光。镜头从斜侧方缓慢推近屏幕。",
    duration: 10,
  },
  "broll-3.3": {
    src: "3.3-definitions-and-cases.md",
    prompt:
      STYLE +
      "一张巨大的发光工程蓝图在画面中央缓缓展开，靛蓝色的光线沿图纸上的轮廓线游走勾勒，线条升起变成立体构件，构件咬合组成一座精密的立体结构装置；装置成型后，从它的边缘分化出一张张小型发光卡片，卡片呈矩阵阵列悬浮在装置右侧，镜头从蓝图正面缓慢环绕到卡片阵列一侧。",
    duration: 10,
  },
  "broll-3.4": {
    src: "3.4-scenarios.md",
    prompt:
      STYLE +
      "一组大小不一的发光齿轮悬浮排列在深空中，第一颗齿轮被一圈青色光晕激活开始转动，依次带动下一颗齿轮咬合转动，能量光沿齿轮组链条式传导；链条末端的一颗小球被精准弹入一条弧形轨道，沿轨道滑行一周后回到起点，形成闭环，闭环完成的瞬间整组齿轮整体亮度提升并保持匀速转动。镜头从齿轮组侧面缓慢横移跟随能量传导方向。",
    duration: 10,
  },
  "broll-3.5": {
    src: "3.5-execution-and-pools.md",
    prompt:
      STYLE +
      "四条平行的发光泳道像水渠一样横贯画面，多个白色光球同时在不同泳道中向前冲刺，各自拖出青色轨迹；泳道入口处有一道发光水闸，按固定节奏抬起放行新的光球入场；先到的光球在终点线处依次汇入一个发光的玻璃容器堆叠，容器刻度随汇入逐格点亮。镜头从泳道斜上方缓慢横移扫过全程。",
    duration: 10,
  },
  "broll-3.6": {
    src: "3.6-reports.md",
    prompt:
      STYLE +
      "无数细小的青色数据粒子从画面四面八方缓缓汇聚到中央，先是杂乱漂浮，随后在无形力量下自动排列组合：一部分聚成一组高低错落的发光柱状体，另一部分环绕成一个环形图，柱与环依次点亮；整组图表缓慢自转展示全景，粒子仍在图表边缘如星尘般环绕流动。镜头缓慢推近再微微拉远。",
    duration: 10,
  },
  "broll-4.1": {
    src: "4.1-org-projects-members.md",
    prompt:
      STYLE +
      "一座悬浮的立体城市由多座玻璃塔楼组成，塔楼逐层点亮暖白与靛蓝交替的窗格；小型发光无人机像光点一样在楼宇之间穿梭，向不同楼层投递发光包裹，收到包裹的楼层窗格转为青色；城市整体缓缓旋转，远处还有另一座独立的城市轮廓在薄雾中亮起。镜头从城市边缘缓慢环绕推进。",
    duration: 10,
  },
  "broll-4.2": {
    src: "4.2-groups-permissions.md",
    prompt:
      STYLE +
      "一条深邃的发光长廊向远处延伸，两侧依次排列着一扇扇几何造型的大门；一枚发光的青边钥匙悬浮在长廊中央缓缓前行，每经过一扇门便短暂停顿试锁：有的门锁亮起绿灯并向内开启一道光缝，有的门锁亮起红光保持紧闭；长廊尽头是一扇最华丽的主门，钥匙插入后整条长廊的灯带依次点亮。镜头在钥匙后方跟随前进，浅景深。",
    duration: 10,
  },
  "broll-4.3": {
    src: "4.3-messages-notifications.md",
    prompt:
      STYLE +
      "一座发光的灯塔矗立在深蓝空间中央，塔顶灯室亮起并射出一圈光环；数十枚信使光点从灯塔四散飞出，抵达远处悬浮的各个终端几何体，终端亮起回执光环后，部分光点携带着细小的光尘返航，汇入灯塔顶部缓缓旋转的收集环；每收到一枚回执，收集环就增亮一分。镜头从灯塔底部缓慢上升环绕至塔顶俯瞰全局。",
    duration: 10,
  },
  "broll-5.1": {
    src: "5.1-ai-assistant.md",
    prompt:
      STYLE +
      "一团缓缓旋转的靛蓝色星云悬浮在画面中央，核心是一只瞳孔状的光核，随呼吸般明灭；几缕思维光丝从光核延伸而出，分别触碰悬浮在四周的几块棱柱状问题晶体，被触碰的晶体由暗转亮，内部泛起青色光泽；当所有晶体点亮，星云整体舒展放大一圈，光丝收拢回核心。镜头缓慢推近星云核心再轻微拉远。",
    duration: 10,
  },
  "broll-5.2": {
    src: "5.2-ai-generate-cases.md",
    prompt:
      STYLE +
      "一团靛蓝色星云在画面上方缓缓洒落发光光尘，光尘在半空中逐颗折叠、展开，变成一张张白色发光卡片；卡片自动排列成一个整齐的矩阵阵列悬浮在画面中央，一只白色兔子剪影沿阵列下方走过，经过的卡片依次亮起青色确认光点；当整阵列全部点亮，矩阵整体轻轻上浮并稳定发光。镜头从斜下方缓慢上升掠过矩阵表面。",
    duration: 10,
  },
  "broll-6.1": {
    src: "6.1-plugins.md",
    prompt:
      STYLE +
      "一块巨大的悬浮主板横贯画面，电路纹路发出微光；一枚发光的青边功能模块从上方缓缓下降，精准压入主板上一个空缺的插槽，咬合瞬间接触点迸发一圈光环，电流光沿主板电路奔涌扩散，整块主板亮度提升一级，主板边缘又缓缓生长出两个新的空插槽。镜头从模块正上方缓慢环绕下降至侧后方。",
    duration: 10,
  },
  "broll-6.2": {
    src: "6.2-open-integration.md",
    prompt:
      STYLE +
      "一片深蓝海面上散布着多座悬浮岛屿，中央是一座亮着灯塔的主动力岛；一道道发光的光桥从中央岛缓缓延伸架设，逐架连通周围各岛，桥面合拢时激起涟漪光环；桥通之后，青色光点像物流车队般在桥面往返穿行，各岛地标依次亮起，整片群岛最终连成一张脉动的光网。镜头从高空缓慢下降环绕。",
    duration: 10,
  },
};

const MODEL = "MiniMax-Hailuo-2.3";
const RESOLUTION = "768P";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(pathname, init = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  return { http: res.status, body };
}

function die(baseResp, when, http) {
  const code = baseResp?.status_code ?? 0;
  if (code !== 0 || (http && http >= 400 && code === 0)) {
    console.error(
      `[fail:${when}] http=${http ?? 0} base_resp=${code} ${baseResp?.status_msg ?? "(无错误详情)"}`,
    );
    console.error("常见: 1004/2049=密钥无效或无权限, 1008=余额不足, 1002=限流");
    return true;
  }
  return false;
}

async function loadState() {
  if (!existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(await readFile(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

async function saveState(state) {
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

function outFile(id) {
  return path.join(OUT_DIR, `${id}.mp4`);
}

function isDone(state, id) {
  return state[id]?.status === "Success" && existsSync(outFile(id));
}

async function ensureTask(state, id, force) {
  const prev = state[id];
  if (!force && prev?.taskId && prev.status !== "Fail" && prev.status !== "Success") {
    return prev.taskId; // 断点续查：任务在途
  }
  if (!force && isDone(state, id)) return null; // 已完成
  const a = ASSETS[id];
  const promptHash = crypto.createHash("sha256").update(a.prompt).digest("hex").slice(0, 12);
  console.log(`[submit] ${id} ${RESOLUTION}/${a.duration}s prompt#${promptHash}`);
  const { http, body } = await api("/v1/video_generation", {
    method: "POST",
    body: JSON.stringify({
      model: MODEL,
      prompt: a.prompt,
      duration: a.duration,
      resolution: RESOLUTION,
      fast_pretreatment: true,
    }),
  });
  if (die(body.base_resp, "submit", http)) throw new Error(`submit ${id}`);
  console.log(`[submit] ok taskId=${body.task_id}`);
  state[id] = { taskId: body.task_id, status: "Submitted", promptHash, model: MODEL };
  await saveState(state);
  return body.task_id;
}

async function pollOnce(state, id) {
  const taskId = state[id].taskId;
  const { http, body } = await api(`/v1/query/video_generation?task_id=${taskId}`);
  if (die(body.base_resp, "query", http)) throw new Error(`query ${id}`);
  console.log(`[poll] ${id} ${body.status}`);
  state[id].status = body.status;
  if (body.status === "Success") state[id].fileId = body.file_id;
  await saveState(state);
  return body.status;
}

async function runAsset(id, force) {
  const state = await loadState();
  if (!force && isDone(state, id)) {
    console.log(`[skip] ${id} 已完成`);
    return true;
  }
  let taskId = await ensureTask(state, id, force);
  if (taskId === null) return true;
  const deadline = Date.now() + 8 * 60_000;
  while (Date.now() < deadline) {
    const status = await pollOnce(state, id);
    if (status === "Success") return await download(state, id);
    if (status === "Fail") {
      console.error(`[fail:generate] ${id} 生成失败（状态已记录，下轮自动重提）`);
      return false;
    }
    await sleep(8_000);
  }
  console.log(`[info] ${id} 本轮窗口未完成，任务仍在途，稍后重跑续查`);
  return false;
}

async function download(state, id) {
  const fileId = state[id].fileId;
  const { http, body } = await api(`/v1/files/retrieve?file_id=${fileId}`);
  if (die(body.base_resp, "retrieve", http)) throw new Error(`retrieve ${id}`);
  let url = body.file?.download_url;
  if (!url) throw new Error("retrieve 未返回 download_url");
  if (!/^https?:/.test(url)) url = `https://${url}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`[fail:download] ${id} http=${res.status}`);
    return false;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(outFile(id), buf);
  state[id].file = path.relative(ROOT, outFile(id));
  state[id].bytes = buf.length;
  await saveState(state);
  console.log(`[done] ${outFile(id)} (${(buf.length / 1024 / 1024).toFixed(2)} MB)`);
  return true;
}

function printStatus(state) {
  const ids = Object.keys(ASSETS);
  const done = ids.filter((id) => isDone(state, id));
  console.log(`完成 ${done.length}/${ids.length}`);
  for (const id of ids) {
    const s = state[id] ?? {};
    console.log(
      `  ${isDone(state, id) ? "✓" : "·"} ${id.padEnd(12)} ${s.status ?? "-"} ${s.file ?? ""}`,
    );
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd) {
    console.error(
      `用法:\n  node scripts/tutor/broll.mjs <assetId> [--force]\n  node scripts/tutor/broll.mjs batch <n>\n  node scripts/tutor/broll.mjs status\n可用素材: ${Object.keys(ASSETS).join(", ")}`,
    );
    process.exit(1);
  }
  if (cmd === "status") {
    printStatus(await loadState());
    return;
  }
  if (cmd === "batch") {
    const limit = Math.max(1, Number.parseInt(rest[0] ?? "3", 10));
    const state = await loadState();
    const pending = Object.keys(ASSETS)
      .filter((id) => !isDone(state, id))
      .slice(0, limit);
    console.log(
      `[batch] 待生成 ${pending.length} 个（限额 ${limit}）: ${pending.join(", ") || "无"}`,
    );
    let ok = 0;
    for (const id of pending) {
      try {
        if (await runAsset(id, false)) ok += 1;
      } catch (e) {
        console.error(`[fail] ${id}: ${e.message}`);
      }
    }
    const after = await loadState();
    const remain = Object.keys(ASSETS).filter((id) => !isDone(after, id)).length;
    console.log(`[batch] 完成 ${ok}/${pending.length}，剩余未完成 ${remain}`);
    printStatus(after);
    return;
  }
  if (!ASSETS[cmd]) {
    console.error(`未知素材 '${cmd}'。可用: ${Object.keys(ASSETS).join(", ")}`);
    process.exit(1);
  }
  const ok = await runAsset(cmd, rest.includes("--force"));
  process.exit(ok ? 0 : 5);
}

await main();
