import { h } from './react.js';

// A small Markdown reader for Foreman's own reports, so the dashboard shows them as the Foreman session does.
// It builds React elements only (never HTML strings), and links open only for http(s) URLs.

// Underscores inside a word (git_log_file.md) stay literal, as in ordinary Markdown.
const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*|(?<![\p{L}\p{N}_])__[^_]+__(?![\p{L}\p{N}_]))|(\*[^*\s][^*]*\*|(?<![\p{L}\p{N}_])_[^_\s][^_]*_(?![\p{L}\p{N}_]))|(\[[^\]]+\]\([^)\s]+\))/u;

function inline(text, key = 'i') {
  const out = [];
  let rest = text, n = 0;
  while (rest) {
    const m = rest.match(INLINE);
    if (!m) { out.push(rest); break; }
    if (m.index) out.push(rest.slice(0, m.index));
    const tok = m[0], k = key + '.' + n++;
    if (m[1]) out.push(h('code', { key: k }, tok.slice(1, -1)));
    else if (m[2]) out.push(h('strong', { key: k }, inline(tok.slice(2, -2), k)));
    else if (m[3]) out.push(h('em', { key: k }, inline(tok.slice(1, -1), k)));
    else {
      const [, label, href] = tok.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      out.push(/^https?:\/\//i.test(href) ? h('a', { key: k, href, target: '_blank', rel: 'noopener noreferrer' }, inline(label, k)) : h('span', { key: k }, inline(label, k)));
    }
    rest = rest.slice(m.index + tok.length);
  }
  return out;
}

// An escaped pipe (\|) belongs to its cell rather than separating columns.
const cells = (line) => line.trim().replace(/^\||(?<!\\)\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));

function blocks(lines, key) {
  const out = [];
  let i = 0;
  const k = () => key + '.' + out.length;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = line.match(/^\s*(```|~~~)/);
    if (fence) {
      const body = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith(fence[1]); i++) body.push(lines[i]);
      i++;
      out.push(h('pre', { key: k() }, h('code', null, body.join('\n'))));
      continue;
    }
    const head = line.match(/^(#{1,6})\s+(.*)$/);
    if (head) { out.push(h('h' + Math.min(6, head[1].length + 2), { key: k() }, inline(head[2], k()))); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push(h('hr', { key: k() })); i++; continue; }
    if (/^\s*>/.test(line)) {
      const body = [];
      for (; i < lines.length && /^\s*>/.test(lines[i]); i++) body.push(lines[i].replace(/^\s*>\s?/, ''));
      out.push(h('blockquote', { key: k() }, blocks(body, k())));
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const header = cells(line), rows = [];
      for (i += 2; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++) rows.push(cells(lines[i]));
      out.push(h('div', { key: k(), className: 'tw' }, h('table', null,
        h('thead', null, h('tr', null, header.map((c, j) => h('th', { key: j }, inline(c, k() + j))))),
        h('tbody', null, rows.map((r, j) => h('tr', { key: j }, r.map((c, x) => h('td', { key: x }, inline(c, k() + j + x)))))))));
      continue;
    }
    const item = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (item) {
      const ordered = /\d/.test(item[2]), items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        if (m && m[1].length <= item[1].length) { items.push([m[3]]); i++; continue; }
        if (lines[i].trim() && /^\s+/.test(lines[i]) && items.length) { items[items.length - 1].push(lines[i].replace(/^\s{1,4}/, '')); i++; continue; }
        break;
      }
      out.push(h(ordered ? 'ol' : 'ul', { key: k(), start: ordered ? parseInt(item[2], 10) : undefined },
        items.map((body, j) => h('li', { key: j }, body.length > 1 ? blocks(body, k() + j) : inline(body[0], k() + j)))));
      continue;
    }
    const para = [];
    for (; i < lines.length && lines[i].trim() && !/^(#{1,6}\s|\s*>|\s*```|\s*~~~|\s*([-*+]|\d+[.)])\s)/.test(lines[i]); i++) para.push(lines[i].trim());
    if (!para.length) { para.push(line.trim()); i++; }
    out.push(h('p', { key: k() }, inline(para.join(' '), k())));
  }
  return out;
}

export function Markdown({ text, className }) {
  return h('div', { className: 'fm-md' + (className ? ' ' + className : '') }, blocks(String(text || '').replace(/\r\n?/g, '\n').split('\n'), 'm'));
}
