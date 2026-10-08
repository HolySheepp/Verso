// 檔案與 xlsx 的互相轉換：一個檔案一個 xlsx，一個頁簽一個工作表
import * as XLSX from 'xlsx';
import { newUid } from '../model/paste';
import { stdToText, textToStd } from '../model/length';
import { SETTINGS_SHEET } from '../model/names';
import { textToVerify, verifyToText, editsOf } from '../model/verify';
import { isVersoHeader } from '../model/importSel';
import type { CustomMark, Entry, FileDoc, GlossaryTerm, SrcUpdate, StoredMark } from '../model/types';

/** 給人看的欄位在前，程式要用的資料放在最右邊（不隱藏） */
export const ENTRY_HEADERS = ['#', '發話者', '原文', '譯文', '標記', '備註', '建議翻譯', '匯入時的原文', '匯入時的譯文', '待確認', '略過檢查', '標記編號', '長度標準', '驗證修改', '原文更新', '略過建議檢查'];
export { SETTINGS_SHEET };
export const DICT_HEADERS = ['原文', '譯文', '備註'];

const STORED_BUILTIN = new Set(['verified', 'doubt', 'think', 'ignore']);

/** 寫進「標記」欄的名稱：存檔一律用中文，不隨介面語言改變 */
const MARK_NAMES_ZH: Record<string, string> = { untranslated: '未翻譯', translated: '已翻譯', verified: '已驗證', doubt: '疑慮', think: '待思考', ignore: '忽略' };

function markLabel(mark: string, customs: CustomMark[]) {
  if (!mark) return '';
  if (mark.startsWith('c:')) return customs.find((c) => 'c:' + c.id === mark)?.name ?? '';
  return MARK_NAMES_ZH[mark] ?? '';
}

/**
 * 一個格子的文字：數字用原本的值（不要被欄寬或格式變成「1.23E+5」「1,234」），
 * 日期之類有日期格式的才用顯示的文字。換行統一成 \n。
 */
export function cellText(cell: XLSX.CellObject | undefined): string {
  if (!cell || cell.v == null) return '';
  const isDate = cell.t === 'd' || (cell.t === 'n' && typeof cell.z === 'string' && XLSX.SSF.is_date(cell.z));
  const raw = cell.t === 'n' && !isDate ? String(cell.v) : String(cell.w ?? cell.v);
  return raw.replace(/\r\n?/g, '\n');
}

/** 工作表的每一列（從 A1 開始，空白列也保留，列號才會和原檔一樣） */
export function sheetRows(ws: XLSX.WorkSheet): string[][] {
  if (!ws || !ws['!ref']) return [];
  const range = XLSX.utils.decode_range(ws['!ref']);
  const out: string[][] = [];
  for (let r = 0; r <= range.e.r; r++) {
    const row: string[] = [];
    for (let c = 0; c <= range.e.c; c++) row.push(cellText(ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined));
    out.push(row);
  }
  return out;
}

/** 所有格子都存成文字，避免 id 開頭的 0 被 Excel 吃掉 */
function textSheet(rows: string[][]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  Object.keys(ws).forEach((k) => {
    if (k[0] === '!') return;
    const c = ws[k] as XLSX.CellObject;
    // 空白格不寫進檔案（讀回來時缺的格子就是空白），檔案小、存得快
    if (c.v == null || c.v === '') { delete ws[k]; return; }
    c.t = 's';
    // 文字裡本來就有「_x0041_」這種寫法時，Excel 會把它當成跳脫字元換掉：先跳脫成 _x005F_，讀回來才是原字
    // （要配合共用字串表 bookSST 寫入，這種寫法 Excel 和讀檔都只解一次）
    c.v = String(c.v).replace(/_x([0-9A-Fa-f]{4})_/g, '_x005F_x$1_');
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
        e.src0, e.tgt0, e.pending ? '1' : '', e.skipCheck ? '1' : '', mark, stdToText(e.lengthStd),
        // 存之前先對好位置：存的是對應目前譯文的修改
        e.ver ? verifyToText({ ...e.ver, base: e.tgt, edits: editsOf(e) }) : '',
        e.upd ? JSON.stringify(e.upd) : '',
        e.skipSugg ? '1' : '',
      ];
    })];
    const ws = textSheet(rows);
    // 驗證修改只給程式用：這一欄隱藏
    ws['!cols'] = ENTRY_HEADERS.map((h) => (h === '驗證修改' || h === '原文更新' || h === '略過建議檢查' ? { hidden: true } : {}));
    XLSX.utils.book_append_sheet(wb, ws, sheetName(sh.name, used));
  });
  if (!file.sheets.length) XLSX.utils.book_append_sheet(wb, textSheet([ENTRY_HEADERS]), '頁簽 1');
  // 檔案層級的設定：檔案 ID、長度標準
  const settings = [['項目', '值']];
  if (file.fid) settings.push(['檔案ID', file.fid]);
  if (file.lengthStd) settings.push(['長度標準', stdToText(file.lengthStd)]);
  if (settings.length > 1) appendSettings(wb, settings);
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: true, bookSST: true }) as ArrayBuffer);
}

