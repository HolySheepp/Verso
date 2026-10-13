// AI 協助：Verso 開一個本機 MCP 服務，按鈕在背景執行 Claude Code，Claude 透過服務的工具讀寫條目。
// 工具在這裡處理（條目資料在畫面這邊）。Claude 只能讀條目、讀字典、寫譯文、寫修改、寫建議翻譯、寫備註；
// 不能存檔、改原文、刪條目。
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { tx } from '../i18n';
import { TGT_COL, parseKey } from '../model/cells';
import { appendNote } from '../model/paste';
import { ratio } from '../model/srcUpdate';
import { applyChange, compose, editsOf } from '../model/verify';
import { dictKey, type Entry } from '../model/types';
import { findHits } from './dictHits';
import { currentOf, currentProjectOf, dictEnabledIn, shownSrc, showToast, useStore } from './store';

/** 整句換掉的程度：新舊譯文相似度低於這個，就放進「建議翻譯」，不放修改框 */
const BIG_CHANGE = 0.5;
/** 前後各附幾條當上下文 */
const CONTEXT = 5;
/** 超過這麼多條先問要不要繼續 */
export const AI_ASK_OVER = 50;

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const idx = { type: 'integer', description: 'The entry index from get_task' };

/** 給 Claude 看的工具 */
const TOOLS = [
  {
    name: 'get_task',
    description: 'Get the task: the mode ("translate" or "verify") and the selected entries. Each entry has index, id, speaker, source text (src), current translation (tgt), suggestion, note, '
      + 'the 5 entries before and after it (context), and the glossary terms found in its source text (glossary: term and its required translations).',
    inputSchema: obj({}),
  },
  {
    name: 'write_translation',
    description: 'Translate mode: give the full translation of one entry. Verso fills it in (or puts it in the edit box when the entry already has a translation) and marks it "AI 翻譯".',
    inputSchema: obj({ index: idx, text: { type: 'string', description: 'The full translated text' } }, ['index', 'text']),
  },
  {
    name: 'write_revision',
    description: 'Verify mode: give the full corrected translation of one entry. Only call this when the current translation needs changes. '
      + 'Verso shows small changes as underlined edits and large rewrites as a suggestion.',
    inputSchema: obj({ index: idx, text: { type: 'string', description: 'The full corrected translation' } }, ['index', 'text']),
  },
  {
    name: 'write_note',
    description: 'Add a short note to one entry (for example why you changed it, or something the translator should check). Write it in Traditional Chinese. Verso adds the prefix "AI：".',
    inputSchema: obj({ index: idx, text: { type: 'string' } }, ['index', 'text']),
  },
];

interface Job { fid: string; sheet: number; mode: 'translate' | 'verify'; indices: number[]; uids: string[]; before: Record<string, Entry> }
/** 這次 AI 在處理的檔案、頁簽和條目（按下按鈕時記下，中途換頁簽也寫回原本那頁） */
let job: Job | null = null;

function sheetOf(j: Job) {
  const p = useStore.getState().project;
  const f = p?.files.find((x) => x.fid === j.fid);
  return f?.sheets[j.sheet];
}

/** 啟用中的字典詞條（跟字典頁一樣的規則） */
function activeTerms() {
  const s = useStore.getState();
  const p = s.project!;
  const current = currentProjectOf(s);
  const on = new Set(p.dicts.filter((d) => dictEnabledIn(current, s.dictOverrides, d)).map((d) => dictKey(d.project, d.name)));
  return { terms: p.glossary.filter((g) => g.term && on.has(dictKey(g.proj, g.dict))), current };
}

/** 一條的上下文（只給 AI 參考） */
const brief = (e: Entry) => ({ id: e.id, speaker: e.speaker, src: shownSrc(e), tgt: e.tgt });

function getTask(j: Job) {
  const sheet = sheetOf(j)!;
  const { terms, current } = activeTerms();
  return {
    mode: j.mode,
    entries: j.indices.map((i) => {
      const e = sheet.entries[i];
      if (!e) return null;
      const hits = findHits(shownSrc(e), terms, current);
      return {
        index: i, id: e.id, speaker: e.speaker, src: shownSrc(e), tgt: e.tgt, suggestion: e.sugg, note: e.note,
        context_before: sheet.entries.slice(Math.max(0, i - CONTEXT), i).map(brief),
        context_after: sheet.entries.slice(i + 1, i + 1 + CONTEXT).map(brief),
        glossary: hits.map((h) => ({ term: h.term.term, translations: [...new Set(h.terms.map((t) => t.en))] })),
      };
    }).filter(Boolean),
  };
}

/** 譯文放進修改框（驗證模式的修改：底線，可以套用或忽略） */
function withEdits(e: Entry, text: string): Entry {
  const edits = editsOf(e);
  const r = applyChange(e.tgt, edits, compose(e.tgt, edits), text);
  if (!r.edits.length) return e;
  const next: Entry = { ...e, ver: { base: e.tgt, edits: r.edits, ...(e.ver?.prev !== undefined ? { prev: e.ver.prev } : {}) } };
  return next;
}

