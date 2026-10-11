// 背景執行緒：原文更新的自動比對，條目很多時主畫面不會卡住
import { allCandidates, autoAlign, type NewRow } from './srcUpdate';

self.onmessage = (ev: MessageEvent<{ id: number; old: { id: string; src: string }[]; next: NewRow[] }>) => {
  const { id, old, next } = ev.data;
  const post = (msg: unknown) => (self as unknown as Worker).postMessage(msg);
  try {
    post({ id, rows: autoAlign(old, next) });
  } catch (e) {
    post({ id, error: String((e as Error)?.message ?? e) });
    return;
  }
  // 比對結果先送回去，再找每句新原文的「高相似」候選：對齊畫面拖動時不必在主畫面重掃
  try { post({ id, cands: allCandidates(old, next) }); } catch { post({ id, cands: null }); }
};
