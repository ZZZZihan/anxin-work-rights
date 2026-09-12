import { user, cases } from '../store.js';
import { navigate } from '../router.js';

const statusMap = {
  active:  { class: 'tag-orange', label: '进行中', dot: '#FF6B35' },
  pending: { class: 'tag-blue',   label: '待完善', dot: '#2196F3' },
  done:    { class: 'tag-green',  label: '已结案', dot: '#4CAF50' },
};

const quickEntries = [
  { icon: '🤖', label: 'AI法律咨询', bg: '#fff3e0', page: 'chat' },
  { icon: '📁', label: '证据管家',   bg: '#e3f2fd', page: 'evidence' },
  { icon: '📊', label: '案件追踪',   bg: '#e8f5e9', page: 'track' },
  { icon: '📄', label: '文书生成',   bg: '#f3e5f5', page: 'doc' },
  { icon: '⚖️', label: '合同扫描',   bg: '#fce4ec', page: null },
  { icon: '👨‍⚖️', label: '律师对接',   bg: '#e0f7fa', page: null },
  { icon: '📅', label: '仲裁指南',   bg: '#f9fbe7', page: null },
  { icon: '💬', label: '在线客服',   bg: '#ede7f6', page: null },
];

export function render() {
  const caseSubs = {
    active:  c => `下次行动：${c.nextAction} · 距截止 3 天`,
    pending: c => `待补充：劳动合同复印件`,
    done:    c => `已结案 · 获赔 ¥${c.amount.toLocaleString()}`,
  };

  return `
  <div class="page">
    <div class="page-scroll">
      <div class="home-header">
        <div class="home-user-row">
          <div>
            <div class="home-greeting">你好，${user.name} 👋</div>
            <div class="home-title">安薪乐业</div>
          </div>
          <div class="home-avatar">👤</div>
        </div>
        <div class="home-stats">
          <div class="home-stat">
            <div class="home-stat-value">${user.statsActive}</div>
            <div class="home-stat-label">进行中案件</div>
          </div>
          <div class="home-stat-divider"></div>
          <div class="home-stat">
            <div class="home-stat-value">${user.statsWinRate}</div>
            <div class="home-stat-label">胜诉率预估</div>
          </div>
          <div class="home-stat-divider"></div>
          <div class="home-stat">
            <div class="home-stat-value">${user.statsEvidence}</div>
            <div class="home-stat-label">证据已归档</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">快速入口</div>
        <div class="grid">
          ${quickEntries.map(e => `
            <div class="grid-item" ${e.page ? `data-nav="${e.page}"` : ''}>
              <div class="grid-icon" style="background:${e.bg};">${e.icon}</div>
              <div class="grid-label">${e.label}</div>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="card">
        <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;">
          <span>我的案件</span>
          <span style="font-size:12px;color:var(--c-primary);cursor:pointer;" data-nav="track">查看全部 ›</span>
        </div>
        ${cases.map(c => {
          const s = statusMap[c.status];
          return `
          <div class="list-item" data-nav="track">
            <div class="home-case-dot" style="background:${s.dot};"></div>
            <div class="home-case-info">
              <div class="home-case-name">${c.type} · ${c.company}</div>
              <div class="home-case-sub">${caseSubs[c.status](c)}</div>
            </div>
            <div class="tag ${s.class}">${s.label}</div>
          </div>`;
        }).join('')}
      </div>

      <div class="home-banner">
        <div>
          <h4>🎓 免费法律知识课</h4>
          <p>10分钟了解劳动仲裁全流程</p>
        </div>
        <div class="home-banner-btn">立即学习</div>
      </div>
    </div>
  </div>`;
}

export function mount() {
  document.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', () => navigate(el.dataset.nav));
  });
}
