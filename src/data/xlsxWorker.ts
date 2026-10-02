// 背景執行緒：把檔案轉成 xlsx，轉檔時主畫面不會卡住
import { dictToXlsx, fileToXlsx } from './xlsxio';
import type { CustomMark, FileDoc, GlossaryTerm } from '../model/types';

type Job =
  | { id: number; kind: 'file'; file: FileDoc; customs: CustomMark[] }
  | { id: number; kind: 'dict'; terms: GlossaryTerm[] };

self.onmessage = (ev: MessageEvent<Job>) => {
  const job = ev.data;
  try {
    const data = job.kind === 'file' ? fileToXlsx(job.file, job.customs) : dictToXlsx(job.terms);
    (self as unknown as Worker).postMessage({ id: job.id, data }, [data.buffer]);
  } catch (e) {
    (self as unknown as Worker).postMessage({ id: job.id, error: String((e as Error)?.message ?? e) });
  }
};
