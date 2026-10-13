// AI 協助（小測試版）：Verso 開一個本機 MCP 服務，按鈕在背景執行 Claude Code，
// Claude 透過服務的工具讀寫條目。工具在這裡處理（條目資料在畫面這邊）。
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { tx } from '../i18n';
import { parseKey } from '../model/cells';
import { appendNote } from '../model/paste';
import { currentOf, showToast, useStore } from './store';

/** 給 Claude 看的工具 */
const TOOLS = [
  {
    name: 'get_selected_entries',
    description: 'Get the entries the user selected in Verso: index, id, speaker, source text (src), translation (tgt) and note.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'write_note',
    description: 'Append a line to the note of one selected entry. Verso adds the prefix "AI：" itself.',
    inputSchema: { type: 'object', properties: { index: { type: 'integer', description: 'Entry index from get_selected_entries' }, text: { type: 'string' } }, required: ['index', 'text'], additionalProperties: false },
  },
];

/** 這次 AI 在處理的檔案、頁簽和條目（按下按鈕時記下，中途換頁簽也寫回原本那頁） */
let job: { fid: string; sheet: number; indices: number[] } | null = null;

const fileIndex = () => useStore.getState().project?.files.findIndex((f) => f.fid === job?.fid) ?? -1;

function callTool(name: string, args: Record<string, unknown>): unknown {
  if (!job) throw new Error('No AI job is running.');
  const s = useStore.getState();
  const fi = fileIndex();
  const sheet = s.project?.files[fi]?.sheets[job.sheet];
  if (!sheet) throw new Error('The file or sheet is no longer open in Verso.');
  if (name === 'get_selected_entries') {
    return job.indices.map((i) => { const e = sheet.entries[i]; return e && { index: i, id: e.id, speaker: e.speaker, src: e.src, tgt: e.tgt, note: e.note }; }).filter(Boolean);
  }
  if (name === 'write_note') {
    const i = Number(args.index), text = String(args.text ?? '').trim();
    if (!job.indices.includes(i)) throw new Error('This entry is not selected.');
    if (!text) throw new Error('Empty text.');
    s.editSheet((es) => ({ entries: es.map((e, k) => (k === i ? { ...e, note: appendNote(e.note, 'AI：' + text) } : e)) }), { file: fi, sheet: job.sheet });
    return 'ok';
  }
  throw new Error('Unknown tool: ' + name);
}

let started = false;
/** 開 AI 協助：開本機服務、接上工具呼叫（只做一次） */
export async function startAi() {
  if (started || !isTauri()) return;
  started = true;
  await invoke('ai_server_start', { tools: TOOLS });
  await listen<{ id: number; name: string; arguments: Record<string, unknown> }>('ai-call', (ev) => {
    const { id, name, arguments: args } = ev.payload;
    let result: unknown, isError = false;
    try { result = callTool(name, args ?? {}); } catch (e) { result = String((e as Error)?.message ?? e); isError = true; }
    void invoke('ai_reply', { id, result, isError });
  });
  await listen<{ ok: boolean; output: string; error: string }>('ai-done', (ev) => {
    job = null;
    useStore.setState({ aiBusy: false });
    if (ev.payload.ok) showToast(tx('ai.done'));
    else showToast(tx('ai.failed', { msg: (ev.payload.error || ev.payload.output || '').trim().slice(-200) }), { warn: true });
  });
}

/** 按下 AI 按鈕：處理中就停止，否則把選取的條目交給 Claude */
export async function runAi() {
  const s = useStore.getState();
  if (s.aiBusy) { void invoke('ai_stop'); return; }
  if (!isTauri()) { showToast(tx('ai.desktopOnly'), { warn: true }); return; }
  await startAi();
  const { fileDoc, sheetIdx, sel } = currentOf(s);
  const rows = [...new Set((s.cellSel?.keys ?? []).map((k) => parseKey(k).i))].sort((a, b) => a - b);
  job = { fid: fileDoc.fid ?? '', sheet: sheetIdx, indices: rows.length ? rows : [sel] };
  // 小測試：讀選取的條目，每條的備註寫一句「測試」
  const prompt = 'Use the verso MCP tools only. Call get_selected_entries, then call write_note once for every returned entry with text "測試". Do not do anything else.';
  try {
    useStore.setState({ aiBusy: true });
    await invoke('ai_run', { prompt });
  } catch (e) {
    job = null;
    useStore.setState({ aiBusy: false });
    const msg = String(e);
    showToast(msg === 'not-installed' ? tx('ai.notInstalled') : tx('ai.failed', { msg }), { warn: true });
  }
}
