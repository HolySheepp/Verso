// 背景執行緒：原文更新的自動比對，條目很多時主畫面不會卡住
import { autoAlign, type NewRow } from './srcUpdate';

self.onmessage = (ev: MessageEvent<{ id: number; old: { id: string; src: string }[]; next: NewRow[] }>) => {
  const { id, old, next } = ev.data;
  try {
    (self as unknown as Worker).postMessage({ id, rows: autoAlign(old, next) });
  } catch (e) {
    (self as unknown as Worker).postMessage({ id, error: String((e as Error)?.message ?? e) });
  }
};
