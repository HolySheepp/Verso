// 檔案與 xlsx 的互相轉換：一個檔案一個 xlsx，一個頁簽一個工作表
import * as XLSX from 'xlsx';
import { BUILTIN_MARKS } from '../model/marks';
import { newUid } from '../model/paste';
import type { CustomMark, Entry, FileDoc, GlossaryTerm, StoredMark } from '../model/types';

/** 給人看的欄位在前，程式要用的資料放在最右邊（不隱藏） */
export const ENTRY_HEADERS = ['#', '發話者', '原文', '譯文', '標記', '備註', '建議翻譯', '匯入時的原文', '匯入時的譯文', '待確認', '略過檢查', '標記編號'];
export const DICT_HEADERS = ['原文', '譯文', '備註'];

const STORED_BUILTIN = new Set(['verified', 'doubt', 'think', 'ignore']);

function markLabel(mark: string, customs: CustomMark[]) {
  if (!mark) return '';
  if (mark.startsWith('c:')) return customs.find((c) => 'c:' + c.id === mark)?.name ?? '';
  return BUILTIN_MARKS.find((b) => b.id === mark)?.label ?? '';
}

/** 所有格子都存成文字，避免 id 開頭的 0 被 Excel 吃掉 */
function textSheet(rows: string[][]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  Object.keys(ws).forEach((k) => {
    if (k[0] === '!') return;
    const c = ws[k] as XLSX.CellObject;
    c.t = 's';
    c.v = String(c.v ?? '');
  });
  return ws;
}

/** Excel 工作表名稱不能有這些字元，也不能超過 31 字 */
const sheetName = (name: string, used: Set<string>) => {
  let n = name.replace(/[\\/?*[\]:]/g, '_').slice(0, 31) || '頁簽';
  let k = 2;
  while (used.has(n)) n = (name.slice(0, 27) || '頁簽') + ` (${k++})`;
  used.add(n);
  return n;
};

export function fileToXlsx(file: FileDoc, customs: CustomMark[]): Uint8Array {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  file.sheets.forEach((sh) => {
    const rows = [ENTRY_HEADERS, ...sh.entries.map((e) => {
      const mark = e.mark || e.keptMark || '';
      return [
        e.id, e.speaker, e.src, e.tgt, markLabel(e.mark, customs), e.note, e.sugg,
        e.src0, e.tgt0, e.pending ? '1' : '', e.skipCheck ? '1' : '', mark,
      ];
    })];
    XLSX.utils.book_append_sheet(wb, textSheet(rows), sheetName(sh.name, used));
  });
  if (!file.sheets.length) XLSX.utils.book_append_sheet(wb, textSheet([ENTRY_HEADERS]), '頁簽 1');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

const str = (v: unknown) => (v == null ? '' : String(v));
const truthy = (v: string) => v !== '' && v !== '0' && v.toLowerCase() !== 'false';

/** 依標題找欄位；找不到標題時照預設順序 */
function columnIndex(header: string[], names: string[]) {
  const hasHeader = names.some((n) => header.includes(n));
  return (name: string) => (hasHeader ? header.indexOf(name) : names.indexOf(name));
}

export function xlsxToFile(name: string, project: string, data: Uint8Array, customs: CustomMark[]): FileDoc {
  const wb = XLSX.read(data, { type: 'array' });
  const known = new Set(customs.map((c) => 'c:' + c.id));
  return {
    name,
    project,
    sheets: wb.SheetNames.map((sn) => {
      const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sn], { header: 1, raw: false, defval: '' });
      const header = (rows[0] ?? []).map(str);
      const col = columnIndex(header, ENTRY_HEADERS);
      const hasHeader = ENTRY_HEADERS.some((n) => header.includes(n));
      const body = hasHeader ? rows.slice(1) : rows;
      const get = (r: unknown[], n: string) => { const i = col(n); return i >= 0 ? str(r[i]) : ''; };
      const entries = body.map((r): Entry => {
        const src = get(r, '原文'), tgt = get(r, '譯文');
        const raw = get(r, '標記編號');
        let mark: StoredMark = '';
        let keptMark: string | undefined;
        if (STORED_BUILTIN.has(raw)) mark = raw as StoredMark;
        else if (raw.startsWith('c:')) { if (known.has(raw)) mark = raw as StoredMark; else keptMark = raw; }
        const src0 = col('匯入時的原文') >= 0 ? get(r, '匯入時的原文') : src;
        const tgt0 = col('匯入時的譯文') >= 0 ? get(r, '匯入時的譯文') : tgt;
        return {
          uid: newUid(), id: get(r, '#'), speaker: get(r, '發話者') || '無',
          src, src0, tgt, tgt0, mark, keptMark,
          pending: truthy(get(r, '待確認')), skipCheck: truthy(get(r, '略過檢查')),
          note: get(r, '備註'), sugg: get(r, '建議翻譯'),
        };
      });
      return { name: sn, entries };
    }),
  };
}

export function dictToXlsx(terms: GlossaryTerm[]): Uint8Array {
  const wb = XLSX.utils.book_new();
  const rows = [DICT_HEADERS, ...terms.map((t) => [t.term, t.en, t.note])];
  XLSX.utils.book_append_sheet(wb, textSheet(rows), '字典');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

/** 詞條的專案由字典所在的專案資料夾決定（舊檔案裡的「所屬專案」欄不再使用） */
export function xlsxToDict(project: string, dict: string, data: Uint8Array): GlossaryTerm[] {
  const wb = XLSX.read(data, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: '' });
  const header = (rows[0] ?? []).map(str);
  const col = columnIndex(header, DICT_HEADERS);
  const body = DICT_HEADERS.some((n) => header.includes(n)) ? rows.slice(1) : rows;
  const get = (r: unknown[], n: string) => { const i = col(n); return i >= 0 ? str(r[i]) : ''; };
  return body
    .map((r, i): GlossaryTerm => ({ id: 'd:' + project + '/' + dict + ':' + i, term: get(r, '原文'), en: get(r, '譯文'), note: get(r, '備註'), proj: project, dict }))
    .filter((t) => t.term || t.en);
}
