import { cases, caseSteps } from '../store.js';

const badgeMap = {
  active:  { class: 'badge-active',  label: '进行中' },
  pending: { class: 'badge-pending', label: '待完善' },
  done:    { class: 'badge-done',    label: '已结案' },
};

function renderSteps(currentStep) {
  let html = '';
  caseSteps.forEach((label, i) => {
    const step = i + 1;
    const isDone = step < currentStep || currentStep === 5;
    const isCurrent = step === currentStep && currentStep < 5;
    const cls = isDone ? 'done' : isCurrent ? 'current' : 'todo';
    const dotContent = isDone ? '✓' : step;

    if (i > 0) {
      const lineCls = step <= currentStep ? 'done' : 'todo';
      html += `<div class="step-line ${lineCls}"></div>`;
    }
    html += `
      <div class="step">
        <div class="step-dot ${cls}">${dotContent}</div>
        <div class="step-label ${cls}">${label}</div>
      </div>`;
  });
  return html;
}

function renderCaseCard(c) {
  const b = badgeMap[c.status];
  const opacity = c.status === 'done' ? 'opacity:.75;' : '';
  const actionColor = c.status === 'pending' ? '#FF9800' : c.status === 'done' ? 'var(--c-green)' : 'var(--c-primary)';
  const actionPrefix = c.status === 'active' ? '→ ' : c.status === 'pending' ? '⚠ ' : '✅ ';

  return `
    <div class="case-card" style="${opacity}">
      <div class="case-card-header">
        <div>
          <div class="case-card-title">${c.icon} ${c.type}</div>
          <div class="case-card-company">${c.company} · 涉案金额 ¥${c.amount.toLocaleString()}</div>
        </div>
        <div class="badge ${b.class}">${b.label}</div>
      </div>
      <div class="steps">${renderSteps(c.currentStep)}</div>
      <div class="case-card-footer">
        <div class="case-next-action" style="color:${actionColor};">${actionPrefix}${c.nextAction}</div>
        <div class="case-deadline">⏰ ${c.deadline}</div>
      </div>
    </div>`;
}

export function render() {
  const tabs = [
    { key: 'all',    label: `全部 (${cases.length})` },
    { key: 'active', label: `进行中 (${cases.filter(c => c.status !== 'done').length})` },
    { key: 'done',   label: `已结案 (${cases.filter(c => c.status === 'done').length})` },
  ];

  return `
  <div class="page">
    <div class="page-scroll">
      <div class="track-header">
        <h3>📊 案件追踪</h3>
        <p>共 ${cases.length} 个案件 · ${cases.filter(c => c.status !== 'done').length}个进行中</p>
      </div>

      <div class="track-tabs">
        ${tabs.map((t, i) => `<div class="track-tab ${i === 0 ? 'active' : ''}" data-filter="${t.key}">${t.label}</div>`).join('')}
      </div>

      <div id="case-list">
        ${cases.map(c => renderCaseCard(c)).join('')}
      </div>
    </div>
  </div>`;
}

export function mount() {
  document.querySelectorAll('.track-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.track-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const filter = tab.dataset.filter;
      const filtered = filter === 'all' ? cases :
                       filter === 'done' ? cases.filter(c => c.status === 'done') :
                       cases.filter(c => c.status !== 'done');

      document.getElementById('case-list').innerHTML = filtered.map(c => renderCaseCard(c)).join('');
    });
  });
}
