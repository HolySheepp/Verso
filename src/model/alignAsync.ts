// 把自動比對交給背景執行緒；沒辦法開背景執行緒時（例如跑測試）就在原地算
import { autoAlign, type AlignRow, type NewRow } from './srcUpdate';

let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, { resolve(r: AlignRow[]): void; reject(e: Error): void }>();

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === 'undefined') return null;
  try {
    worker = new Worker(new URL('./alignWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<{ id: number; rows?: AlignRow[]; error?: string }>) => {
      const w = waiting.get(ev.data.id);
      if (!w) return;
      waiting.delete(ev.data.id);
      if (ev.data.rows) w.resolve(ev.data.rows); else w.reject(new Error(ev.data.error ?? '比對失敗'));
    };
    worker.onerror = () => {
      waiting.forEach((w) => w.reject(new Error('比對失敗')));
      waiting.clear();
      worker = null;
    };
    return worker;
  } catch {
    return null;
  }
}

export function autoAlignAsync(old: { id: string; src: string }[], next: NewRow[]): Promise<AlignRow[]> {
  const w = getWorker();
  if (!w) return Promise.resolve(autoAlign(old, next));
  const id = ++seq;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    w.postMessage({ id, old, next });
  });
}
