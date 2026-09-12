/**
 * 工具函数
 */

let toastTimer = null;

/** 显示 Toast 提示 */
export function toast(msg, duration = 2500) {
  const el = document.getElementById('toast');
  clearTimeout(toastTimer);
  el.textContent = msg;
  el.classList.add('show');
  toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}

/** 简易 HTML 转义 */
export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/** 格式化金额 */
export function formatMoney(n) {
  return '¥' + n.toLocaleString('zh-CN');
}
