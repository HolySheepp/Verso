// 剪貼簿的讀寫：貼入整欄、把譯文欄複製回 Google Sheets

/**
 * 解析純文字表格（Tab 分隔）。Google Sheets 複製時，含換行、Tab 或引號開頭的格子會用引號包起來，
 * 格內的引號寫成兩個。回傳每一列的格子。
 */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let i = 0;
  let atCellStart = true;
  const t = text.replace(/\r\n?/g, '\n');
  while (i < t.length) {
    const ch = t[i];
    if (atCellStart && ch === '"') {
      // 引號格：讀到單獨的結尾引號為止
      let j = i + 1, val = '', closed = false;
      while (j < t.length) {
        if (t[j] === '"') {
          if (t[j + 1] === '"') { val += '"'; j += 2; continue; }
          closed = true; j++; break;
        }
        val += t[j++];
      }
      // 結尾引號後面必須是分隔符號或結尾，否則當成一般文字
      if (closed && (j >= t.length || t[j] === '\t' || t[j] === '\n')) {
        cell = val; i = j; atCellStart = false;
        continue;
      }
    }
    atCellStart = false;
    if (ch === '\t') { row.push(cell); cell = ''; atCellStart = true; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; atCellStart = true; }
    else cell += ch;
    i++;
  }
  // 最後一列（文字結尾的換行不算多一列）
  if (!(atCellStart && row.length === 0 && cell === '' && t.endsWith('\n'))) {
    row.push(cell);
    rows.push(row);
  }
  if (t === '') return [];
  return rows;
}

/** 從剪貼簿的 HTML 表格取出每一列的格子；沒有表格時回傳 null */
export function parseHtmlTable(html: string): string[][] | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const trs = doc.querySelectorAll('tr');
  if (!trs.length) return null;
  // 合併的格子（rowspan、colspan）展開成網格，被佔掉的位置補空字串，後面的格子才不會往左跑
  const grid: string[][] = [];
  Array.from(trs).forEach((tr, r) => {
    const row = (grid[r] ??= []);
    let c = 0;
    for (const cell of Array.from(tr.querySelectorAll('td,th'))) {
      while (row[c] !== undefined) c++;
      const el = cell.cloneNode(true) as HTMLElement;
      el.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
      const text = (el.textContent ?? '').replace(/ /g, ' ').replace(/\r\n?/g, '\n');
      const rs = Math.max(1, Number(cell.getAttribute('rowspan')) || 1), cs = Math.max(1, Number(cell.getAttribute('colspan')) || 1);
      for (let dr = 0; dr < rs; dr++) {
        const rr = (grid[r + dr] ??= []);
        for (let dc = 0; dc < cs; dc++) rr[c + dc] = dr === 0 && dc === 0 ? text : '';
      }
      c += cs;
    }
  });
  return grid.slice(0, trs.length).map((row) => Array.from(row, (v) => v ?? ''));
}

/** 貼入：優先用表格格式，回傳每一欄（一次貼多欄時會有多欄，缺的格子補空白） */
export function readColumns(data: { html?: string; text: string }): string[][] {
  const rows = (data.html && parseHtmlTable(data.html)) || parseTsv(data.text);
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  return Array.from({ length: width }, (_, k) => rows.map((r) => r[k] ?? ''));
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 帶格式的格子：html 是格子裡的內容（已處理好跳脫字元），text 是純文字版本 */
export interface RichCell { html: string; text: string }

/** 一欄文字轉成剪貼簿內容：表格格式和純文字各一份 */
export function columnToClipboard(values: (string | RichCell)[]): { html: string; text: string } {
  const cells = values.map((v) => (typeof v === 'string' ? escapeHtml(v).replace(/\n/g, '<br>') : v.html));
  // 有帶格式的格子時，照 Google Sheets 自己複製出來的樣子包起來，Google Sheets 才會保留格子裡的部分格式
  const rich = values.some((v) => typeof v !== 'string');
  const html = rich
    ? '<google-sheets-html-origin><style type="text/css"><!--td {border: 1px solid #cccccc;}br {mso-data-placement:same-cell;}--></style>' +
      '<table xmlns="http://www.w3.org/1999/xhtml" cellspacing="0" cellpadding="0" dir="ltr" border="1" style="table-layout:fixed;font-size:10pt;font-family:Arial;width:0px;border-collapse:collapse;border:none" data-sheets-root="1" data-sheets-baot="1"><tbody>' +
      cells.map((c) => `<tr style="height:21px;"><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;wrap-strategy:4;white-space:normal;word-wrap:break-word;">${c}</td></tr>`).join('') +
      '</tbody></table></google-sheets-html-origin>'
    // 純表格也要這行樣式：貼到 Excel 時格子裡的換行才不會被拆成好幾列
    : '<style type="text/css">br {mso-data-placement:same-cell;}</style><table><tbody>' + cells.map((c) => `<tr><td>${c}</td></tr>`).join('') + '</tbody></table>';
  const text = values
    .map((c) => (typeof c === 'string' ? c : c.text))
    .map((v) => (/[\n\t]/.test(v) || v.startsWith('"') ? '"' + v.replace(/"/g, '""') + '"' : v))
    .join('\n');
  return { html, text };
}

/** 把表格格式和純文字同時寫進剪貼簿 */
export async function writeColumn(values: (string | RichCell)[]): Promise<void> {
  const { html, text } = columnToClipboard(values);
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      }),
    ]);
  } else {
    await navigator.clipboard.writeText(text);
  }
}
