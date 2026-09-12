/**
 * 简易 SPA 路由
 * 每个页面模块导出 { render(), mount(), destroy?() }
 */

const routes = {};      // name → module
let currentPage = null;  // 当前激活的页面名
let currentModule = null;

/** 注册页面 */
export function register(name, mod) {
  routes[name] = mod;
}

/** 切换页面 */
export function navigate(name) {
  if (name === currentPage) return;

  // 销毁旧页面
  if (currentModule?.destroy) currentModule.destroy();

  const mod = routes[name];
  if (!mod) return;

  // 渲染新页面
  const container = document.getElementById('page-container');
  container.innerHTML = mod.render();
  mod.mount();

  // 更新 TabBar 高亮
  document.querySelectorAll('.tab-item').forEach(t => {
    t.classList.toggle('active', t.dataset.page === name);
  });

  currentPage = name;
  currentModule = mod;
}

/** 获取当前页面名 */
export function current() {
  return currentPage;
}
