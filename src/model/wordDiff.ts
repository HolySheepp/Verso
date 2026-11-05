// 整句換成另一句時（AI 的修改、套用翻譯記憶），以詞為單位比對，算出一組一組的修改：
// 只有真的不一樣的詞畫底線，中間沒改的地方不算修改。
import { newEditId, type VEdit } from './verify';

/** 切成詞：英文字母數字連在一起算一個詞，中日韓文字一個字一個詞，空白、標點各自一個 */
const TOKEN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}_'’-]+|\s+|./gsu;
const tokens = (s: string) => s.match(TOKEN) ?? [];

/** 從 a 改成 b 的修改（位置是 a 裡的位置）；完全一樣時是空的 */
export function wordEdits(a: string, b: string): VEdit[] {
  if (a === b) return [];
  const A = tokens(a), B = tokens(b);
  // 頭尾一樣的先拿掉，中間再用最長共同子序列比
  let pre = 0;
  while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++;
  let suf = 0;
  while (suf < A.length - pre && suf < B.length - pre && A[A.length - 1 - suf] === B[B.length - 1 - suf]) suf++;
  const x = A.slice(pre, A.length - suf), y = B.slice(pre, B.length - suf);
  const n = x.length, m = y.length;
  const L: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  // 走一遍：相同的詞是錨點，中間不同的就是一組修改
  type Op = { keep: boolean; a: string; b: string };
  const ops: Op[] = [];
  let i = 0, j = 0;
  const push = (keep: boolean, sa: string, sb: string) => {
    const last = ops[ops.length - 1];
    if (last && last.keep === keep) { last.a += sa; last.b += sb; } else ops.push({ keep, a: sa, b: sb });
  };
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) { push(true, x[i], y[j]); i++; j++; }
    else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) { push(false, '', y[j]); j++; }
    else { push(false, x[i], ''); i++; }
  }
  // 兩組修改中間只隔著空白或單一標點：併成一組（免得一句話被切成很多零碎的底線）
  const merged: Op[] = [];
  for (const op of ops) {
    const prev = merged[merged.length - 1], prev2 = merged[merged.length - 2];
    if (!op.keep && prev?.keep && prev2 && !prev2.keep && /^\s*$/.test(prev.a)) {
      prev2.a += prev.a + op.a; prev2.b += prev.b + op.b;
      merged.pop();
      continue;
    }
    merged.push({ ...op });
  }
  const out: VEdit[] = [];
  let pos = A.slice(0, pre).join('').length;
  for (const op of merged) {
    if (!op.keep) out.push({ s: pos, e: pos + op.a.length, t: op.b, id: newEditId() });
    pos += op.a.length;
  }
  return out;
}
