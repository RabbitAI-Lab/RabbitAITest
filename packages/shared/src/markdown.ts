/**
 * 受限 Markdown 子集（CASE-003 §1.2：粗体/斜体/列表/链接/代码块/表格；Sprint 1 不引入重型编辑器）。
 * 渲染采用「先整体 HTML 转义、再做标记替换」——标签由构造产生，天然防 XSS（security.md）。
 * 允许的链接协议：http/https/mailto（防 javascript: 注入）。
 */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeHref(raw: string): string | null {
  const href = raw.trim();
  return /^(https?:\/\/|mailto:)/i.test(href) ? href : null;
}

function inline(md: string): string {
  return md
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt: string) => escapeHtml(alt)) // 图片降级为文字
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text: string, url: string) => {
      const href = safeHref(url);
      return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${text}</a>` : m;
    })
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

/** 渲染为受限 HTML（块级：标题/列表/代码块/表格/段落；行内：粗斜体/行内码/链接） */
export function renderMarkdown(md: string): string {
  const lines = escapeHtml(md).split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.startsWith('```')) {
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? '').startsWith('```')) { buf.push(lines[i] ?? ''); i += 1; }
      i += 1;
      out.push(`<pre><code>${buf.join('\n')}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h && h[2] !== undefined) {
      const level = (h[1] ?? '#').length + 1;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      i += 1;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && (/^\s*[-*]\s+/.test(lines[i] ?? '') || /^\s*\d+\.\s+/.test(lines[i] ?? ''))) {
        items.push(`<li>${inline((lines[i] ?? '').replace(/^\s*(?:[-*]|\d+\.)\s+/, ''))}</li>`);
        i += 1;
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }
    if (line.startsWith('|') && i + 1 < lines.length && /^\|[\s:|-]+\|$/.test((lines[i + 1] ?? '').trim())) {
      const head = line.split('|').slice(1, -1).map((c) => c.trim());
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] ?? '').startsWith('|')) {
        rows.push((lines[i] ?? '').split('|').slice(1, -1).map((c) => c.trim()));
        i += 1;
      }
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>` +
        `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`,
      );
      continue;
    }
    if (line.trim() === '') { i += 1; continue; }
    const buf: string[] = [];
    while (i < lines.length) {
      const cur = lines[i] ?? '';
      if (cur.trim() === '' || cur.startsWith('```') || cur.startsWith('|') || /^#{1,4}\s/.test(cur) || /^\s*[-*]\s+/.test(cur) || /^\s*\d+\.\s+/.test(cur)) break;
      buf.push(cur);
      i += 1;
    }
    out.push(`<p>${buf.map(inline).join('<br/>')}</p>`);
  }
  return out.join('\n');
}

/** 受限语法白名单标记解析为纯文本摘要（列表页预览用） */
export function markdownExcerpt(md: string, max = 120): string {
  const plain = md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*`>|]/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > max ? `${plain.slice(0, max)}…` : plain;
}
