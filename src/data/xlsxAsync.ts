// 把轉 xlsx 的工作交給背景執行緒；沒辦法開背景執行緒時（例如跑測試）就在原地轉
import { dictToXlsx, fileToXlsx } from './xlsxio';
import type { CustomMark, FileDoc, GlossaryTerm } from '../model/types';

let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, { resolve(d: Uint8Array): void; reject(e: Error): void }>();

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === 'undefined') return null;
  try {
    worker = new Worker(new URL('./xlsxWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<{ id: number; data?: Uint8Array; error?: string }>) => {
      const w = waiting.get(ev.data.id);
      if (!w) return;
      waiting.delete(ev.data.id);
      if (ev.data.data) w.resolve(ev.data.data); else w.reject(new Error(ev.data.error ?? '轉檔失敗'));
    };
    worker.onerror = () => {
      // 背景執行緒壞了：之後改在原地轉
      waiting.forEach((w) => w.reject(new Error('轉檔失敗')));
      waiting.clear();
      worker = null;
    };
    return worker;
  } catch {
    return null;
  }
}

function run(job: { kind: 'file'; file: FileDoc; customs: CustomMark[] } | { kind: 'dict'; terms: GlossaryTerm[] }): Promise<Uint8Array> {
  const w = getWorker();
  if (!w) return Promise.resolve(job.kind === 'file' ? fileToXlsx(job.file, job.customs) : dictToXlsx(job.terms));
  const id = ++seq;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    w.postMessage({ id, ...job });
  });
}

export const fileToXlsxAsync = (file: FileDoc, customs: CustomMark[]) => run({ kind: 'file', file, customs });
export const dictToXlsxAsync = (terms: GlossaryTerm[]) => run({ kind: 'dict', terms });
