'use strict';
// docs/legal/*.md(약관·처리방침·환불 안내)를 단순한 HTML 페이지로 바꾼다 → dist-public/legal/*.html
//   node scripts/build-legal.js
// 지원하는 마크다운: 제목(#~###), 목록(-, 1.), 표, 굵게, 코드, 링크, 문단. 그 외는 쓰지 않는다.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'docs', 'legal');
const outDir = path.join(root, 'dist-public', 'legal');
const PAGES = ['terms-of-service', 'privacy-policy', 'refund-policy'];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function inline(s) {
  s = esc(s);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/\[([^\]]+)\]\(([a-z-]+)\.md\)/g, (m, text, name) => PAGES.includes(name) ? `<a href="${name}.html">${text}</a>` : text);
  s = s.replace(/\[확인 필요([^\]]*)\]/g, '<mark>[확인 필요$1]</mark>');
  return s;
}
function convert(md) {
  const lines = md.replace(/\r/g, '').split('\n');
  const out = [];
  let i = 0, list = null, para = [];
  const flushPara = () => { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } };
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  while (i < lines.length) {
    const l = lines[i];
    let m;
    if (!l.trim()) { flushPara(); closeList(); i++; continue; }
    if ((m = l.match(/^(#{1,3}) (.*)$/))) { flushPara(); closeList(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); i++; continue; }
    if (l.startsWith('|') && lines[i + 1] && /^\|[-| ]+\|$/.test(lines[i + 1].trim())) {
      flushPara(); closeList();
      const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(l); i += 2; const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) { rows.push(cells(lines[i])); i++; }
      out.push('<div class="scroll"><table><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' +
        rows.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table></div>');
      continue;
    }
    if ((m = l.match(/^\s*([-*]|\d+\.) (.*)$/))) {
      flushPara();
      const kind = /\d/.test(m[1]) ? 'ol' : 'ul';
      if (list !== kind) { closeList(); out.push(`<${kind}>`); list = kind; }
      out.push('<li>' + inline(m[2]) + '</li>'); i++; continue;
    }
    closeList(); para.push(l.trim()); i++;
  }
  flushPara(); closeList();
  return out.join('\n');
}

const CSS = `:root{--ink:#15151a;--bg:#fff7e6;--card:#fff;--muted:#555;--line:#e0d8c4;--mark:#ffe58f}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]){--ink:#f3efe4;--bg:#15151a;--card:#1f1f26;--muted:#b9b4a6;--line:#38384a;--mark:#6b5a12}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.8 'Nanum Gothic','Malgun Gothic',sans-serif}
main{max-width:760px;margin:0 auto;padding:24px 16px 56px}.card{background:var(--card);border:2px solid var(--ink);border-radius:16px;padding:20px 22px}
h1{font-size:24px;margin:0 0 8px}h2{font-size:18px;margin:28px 0 6px}h3{font-size:16px}p,li{margin:6px 0}
.draft{border:2px dashed var(--ink);border-radius:12px;padding:10px 14px;margin:0 0 18px;font-size:14px}
.nav{margin:0 0 14px;font-size:14px}.nav a{color:inherit;margin-right:14px}a{color:inherit}
mark{background:var(--mark);color:inherit;padding:0 3px;border-radius:3px}code{font-size:.92em}
.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:14px}th,td{border:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}th{background:var(--line)}
footer{margin-top:20px;font-size:13px;color:var(--muted)}`;

function build() {
  fs.mkdirSync(outDir, { recursive: true });
  const nav = '<div class="nav"><a href="../">← 장부선생</a><a href="terms-of-service.html">이용약관</a><a href="privacy-policy.html">개인정보 처리방침</a><a href="refund-policy.html">환불·청약철회 안내</a></div>';
  for (const name of PAGES) {
    const md = fs.readFileSync(path.join(srcDir, name + '.md'), 'utf8');
    const title = (md.match(/^# (.*)$/m) || [, name])[1].replace(/\s*\(초안\)\s*/, '');
    const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title><style>${CSS}</style></head>
<body><main>${nav}<div class="card"><p class="draft"><b>초안</b> 아래 [확인 필요] 표시와 [대괄호] 항목은 판매 전에 확정합니다.</p>
${convert(md)}</div><footer>Copyright © madoo. All rights reserved.</footer></main></body></html>`;
    fs.writeFileSync(path.join(outDir, name + '.html'), html);
  }
  return { outDir, pages: PAGES.length };
}
module.exports = { build, convert };
if (require.main === module) { const r = build(); console.log('wrote', r.pages, 'pages →', r.outDir); }
