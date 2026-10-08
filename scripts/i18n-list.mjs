// 產生介面字句清單 i18n/字句清單.tsv（代號、中文、畫面區域、出現在程式哪裡），給翻譯用。
// 用法：node scripts/i18n-list.mjs
import fs from 'fs';
import path from 'path';

const zhSrc = fs.readFileSync('src/i18n/zh.ts', 'utf8');
const rows = [];
for (const line of zhSrc.split('\n')) {
  const m = line.match(/^\s*'([^']+)': '((?:[^'\\]|\\.)*)',\s*(?:\/\/\s*(.*))?$/);
  if (m) rows.push({ key: m[1], zh: m[2].replace(/\\'/g, "'").replace(/\\\\/g, '\\'), area: m[3] ?? '' });
}

// 每個代號用在哪些檔案的哪一行
const uses = new Map();
const known = new Set(rows.map((r) => r.key));
function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) { if (f !== 'i18n') walk(p); continue; }
    if (!/\.(ts|tsx)$/.test(f) || /\.test\./.test(f)) continue;
    fs.readFileSync(p, 'utf8').split('\n').forEach((l, i) => {
      // 代號可能寫在 tx( 裡，也可能先選好再傳進去（例如 a ? '代號1' : '代號2'）
      for (const m of l.matchAll(/'([A-Za-z]+\.[A-Za-z0-9]+)'/g)) {
        if (!known.has(m[1])) continue;
        const list = uses.get(m[1]) ?? [];
        list.push(`${p.replace(/\\/g, '/').replace(/^src\//, '')}:${i + 1}`);
        uses.set(m[1], list);
      }
    });
  }
}
walk('src');

const esc = (s) => s.replace(/\t/g, ' ');
const out = ['代號\t中文\t畫面區域\t程式位置'];
for (const r of rows) out.push([r.key, esc(r.zh), esc(r.area), (uses.get(r.key) ?? []).join(' ')].join('\t'));
fs.mkdirSync('i18n', { recursive: true });
fs.writeFileSync('i18n/字句清單.tsv', '﻿' + out.join('\r\n') + '\r\n');
const unused = rows.filter((r) => !uses.has(r.key)).map((r) => r.key);
console.log(`${rows.length} 句${unused.length ? `，沒用到的代號：${unused.join(' ')}` : ''}`);
