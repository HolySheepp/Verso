// 外掛掛在主程式流程上的接點（不載入外掛本身，主程式哪裡都能安心引用）

/** 軟體結束前要做完的事（例如雲端模式把還沒寫回的譯文寫回去）；每件最多等 8 秒 */
export const beforeExit = new Set<() => Promise<void>>();

export async function runBeforeExit() {
  await Promise.all([...beforeExit].map((fn) => Promise.race([fn().catch(() => undefined), new Promise((r) => setTimeout(r, 8000))])));
}
