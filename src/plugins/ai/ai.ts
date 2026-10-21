// AI 協助：Verso 開一個本機 MCP 服務，按鈕在背景執行 Claude Code，Claude 透過服務的工具讀寫條目。
// 工具在這裡處理（條目資料在畫面這邊）。Claude 只能讀條目、讀字典、寫譯文、寫修改、寫建議翻譯、寫備註；
// 不能存檔、改原文、刪條目。
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { stripIds, tx } from '../../i18n';
import { enabledIssues } from '../../model/checks';
import { effectiveStd, type LengthStd } from '../../model/length';
import { measure } from '../../model/measure';
import { TGT_COL, parseKey } from '../../model/cells';
import { appendNote } from '../../model/paste';
import { ratio } from '../../model/srcUpdate';
import { applyChange, compose, editsOf } from '../../model/verify';
import { dictKey, projectTag, type Entry } from '../../model/types';
import { findHits } from '../../state/dictHits';
import { checkText, fileStdFor, currentOf, currentProjectOf, dictEnabledIn, shownSrc, showToast, useStore, withSugg } from '../../state/store';

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
      + 'the 5 entries before and after it (context), the glossary terms found in its source text (glossary: term and its required translations), '
      + 'length_limit (max_lines the English must fit in, at the given width and font; null when there is no limit), '
      + 'checks (problems Verso\'s checks already find in the current translation, with the edits applied; for overflows also max_lines, lines_now and about_chars_to_cut) '
      + 'and suggestion_checks (the same for the suggestion). Both are left out when there is nothing to report.',
    inputSchema: obj({}),
  },
  {
    name: 'get_checks',
    description: 'After writing, call this to see which task entries still have problems found by Verso\'s checks, for the text you wrote. '
      + 'For entries that overflow the length limit it gives max_lines, the lines the text takes now, and roughly how many characters to cut. '
      + 'Rewrite those entries (same write tool again) and call get_checks again until nothing is left or a problem cannot be fixed without losing important meaning (then explain in write_note).',
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
    name: 'undo_change',
    description: 'Throw away everything you wrote for one entry in this task (translation, edits, suggestion and note), putting it back exactly as it was before. Use it when a change turns out to be wrong and you are not replacing it.',
    inputSchema: obj({ index: idx }, ['index']),
  },
  {
    name: 'write_note',
    description: 'Set your final note for one entry: why you changed it, or something the translator should check. Write it in Traditional Chinese. '
      + 'Only write it once the entry is final (after get_checks). Calling it again for the same entry replaces your earlier note; the translator only sees your last one. Verso adds the prefix "AI：".',
    inputSchema: obj({ index: idx, text: { type: 'string' } }, ['index', 'text']),
  },
];

/** notes：AI 的備註先記在這裡，做完才寫進條目（同一條寫第二次就換掉，譯者只看到最後的） */
interface Job { fid: string; sheet: number; mode: 'translate' | 'verify'; indices: number[]; uids: string[]; before: Record<string, Entry>; wrote: Record<string, 'tgt' | 'sugg'>; notes: Record<string, string> }
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

/** 這條要用的長度標準（條目自己的，沒有就用檔案的） */
function stdOf(j: Job, e: Entry): LengthStd | null {
  const p = useStore.getState().project;
  return effectiveStd(e.lengthStd, fileStdFor(p, p?.files.find((x) => x.fid === j.fid))) ?? null;
}

const limitOf = (std: LengthStd | null) => (std ? { max_lines: std.lines, width_px: std.width, font: `${std.family} ${std.size}pt` } : null);

/**
 * 一段文字的檢查結果（照使用者開的檢查項目，跟工作欄報的一樣）：超框的附上限、現在幾行、大約要刪幾個字元。
 * 沒有問題回傳 null
 */
function issuesOf(j: Job, e: Entry, text: string) {
  if (!text.trim()) return null;
  const std = stdOf(j, e);
  const issues = enabledIssues(shownSrc(e), text, useStore.getState().checkSettings, std);
  if (!issues.length) return null;
  const m = std && issues.some((x) => x.check === 'overflow') ? measure(text, std) : null;
  return {
    problems: issues.map((x) => ({ check: x.check, message: stripIds(x.msg) })),
    ...(m && std ? { overflow: { max_lines: std.lines, lines_now: m.lines, about_chars_to_cut: Math.max(1, text.length - m.fitLen) } } : {}),
  };
}

/** 譯文要不要檢查：使用者按過「略過」或標成忽略的不給 AI 看 */
const tgtChecked = (e: Entry) => e.mark !== 'ignore' && !e.skipCheck;

