import { evidence } from '../store.js';
import { toast } from '../utils.js';

const statusClass = { ok: 'ev-status-ok', warn: 'ev-status-warn', miss: 'ev-status-miss' };
const statusLabel = { ok: '已验证', warn: '待核实', miss: '未上传' };

function renderItem(item, clickable = false) {
  const bg = item.status === 'miss' ? 'var(--c-red-bg)' : item.status === 'warn' && !item.tip ? '' : '';
  return `
    <div class="ev-item" ${clickable && item.tip ? `data-tip="${item.tip}"` : ''}>
      <div class="ev-thumb" ${bg ? `style="background:${bg}"` : ''}>${item.icon}</div>
      <div class="ev-info">
        <div class="ev-name">${item.name}</div>
        <div class="ev-meta">${item.meta}</div>
      </div>
      <div class="ev-status ${statusClass[item.status]}">${item.tip && item.status === 'warn' ? '建议补充' : statusLabel[item.status]}</div>
    </div>`;
}

export function render() {
  return `
  <div class="page">
    <div class="page-scroll">
      <div class="ev-header">
        <h3>📁 证据管家</h3>
        <p>已归档 12 份 · 当前案件证据完整度</p>
        <div class="ev-progress">
          <div class="ev-progress-bar">
            <div class="ev-progress-fill" style="width:${evidence.completeness}%;"></div>
          </div>
          <div class="ev-progress-label">${evidence.completeness}% 核心证据</div>
        </div>
      </div>

      <div class="ev-alert">
        <div class="ev-alert-title">⚠️ 缺少关键证据</div>
        <div class="ev-alert-desc">劳动合同原件未上传，可能影响仲裁胜诉率</div>
      </div>

      <div class="ev-list">
        <div class="ev-cat">
          <div class="ev-cat-title">✅ 已上传证据 (${evidence.uploaded.length}份)</div>
          ${evidence.uploaded.map(e => renderItem(e)).join('')}
        </div>
        <div class="ev-cat">
          <div class="ev-cat-title">❗ 缺少证据 (${evidence.missing.length}份)</div>
          ${evidence.missing.map(e => renderItem(e, true)).join('')}
        </div>
      </div>

      <div class="ev-upload" id="ev-upload">
        <div class="ev-upload-icon">📎</div>
        <div class="ev-upload-text">点击上传证据文件</div>
        <div class="ev-upload-sub">支持图片、PDF、Word · AI自动识别关键信息</div>
      </div>
    </div>
  </div>`;
}

export function mount() {
  // 缺失证据点击提示
  document.querySelectorAll('[data-tip]').forEach(el => {
    el.addEventListener('click', () => toast(el.dataset.tip));
  });

  // 模拟上传
  document.getElementById('ev-upload').addEventListener('click', () => {
    toast('AI正在识别文件内容…');
    setTimeout(() => toast('识别成功！已提取关键字段'), 1800);
  });
}
