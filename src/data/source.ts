// 專案資料的讀寫接口。目前只有範例資料；之後接 Google Sheets／Docs 或本機檔案時，
// 新增一個實作這個介面的來源，再把 activeSource 換掉即可，介面層不用改。
import type { ProjectData } from '../model/types';
import { sampleProject } from './sample';

export interface ProjectSource {
  load(): Promise<ProjectData>;
  save(data: ProjectData): Promise<void>;
}

export const sampleSource: ProjectSource = {
  load: async () => sampleProject(),
  save: async () => {},
};

export const activeSource: ProjectSource = sampleSource;