/** AI 寫的文字有沒有過檢查（略過的條目不報） */
function getChecks(j: Job) {
  const sheet = sheetOf(j)!;
  const out: unknown[] = [];
  for (const i of j.indices) {
    const e = sheet.entries[i];
    if (!e || !j.wrote[e.uid]) continue;
    // 驗證時改很多的放在建議翻譯：檢查建議翻譯；其他檢查譯文（有修改的話是改好之後的樣子）
    const sugg = j.wrote[e.uid] === 'sugg';
    if (sugg ? e.skipSugg : !tgtChecked(e)) continue;
    const text = sugg ? e.sugg : checkText(e);
    const found = issuesOf(j, e, text);
    if (found) out.push({ index: i, text, ...found });
  }
  return out.length ? out : 'No problems.';
}

/** get_task 附上目前的檢查結果：譯文（套用修改後）和建議翻譯各一份，略過的、沒問題的不給 */
function checksOf(j: Job, e: Entry) {
  const tgt = tgtChecked(e) ? issuesOf(j, e, checkText(e)) : null;
  const sugg = !e.skipSugg ? issuesOf(j, e, e.sugg) : null;
  return { ...(tgt ? { checks: tgt } : {}), ...(sugg ? { suggestion_checks: sugg } : {}) };
}

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
        length_limit: limitOf(stdOf(j, e)),
        ...checksOf(j, e),
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
  if (name === 'get_checks') return getChecks(j);
  const i = Number(args.index);
  const e = sheet.entries[i];
  if (!e || !j.uids.includes(e.uid)) throw new Error('This entry is not part of the task.');
  const text = String(args.text ?? '').replace(/\r\n?/g, '\n');
  const { aiPatch } = useStore.getState();
  if (name === 'write_note') {
    if (!text.trim()) throw new Error('Empty note.');
    j.notes[e.uid] = text.trim();
    return 'ok (shown to the translator when the task ends)';
  }
  if (name === 'undo_change') {
    const b = j.before[e.uid];
    aiPatch(j.fid, j.sheet, e.uid, (x) => ({ ...x, tgt: b.tgt, ver: b.ver, sugg: b.sugg, mark: b.mark, pending: b.pending }));
    delete j.wrote[e.uid];
    delete j.notes[e.uid];
    progress(j);
    return 'reverted';
  }
  if (!text.trim()) throw new Error('Empty text.');
  if (name === 'write_translation') {
    if (j.mode !== 'translate') throw new Error('This task is verify mode; use write_revision.');
    // 空的直接填進譯文，已經有譯文的放進修改框；都標「AI 翻譯」
    // 已經寫過一次（例如照檢查結果重寫）：空的那種直接換掉譯文，有原譯文的那種重算修改
    const fresh = j.wrote[e.uid] ? j.before[e.uid] : undefined;
    const filled = fresh ? !fresh.tgt.trim() : !e.tgt.trim();
    aiPatch(j.fid, j.sheet, e.uid, (x) => (filled
      ? { ...x, tgt: text, pending: false, mark: 'ai' }
      : { ...withEdits(x, text), mark: 'ai' }));
    j.wrote[e.uid] = 'tgt';
    progress(j);
    return 'ok';
  }
  if (name === 'write_revision') {
    if (j.mode !== 'verify') throw new Error('This task is translate mode; use write_translation.');
    if (text === e.tgt) return 'unchanged';
    // 整句換掉或改很多：放進建議翻譯；小幅修改：放進修改框（跟驗證模式一樣自動標疑慮）
    if (ratio(e.tgt, text) < BIG_CHANGE) {
      // 跟手動填建議翻譯一樣：標疑慮，記住原本的標記
      aiPatch(j.fid, j.sheet, e.uid, (x) => withSugg(x, text));
      j.wrote[e.uid] = 'sugg';
      progress(j);
      return 'saved as suggestion';
    }
    j.wrote[e.uid] = 'tgt';
    progress(j);
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

/** 做完或停止：寫上最後的備註、解除鎖定，這次改過的條目合成一步復原 */
function finish() {
  const j = job;
  job = null;
  if (j) {
    const { aiPatch } = useStore.getState();
    for (const [uid, text] of Object.entries(j.notes)) aiPatch(j.fid, j.sheet, uid, (x) => ({ ...x, note: appendNote(x.note, 'AI：' + text) }));
    useStore.getState().aiFinish(j.fid, j.sheet, j.before);
  }
  useStore.setState({ aiBusy: false, aiLocked: [], aiProgress: null });
}

/** 狀態列的進度：寫過幾條／共幾條 */
const progress = (j: Job) => useStore.setState({ aiProgress: { done: Object.keys(j.wrote).length, total: j.uids.length } });

/** 失敗的原因，用一句看得懂的話說（不顯示原始錯誤） */
function failReason(text: string): string {
  if (/authenticat|oauth|log ?in|logged out|unauthori[sz]ed|\b401\b|session expired|credentials/i.test(text)) return tx('ai.errLogin');
  if (/usage limit|limit reached|rate.?limit|quota|credit balance|out of (usage|credits)|\b429\b|token/i.test(text)) return tx('ai.errQuota');
  return tx('ai.errOther');
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
    else showToast(failReason(ev.payload.error + '\n' + ev.payload.output), { warn: true });
  });
  // 關閉 Verso、換存檔資料夾、改名或刪除專案前：AI 還在工作就先問
  useStore.setState({ aiGuard: () => {
    if (!useStore.getState().aiBusy) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => useStore.setState({ aiStopAsk: (stop) => {
      useStore.setState({ aiStopAsk: null });
      if (stop) { stopping = true; void invoke('ai_stop'); }
      resolve(stop);
    } }));
  } });
}

