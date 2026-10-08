// 內建英文：「介面英文翻譯」串定稿後填進來。還沒翻的字句顯示中文。
// 寫法：
// - {名稱} 會換成數字或名稱，要保留。
// - 單複數寫成 {名稱|單數|複數}，例如 '{n} {n|entry|entries}'。
// - {input} 是夾在句子中間的輸入框（settings.048），要保留。
// - 某句英文不需要字時寫空字串 ''，不會被當成缺字。
import type { TextKey } from './index';

export const EN: Partial<Record<TextKey, string>> = {};