/** 加上隱藏的設定工作表 */
function appendSettings(wb: XLSX.WorkBook, rows: string[][]) {
  XLSX.utils.book_append_sheet(wb, textSheet(rows), SETTINGS_SHEET);
  wb.Workbook = { Sheets: wb.SheetNames.map((n) => ({ name: n, Hidden: n === SETTINGS_SHEET ? 1 : 0 })) } as XLSX.WorkBook['Workbook'];
}

/** 讀設定工作表裡某一項的值 */
function readSetting(wb: XLSX.WorkBook, key: string): string {
  const ws = wb.Sheets[SETTINGS_SHEET];
  if (!ws) return '';
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: '' });
  const row = rows.find((r) => str(r[0]) === key);
  return row ? str(row[1]).trim() : '';
}

/** 原文更新記錄 */
function readUpd(text: string): SrcUpdate | undefined {
  if (!text) return undefined;
  try {
    const o = JSON.parse(text) as SrcUpdate;
    const hidden = o.hidden ? { hidden: true } : {};
    if (typeof o.src === 'string') return { src: o.src, ...hidden };
    if (o.removed) return { removed: true, ...hidden };
    if (o.applied) return { applied: true };
  } catch { /* 看不懂就當沒有 */ }
  return undefined;
}

/** 格子的文字；Windows 的換行（\r\n）統一成 \n */
const str = (v: unknown) => (v == null ? '' : String(v).replace(/\r\n?/g, '\n'));
const truthy = (v: string) => v !== '' && v !== '0' && v.toLowerCase() !== 'false';

/** 依標題找欄位；找不到標題時照預設順序 */
function columnIndex(header: string[], names: string[]) {
  const hasHeader = names.some((n) => header.includes(n));
  return (name: string) => (hasHeader ? header.indexOf(name) : names.indexOf(name));
}

/**
 * 是不是 Verso 的檔案：有檔案 ID（隱藏的設定表），或第一個工作表是 Verso 的欄位標題。
 * 存檔資料夾裡別的 xlsx 一律不讀、不寫、不移動。
 */
function isVersoBook(wb: XLSX.WorkBook): boolean {
  if (readSetting(wb, '檔案ID')) return true;
  const first = wb.SheetNames.find((n) => n !== SETTINGS_SHEET);
  if (!first) return false;
  return isVersoHeader(headerRow(wb.Sheets[first]));
}

/** 工作表第一列（只讀標題，不轉整張表） */
function headerRow(ws: XLSX.WorkSheet): string[] {
  const out: string[] = [];
  for (let c = 0; c < 40; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: 0, c })] as XLSX.CellObject | undefined;
    out.push(cell ? str(cell.w ?? cell.v) : '');
  }
  while (out.length && !out[out.length - 1]) out.pop();
  return out;
}

export function isVersoFileData(data: Uint8Array): boolean {
  try { return isVersoBook(XLSX.read(data, { type: 'array', sheetRows: 2 })); } catch { return false; }
}

let termSeq = 0;
/** 詞條 ID：隨機、不重複（不用「字典名稱＋列號」，改名或增刪列之後才不會撞到） */
const newTermId = () => 't' + Date.now().toString(36) + (termSeq++).toString(36) + Math.random().toString(36).slice(2, 6);

