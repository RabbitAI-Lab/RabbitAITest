/** S11 UIT-002：/uit/demo 静态演示页（确定性 UI 测试目标——输入框+提交按钮+动态文案回显，无鉴权）。 */
import type { Hono } from "hono";

const PAGE = `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>UIT Demo</title>
<style>body{font-family:system-ui;margin:40px;max-width:520px}input,button{font-size:15px;padding:8px 12px}#result{margin-top:16px;padding:10px;border-radius:6px;background:#f0fff4;display:none}</style>
</head>
<body>
  <h1>UIT 演示页</h1>
  <label>用户名：<input id="username" data-testid="demo-username" placeholder="输入用户名"></label>
  <select id="level" data-testid="demo-level" style="margin-left:12px">
    <option value="normal">普通</option>
    <option value="vip">VIP</option>
  </select>
  <button id="submit-btn" data-testid="demo-submit" style="margin-left:12px">提交</button>
  <button id="screenshot-marker" data-testid="demo-marker" style="margin-left:12px">标记</button>
  <div id="result" class="demo-result-text" data-testid="demo-result"></div>
  <div id="marker-area" data-testid="demo-marker-area" style="display:none;margin-top:12px;color:#574BFF">标记已点亮</div>
  <script>
    document.getElementById('submit-btn').addEventListener('click', function () {
      var name = document.getElementById('username').value || 'guest';
      var level = document.getElementById('level').value;
      var el = document.getElementById('result');
      el.style.display = 'block';
      el.textContent = '提交成功，' + name + '（' + level + '）';
    });
    document.getElementById('screenshot-marker').addEventListener('click', function () {
      document.getElementById('marker-area').style.display = 'block';
    });
  </script>
</body>
</html>`;

export function mountUitDemo(app: Hono): void {
  app.get("/uit/demo", (c) => c.html(PAGE));
}
