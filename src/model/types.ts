// 資料模型。之後接真正的檔案讀寫時，讀寫層只需要產生/接收這些型別。
// 結構：專案 → 檔案 → 頁簽 → 條目

/** 內建標記 id */
export type BuiltinMarkId = 'untranslated' | 'translated' | 'verified' | 'doubt' | 'think' | 'ignore';

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
  /** 我的備註 */
  note: string;
  /** 建議翻譯 */
  sugg: string;
}

export interface Sheet {
  name: string;
  entries: Entry[];
}

export interface FileDoc {
  name: string;
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

export interface ProjectData {
  name: string;
  files: FileDoc[];
  customMarks: CustomMark[];
  glossary: GlossaryTerm[];
  dicts: string[];
  projects: string[];
  refs: RefDoc[];
}

/** 譯文記錄：每條最多 3 段，全部最多 3 條（見 history.ts） */
export interface EntryHistory {
  texts: string[];
  slot: number;
}

export type Mode = 'translate' | 'verify' | 'view' | 'source';
