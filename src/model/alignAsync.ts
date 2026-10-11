// 把自動比對交給背景執行緒；沒辦法開背景執行緒時（例如跑測試）就在原地算
import { tx } from '../i18n';
import { autoAlign, type AlignRow, type NewRow } from './srcUpdate';

/** 比對被取消（按了上一步、關掉視窗）：呼叫端要忽略這個錯誤 */
export class AlignCancelled extends Error {
  constructor() { super('cancelled'); this.name = 'AlignCancelled'; }
}

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
      if (ev.data.rows) w.resolve(ev.data.rows); else w.reject(new Error(ev.data.error ?? tx('align.001')));
    };
    const me = worker;
    worker.onerror = () => {
      waiting.forEach((w) => w.reject(new Error(tx('align.001'))));
      waiting.clear();
      me.terminate();
      if (worker === me) worker = null;
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

/** 取消所有還在算的比對：把背景執行緒停掉（下一次比對會開新的，不必排在舊的後面） */
export function cancelAlign() {
  worker?.terminate();
  worker = null;
  waiting.forEach((w) => w.reject(new AlignCancelled()));
  waiting.clear();
}