/** skill 有沒有裝在 Claude Code 讀得到的地方（使用者資料夾\.claude\skills\名稱\SKILL.md） */
async function skillExists(name: string): Promise<boolean> {
  try {
    const { homeDir, join } = await import('@tauri-apps/api/path');
    const { exists } = await import('@tauri-apps/plugin-fs');
    return await exists(await join(await homeDir(), '.claude', 'skills', name, 'SKILL.md'));
  } catch { return true; }
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

/** 條目有檢查結果時一定要處理 */
const CHECKS_RULE = 'If get_task lists checks for an entry, that entry must be fixed even when its meaning is fine (for example, shorten it until it fits the length limit); only if it cannot be fixed without losing important meaning, leave it and explain why in write_note.';

const prompts = {
  translate: (skill: string) => [
    'You are helping a game translator inside Verso, a translation tool. Use only the verso MCP tools.',
    skill ? `Use the "${skill}" skill for how to translate.` : 'Translate from the source language into English unless the entries clearly show another target language.',
    'Call get_task first. For every entry, translate its src, following the glossary translations, the speaker, the note and the surrounding context, then call write_translation(index, text) with the full translation.',
    'When all entries are written, call get_checks and rewrite the entries it reports (especially length overflows) until nothing is left.',
    CHECKS_RULE,
    'Only after that, for entries that need the translator\'s attention (or a problem you could not fix without losing important meaning), call write_note(index, text) once with your final note in Traditional Chinese. Never write notes about intermediate attempts. Do not do anything else.',
  ].join(' '),
  verify: (skill: string) => [
    'You are reviewing a game translation inside Verso, a translation tool. Use only the verso MCP tools.',
    skill ? `Use the "${skill}" skill for how to review.` : '',
    'Call get_task first. For every entry, check its tgt against src, the glossary, the speaker, the note and the surrounding context.',
    'If the translation needs changes, call write_revision(index, text) with the full corrected translation. If it is fine, leave it alone.',
    CHECKS_RULE,
    'Then call get_checks and fix what it reports for the entries you revised (especially length overflows): rewrite them, or call undo_change(index) if your change was wrong and the original should stay.',
    'Only when every revision is final, call write_note(index, text) once per revised entry with the final reason in Traditional Chinese. Never write notes about intermediate attempts or ask the translator to ignore your own change. Do not do anything else.',
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
  job = { fid: fileDoc.fid ?? '', sheet: sheetIdx, mode, indices, uids: list.map((e) => e.uid), before: Object.fromEntries(list.map((e) => [e.uid, e])), wrote: {}, notes: {} };
  const ps = s.project?.tagSettings?.[projectTag(fileDoc.project)]?.ai ?? {};
  const skill = ((mode === 'translate' ? ps.skillTranslate : ps.skillVerify) || (mode === 'translate' ? s.aiSkillTranslate : s.aiSkillVerify) || '').trim();
  const model = ps.model || 'opus', effort = ps.effort || 'medium';
  if (skill && !(await skillExists(skill))) { job = null; showToast(tx('ai.errSkill'), { warn: true }); return; }
  try {
    useStore.setState({ aiBusy: true, aiLocked: job.uids });
    progress(job);
    await invoke('ai_run', { prompt: prompts[mode](skill), model, effort });
  } catch (e) {
    job = null;
    useStore.setState({ aiBusy: false, aiLocked: [] });
    const msg = String(e);
    useStore.setState({ aiProgress: null });
    showToast(msg === 'not-installed' ? tx('ai.errNotInstalled') : tx('ai.errOther'), { warn: true });
  }
}