/** 是不是 Verso 的字典：有字典 ID，或標題是「原文、譯文、備註」 */
export function isVersoDictData(data: Uint8Array): boolean {
  try {
    const wb = XLSX.read(data, { type: 'array', sheetRows: 2 });
    if (readSetting(wb, '字典ID')) return true;
    const first = wb.SheetNames.find((n) => n !== SETTINGS_SHEET);
    if (!first) return false;
    const h = headerRow(wb.Sheets[first]);
    return h[0] === '原文' && h[1] === '譯文';
  } catch { return false; }
}

/** 讀 Verso 的檔案；不是 Verso 的檔案回傳 null */
export function xlsxToVersoFile(name: string, project: string, data: Uint8Array, customs: CustomMark[]): FileDoc | null {
  const wb = XLSX.read(data, { type: 'array' });
  return isVersoBook(wb) ? bookToFile(wb, name, project, customs) : null;
}

export function xlsxToFile(name: string, project: string, data: Uint8Array, customs: CustomMark[]): FileDoc {
  return bookToFile(XLSX.read(data, { type: 'array' }), name, project, customs);
}

function bookToFile(wb: XLSX.WorkBook, name: string, project: string, customs: CustomMark[]): FileDoc {
  const known = new Set(customs.map((c) => 'c:' + c.id));
  // 檔案設定工作表：不當成頁簽
  const lengthStd = textToStd(readSetting(wb, '長度標準'));
  const fid = readSetting(wb, '檔案ID');
  return {
    ...(fid ? { fid } : {}),
    name,
    project,
    lengthStd,
    sheets: wb.SheetNames.filter((sn) => sn !== SETTINGS_SHEET).map((sn) => {
      const rows = sheetRows(wb.Sheets[sn]);
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
          ...(textToStd(get(r, '長度標準')) ? { lengthStd: textToStd(get(r, '長度標準')) } : {}),
          ...(textToVerify(get(r, '驗證修改')) ? { ver: textToVerify(get(r, '驗證修改')) } : {}),
          ...(readUpd(get(r, '原文更新')) ? { upd: readUpd(get(r, '原文更新')) } : {}),
          ...(truthy(get(r, '略過建議檢查')) ? { skipSugg: true } : {}),
        };
      });
      return { name: sn, entries };
    }),
  };
}

export function dictToXlsx(terms: GlossaryTerm[], did?: string): Uint8Array {
  const wb = XLSX.utils.book_new();
  const rows = [DICT_HEADERS, ...terms.map((t) => [t.term, t.en, t.note])];
  XLSX.utils.book_append_sheet(wb, textSheet(rows), '字典');
  if (did) appendSettings(wb, [['項目', '值'], ['字典ID', did]]);
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: true, bookSST: true }) as ArrayBuffer);
}

/** 詞條的專案由字典所在的專案資料夾決定（舊檔案裡的「所屬專案」欄不再使用） */
export function xlsxToDict(project: string, dict: string, data: Uint8Array): GlossaryTerm[] {
  return readDictBook(project, dict, data).terms;
}

/** 讀字典：詞條與字典 ID */
export function readDictBook(project: string, dict: string, data: Uint8Array): { terms: GlossaryTerm[]; did: string } {
  const wb = XLSX.read(data, { type: 'array' });
  return { terms: dictTerms(wb, project, dict), did: readSetting(wb, '字典ID') };
}

function dictTerms(wb: XLSX.WorkBook, project: string, dict: string): GlossaryTerm[] {
  const ws = wb.Sheets[wb.SheetNames.filter((n) => n !== SETTINGS_SHEET)[0]];
  if (!ws) return [];
  const rows = sheetRows(ws);
  const header = (rows[0] ?? []).map(str);
  const col = columnIndex(header, DICT_HEADERS);
  const body = DICT_HEADERS.some((n) => header.includes(n)) ? rows.slice(1) : rows;
  const get = (r: unknown[], n: string) => { const i = col(n); return i >= 0 ? str(r[i]) : ''; };
  return body
    .map((r): GlossaryTerm => ({ id: newTermId(), term: get(r, '原文'), en: get(r, '譯文'), note: get(r, '備註'), proj: project, dict }))
    .filter((t) => t.term || t.en);
}
