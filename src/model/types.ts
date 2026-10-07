import type { StdValue } from './length';
import type { VerifyData } from './verify';
// 資料模型。之後接真正的檔案讀寫時，讀寫層只需要產生/接收這些型別。
// 結構：專案 → 檔案 → 頁簽 → 條目

/** 內建標記 id */
export type BuiltinMarkId = 'untranslated' | 'translated' | 'verified' | 'doubt' | 'think' | 'ignore' | 'srcupd';

/** 顯示用的標記 id：內建標記，或 `c:<自訂標記 id>` */
export type MarkId = BuiltinMarkId | `c:${string}`;

/**
 * 會被存下來的標記：只有使用者刻意標的。
 * 「已翻譯／未翻譯」由有無譯文推算，不存；空字串代表沒有刻意標記。
 */
export type StoredMark = '' | 'verified' | 'doubt' | 'think' | 'ignore' | `c:${string}`;

export interface Entry {
  /** 內部唯一編號，只給程式用 */
  uid: string;
  /** 對話 id，通常是純數字，顯示在 # 欄 */
  id: string;
  speaker: string;
  /** 目前原文（原文修正模式可改） */
  src: string;
  /** 匯入時的原文，原文修正時保留 */
  src0: string;
  tgt: string;
  /** 匯入時的譯文，驗證模式「還原譯文」用 */
  tgt0: string;
  mark: StoredMark;
  /**
   * 待確認：貼入的條目一律先算未翻譯，就算已經有譯文。
   * 在翻譯或驗證模式按下一條、標記並下一條，或修改譯文之後才解除。
   */
  pending: boolean;
  /** 標點檢測誤報時按「略過」，之後不再檢查這條 */
  skipCheck: boolean;
  /** 這一條的特殊長度標準；沒有就用檔案標準 */
  lengthStd?: StdValue;
  /**
   * 檔案裡記著、但目前認不得（或刪除時選擇保留）的自訂標記。
   * 畫面上當作沒有標記，存檔時照樣寫回去；使用者重新標記時就清掉。
   */
  keptMark?: string;
  /** 我的備註 */
  note: string;
  /** 建議翻譯 */
  sugg: string;
  /** 建議翻譯的檢查誤報時按「略過」，之後不再檢查建議翻譯 */
  skipSugg?: boolean;
  /** 驗證模式的修改（沒有修改時不設） */
  ver?: VerifyData;
  /**
   * 原文更新（系統標記，優先顯示）：src 是暫存的新原文；removed 是新版已移除；
   * applied 是新原文已套用，等按下一條或改譯文才清掉。
   */
  upd?: SrcUpdate;
}

/** hidden：使用者改了標記，「原文更新」標記不再顯示（新原文還在，仍可查看、套用） */
export interface SrcUpdate { src?: string; removed?: boolean; applied?: boolean; hidden?: boolean }

export interface Sheet {
  name: string;
  entries: Entry[];
}

export interface FileDoc {
  /** 檔案 ID：軟體內部靠它認檔案；在外面改名、搬專案也還是同一個檔案（檔名只是顯示用） */
  fid?: string;
  name: string;
  /** 檔案的長度標準（套用到全部條目）；沒設定是 undefined */
  lengthStd?: StdValue;
  /** 所屬專案 */
  project: string;
  sheets: Sheet[];
}

export type SymbolId =
  | 'star' | 'heart' | 'diamond' | 'square' | 'bolt' | 'bookmark'
  | 'bell' | 'eye' | 'chat' | 'pin' | 'hash' | 'question';

export type CustomMark =
  | { id: string; name: string; kind: 'sym'; sym: SymbolId; color: string }
  | { id: string; name: string; kind: 'text'; text: string; color: string };

export interface GlossaryTerm {
  id: string;
  term: string;
  en: string;
  dict: string;
  note: string;
  proj: string;
}

export interface RefDoc {
  name: string;
  desc: string;
}

/** 字典：名稱加上所屬專案才能確定是哪一本 */
export interface DictInfo {
  project: string;
  name: string;
  /** 字典 ID：在外面改名、搬專案也認得出是同一本 */
  did?: string;
}

/** 新的檔案、字典 ID */
export const newFileId = () => 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

/** 共用專案：一定存在、不能刪除 */
export const SHARED = '共用';

export const dictKey = (project: string, name: string) => project + '/' + name;

/**
 * 整個工作區：所有專案的檔案、字典都一起載入。
 * 標籤目前只有「專案」一種，掛在檔案（FileDoc.project）和字典（DictInfo.project）上；
 * 詞條跟著所屬字典的專案走（GlossaryTerm.proj）。
 */
export interface ProjectData {
  /** 下一個自訂標記的編號（自訂標記不分專案） */
  nextMarkId?: number;
  files: FileDoc[];
  customMarks: CustomMark[];
  glossary: GlossaryTerm[];
  dicts: DictInfo[];
  /** 所有專案名稱，共用放最後 */
  projects: string[];
  refs: RefDoc[];
}

/** 譯文記錄：每條最多 3 段，全部最多 3 條（見 history.ts） */
export interface EntryHistory {
  texts: string[];
  slot: number;
}

export type Mode = 'translate' | 'verify' | 'view' | 'source';
