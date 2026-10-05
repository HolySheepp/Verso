// 驗證模式修改框的編輯狀態：給全域快捷鍵用（Enter 先確定修改、Ctrl+Z 撤回）
export const verifySession = {
  /** 修改框裡有還沒確定的修改 */
  dirty: false,
  /** 確定目前的修改 */
  commit: () => {},
};
