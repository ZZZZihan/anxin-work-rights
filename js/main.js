/**
 * 应用入口 — 注册页面 & 初始化
 */
import { register, navigate } from './router.js';
import * as homePage from './pages/home.js';
import * as chatPage from './pages/chat.js';
import * as evidencePage from './pages/evidence.js';
import * as trackPage from './pages/track.js';
import * as docPage from './pages/doc.js';

// 注册五个页面
register('home', homePage);
register('chat', chatPage);
register('evidence', evidencePage);
register('track', trackPage);
register('doc', docPage);

// TabBar 事件
document.querySelectorAll('.tab-item').forEach(tab => {
  tab.addEventListener('click', () => navigate(tab.dataset.page));
});

// 默认进入首页
navigate('home');
