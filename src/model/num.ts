// 很大的陣列不能用 Math.min(...xs)／Math.max(...xs)（參數太多會丟錯），改用這兩個

/** 最小值；空陣列回傳 fallback */
export function minOf(xs: readonly number[], fallback = Infinity): number {
  let m = fallback;
  for (const x of xs) if (x < m) m = x;
  return m;
}

/** 最大值；空陣列回傳 fallback */
export function maxOf(xs: readonly number[], fallback = -Infinity): number {
  let m = fallback;
  for (const x of xs) if (x > m) m = x;
  return m;
}
