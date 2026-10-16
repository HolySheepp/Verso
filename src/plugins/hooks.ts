// 外掛掛在主程式流程上的接點（不載入外掛本身，主程式哪裡都能安心引用）

/** 雲端檔案的整列操作（刪除、插入、上移、下移）：外掛接手時回傳 true，主程式就不自己改 */
export const rowHook: { fn?: (kind: 'delete' | 'insert' | 'up' | 'down', rows: number[], count: number) => boolean } = {};

/** 雲端檔案的頁簽操作（改名、刪除、插入）：外掛接手時回傳 true */
export const tabHook: {
  rename?: (i: number, name: string) => boolean;
  delete?: (i: number) => boolean;
  insert?: (after: number, sheets: { name: string; entries: import('../model/types').Entry[] }[]) => boolean;
} = {};

/** 軟體結束前要做完的事（例如雲端模式把還沒寫回的譯文寫回去）；每件最多等 8 秒 */
export const beforeExit = new Set<() => Promise<void>>();

export async function runBeforeExit() {
  await Promise.all([...beforeExit].map((fn) => Promise.race([fn().catch(() => undefined), new Promise((r) => setTimeout(r, 8000))])));
}
