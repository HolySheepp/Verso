// fake google sheets
export interface Tab { gid: number; title: string; rows: string[][] }
export interface Book { title: string; tabs: Tab[] }
export const books: Map<string, Book> = ((globalThis as any).__books ??= new Map());
export const log: string[] = [];
let nextGid = 100;
export const mk = (sid: string, tabs: Record<string, string[][]>) => {
  books.set(sid, { title: 'Book ' + sid, tabs: Object.entries(tabs).map(([title, rows], i) => ({ gid: i + 1, title, rows: rows.map((r) => [...r]) })) });
};
const colIdx = (s: string) => { let n = 0; for (const c of s) n = n * 26 + c.charCodeAt(0) - 64; return n - 1; };
const unq = (s: string) => s.replace(/^'|'$/g, '').replace(/''/g, "'");
const tabOf = (b: Book, t: string) => { const x = b.tabs.find((y) => y.title === t); if (!x) throw new Error('400: Unable to parse range: ' + t); return x; };
const set = (t: Tab, r: number, c: number, v: string) => { while (t.rows.length <= r) t.rows.push([]); const row = t.rows[r]; while (row.length <= c) row.push(''); row[c] = v; };
export const errors: { n: number } = { n: 0 };
export function invoke(cmd: string, a: { method: string; path: string; body: any }): any {
  if (cmd !== 'cloud_api') throw new Error('cmd ' + cmd);
  const [sid, rest0 = ''] = a.path.split(/[:/?]/, 1).concat([]) as string[];
  const sidx = a.path.search(/[:/?]/);
  const sid2 = sidx < 0 ? a.path : a.path.slice(0, sidx);
  const rest = sidx < 0 ? '' : a.path.slice(sidx);
  void sid; void rest0;
  const b = books.get(sid2);
  if (!b) throw new Error('404: not found');
  if ((globalThis as any).__fail && a.method === 'POST') throw new Error('error sending request');
  log.push(a.method + ' ' + rest.slice(0, 60));
  if (a.method === 'GET' && rest.startsWith('?fields=properties.title')) return { properties: { title: b.title }, sheets: b.tabs.map((t, i) => ({ properties: { sheetId: t.gid, title: t.title, index: i } })) };
  if (a.method === 'GET' && rest.startsWith('/values:batchGet')) {
    const q = new URLSearchParams(rest.split('?')[1]);
    const cols = q.get('majorDimension') === 'COLUMNS';
    return { valueRanges: q.getAll('ranges').map((rg) => {
      const [t, c] = rg.split('!'); const tab = tabOf(b, unq(t));
      const trim = (r: string[]) => { const x = [...r]; while (x.length && x[x.length - 1] === '') x.pop(); return x; };
      if (!cols) { const rows = tab.rows.map(trim); while (rows.length && !rows[rows.length - 1].length) rows.pop(); return { values: rows }; }
      const ci = colIdx(c.split(':')[0]); const col = tab.rows.map((r) => r[ci] ?? ''); while (col.length && col[col.length - 1] === '') col.pop(); return { values: [col] };
    }) };
  }
  if (a.method === 'POST' && rest === '/values:batchUpdate') {
    for (const d of a.body.data) { const m = d.range.match(/^(.*)!([A-Z]+)(\d+)$/)!; const tab = tabOf(b, unq(m[1])); d.values[0].forEach((v: string, i: number) => set(tab, Number(m[3]) - 1, colIdx(m[2]) + i, v)); }
    return {};
  }
  if (a.method === 'POST' && rest.startsWith('/values/')) {
    const m = decodeURIComponent(rest.slice(8).split(':append')[0]).match(/^(.*)!A1$/)!; const tab = tabOf(b, unq(m[1]));
    const start = tab.rows.length; a.body.values.forEach((v: string[]) => tab.rows.push([...v]));
    return { updates: { updatedRange: `'${tab.title}'!A${start + 1}` } };
  }
  if (a.method === 'POST' && rest === ':batchUpdate') {
    const replies: any[] = [];
    for (const r of a.body.requests) {
      if (r.updateCells) { const u = r.updateCells; const tab = b.tabs.find((t) => t.gid === u.start.sheetId)!; set(tab, u.start.rowIndex, u.start.columnIndex, u.rows[0].values[0].userEnteredValue.stringValue); replies.push({}); }
      else if (r.insertDimension) { const g = r.insertDimension.range; const tab = b.tabs.find((t) => t.gid === g.sheetId)!; for (let i = 0; i < g.endIndex - g.startIndex; i++) tab.rows.splice(g.startIndex, 0, []); replies.push({}); }
      else if (r.deleteDimension) { const g = r.deleteDimension.range; const tab = b.tabs.find((t) => t.gid === g.sheetId)!; tab.rows.splice(g.startIndex, g.endIndex - g.startIndex); replies.push({}); }
      else if (r.moveDimension) { const m = r.moveDimension; const tab = b.tabs.find((t) => t.gid === m.source.sheetId)!; const [row] = tab.rows.splice(m.source.startIndex, 1); const dest = m.destinationIndex > m.source.startIndex ? m.destinationIndex - 1 : m.destinationIndex; tab.rows.splice(dest, 0, row); replies.push({}); }
      else if (r.addSheet) { const gid = nextGid++; b.tabs.push({ gid, title: r.addSheet.properties.title, rows: [] }); replies.push({ addSheet: { properties: { sheetId: gid } } }); }
      else throw new Error('unsupported ' + JSON.stringify(r).slice(0, 80));
    }
    return { replies };
  }
  throw new Error('unsupported call ' + a.method + ' ' + rest);
}
