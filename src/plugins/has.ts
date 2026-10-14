// 只查「這次打包有沒有某個外掛」，不載入外掛本身（底層的 model 也能安心用，不會互相引用）
const keys = Object.keys(import.meta.glob('./*/index.{ts,tsx}'));

/** 有沒有這個外掛（例如 'ai'） */
export const hasPlugin = (id: string) => keys.some((k) => k.startsWith(`./${id}/`));