function callTool(name: string, args: Record<string, unknown>): unknown {
  const j = job;
  if (!j) throw new Error('No AI job is running.');
  const sheet = sheetOf(j);
  if (!sheet) throw new Error('The file or sheet is no longer open in Verso.');
  if (name === 'get_task') return getTask(j);
  const i = Number(args.index);
  const e = sheet.entries[i];
  if (!e || !j.uids.includes(e.uid)) throw new Error('This entry is not part of the task.');
  const text = String(args.text ?? '').replace(/\r\n?/g, '\n');
  const { aiPatch } = useStore.getState();
  if (name === 'write_note') {
    if (!text.trim()) throw new Error('Empty note.');
    aiPatch(j.fid, j.sheet, e.uid, (x) => ({ ...x, note: appendNote(x.note, 'AI：' + text.trim()) }));
    return 'ok';
  }
  if (!text.trim()) throw new Error('Empty text.');
  if (name === 'write_translation') {
    if (j.mode !== 'translate') throw new Error('This task is verify mode; use write_revision.');
    // 空的直接填進譯文，已經有譯文的放進修改框；都標「AI 翻譯」
    aiPatch(j.fid, j.sheet, e.uid, (x) => (!x.tgt.trim()
      ? { ...x, tgt: text, pending: false, mark: 'ai' }
      : { ...withEdits(x, text), mark: 'ai' }));
    return 'ok';
  }
  if (name === 'write_revision') {
    if (j.mode !== 'verify') throw new Error('This task is translate mode; use write_translation.');
    if (text === e.tgt) return 'unchanged';
    // 整句換掉或改很多：放進建議翻譯；小幅修改：放進修改框（跟驗證模式一樣自動標疑慮）
    if (ratio(e.tgt, text) < BIG_CHANGE) {
      aiPatch(j.fid, j.sheet, e.uid, (x) => ({ ...x, sugg: text }));
      return 'saved as suggestion';
    }
    aiPatch(j.fid, j.sheet, e.uid, (x) => {
      const had = editsOf(x).length > 0;
      const y = withEdits(x, text);
      if (y === x || had || x.mark === 'doubt') return y;
      return { ...y, mark: 'doubt', ver: { ...y.ver!, prev: x.mark } };
    });
    return 'saved as edits';
  }
  throw new Error('Unknown tool: ' + name);
}

/** 做完或停止：解除鎖定，這次改過的條目合成一步復原 */
function finish() {
  const j = job;
  job = null;
  if (j) useStore.getState().aiFinish(j.fid, j.sheet, j.before);
  useStore.setState({ aiBusy: false, aiLocked: [] });
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
    const stopped = stopping;
    stopping = false;
    finish();
    if (stopped) showToast(tx('ai.stopped'));
    else if (ev.payload.ok) showToast(tx('ai.done'));
    else showToast(tx('ai.failed', { msg: (ev.payload.error || ev.payload.output || '').trim().slice(-200) }), { warn: true });
  });
}

let stopping = false;

/** 這次要處理的條目，以及是翻譯還是驗證：選到譯文欄就是驗證，只選原文欄就是翻譯 */
export function aiTarget() {
  const s = useStore.getState();
  const keys = s.cellSel?.keys ?? [];
  const cells = keys.map(parseKey);
  const rows = [...new Set(cells.map((c) => c.i))].sort((a, b) => a - b);
  const { sel } = currentOf(s);
  return {
    mode: (!cells.length || cells.some((c) => c.c === TGT_COL) ? 'verify' : 'translate') as 'translate' | 'verify',
    indices: rows.length ? rows : [sel],
  };
}

const prompts = {
  translate: (skill: string) => [
    'You are helping a game translator inside Verso, a translation tool. Use only the verso MCP tools.',
    skill ? `Use the "${skill}" skill for how to translate.` : 'Translate from the source language into English unless the entries clearly show another target language.',
    'Call get_task first. For every entry, translate its src, following the glossary translations, the speaker, the note and the surrounding context, then call write_translation(index, text) with the full translation.',
    'If something needs the translator\'s attention, call write_note(index, text) in Traditional Chinese. Do not do anything else.',
  ].join(' '),
  verify: (skill: string) => [
    'You are reviewing a game translation inside Verso, a translation tool. Use only the verso MCP tools.',
    skill ? `Use the "${skill}" skill for how to review.` : '',
    'Call get_task first. For every entry, check its tgt against src, the glossary, the speaker, the note and the surrounding context.',
    'If the translation needs changes, call write_revision(index, text) with the full corrected translation, then call write_note(index, text) in Traditional Chinese explaining why. If it is fine, leave it alone. Do not do anything else.',
  ].filter(Boolean).join(' '),
};

/**
 * 按下 AI 按鈕：處理中就停止，否則把選取的條目交給 Claude。
 * 超過 50 條而且還沒問過時回傳 'ask'，由畫面先問要不要繼續。
 */
export async function runAi(confirmed = false): Promise<'ask' | void> {
  const s = useStore.getState();
  if (s.aiBusy) { stopping = true; void invoke('ai_stop'); return; }
  if (!isTauri()) { showToast(tx('ai.desktopOnly'), { warn: true }); return; }
  const { mode, indices } = aiTarget();
  if (indices.length > AI_ASK_OVER && !confirmed) return 'ask';
  await startAi();
  const { fileDoc, sheetIdx, sheet } = currentOf(s);
  const list = indices.map((i) => sheet.entries[i]).filter(Boolean);
  job = { fid: fileDoc.fid ?? '', sheet: sheetIdx, mode, indices, uids: list.map((e) => e.uid), before: Object.fromEntries(list.map((e) => [e.uid, e])) };
  const skill = (mode === 'translate' ? s.aiSkillTranslate : s.aiSkillVerify).trim();
  try {
    useStore.setState({ aiBusy: true, aiLocked: job.uids });
    await invoke('ai_run', { prompt: prompts[mode](skill) });
  } catch (e) {
    job = null;
    useStore.setState({ aiBusy: false, aiLocked: [] });
    const msg = String(e);
    showToast(msg === 'not-installed' ? tx('ai.notInstalled') : tx('ai.failed', { msg }), { warn: true });
  }
}
