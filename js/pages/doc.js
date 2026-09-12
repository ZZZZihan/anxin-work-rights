import { docTypes, docForm } from '../store.js';
import { toast } from '../utils.js';

export function render() {
  const f = docForm;

  return `
  <div class="page">
    <div class="page-scroll">
      <div class="doc-header">
        <h3>📄 文书生成</h3>
        <p>AI自动填充 · 法条精准引用</p>
      </div>

      <div style="padding:12px 16px 4px;font-size:13px;color:var(--c-text-secondary);font-weight:600;">选择文书类型</div>
      <div class="doc-type-grid">
        ${docTypes.map((d, i) => `
          <div class="doc-type-item ${i === 0 ? 'selected' : ''}" data-idx="${i}">
            <div class="doc-type-icon">${d.icon}</div>
            <div class="doc-type-name">${d.name}</div>
            <div class="doc-type-desc">${d.desc}</div>
          </div>
        `).join('')}
      </div>

      <div class="form-card">
        <div class="form-section-title doc-form-section">👤 申请人信息</div>
        <div class="form-row">
          <div class="form-label">姓名</div>
          <div class="form-value">${f.applicant.name}</div>
          <div class="form-arrow">›</div>
        </div>
        <div class="form-row">
          <div class="form-label">身份证号</div>
          <div class="form-value">${f.applicant.idCard}</div>
          <div class="form-arrow">›</div>
        </div>
        <div class="form-row">
          <div class="form-label">联系电话</div>
          <div class="form-value">${f.applicant.phone}</div>
          <div class="form-arrow">›</div>
        </div>
      </div>

      <div class="form-card">
        <div class="form-section-title doc-form-section">🏢 被申请人信息</div>
        <div class="form-row">
          <div class="form-label">公司名称</div>
          <div class="form-value">${f.respondent.company}</div>
          <div class="form-arrow">›</div>
        </div>
        <div class="form-row">
          <div class="form-label">法定代表人</div>
          <div class="form-value">${f.respondent.legalRep}</div>
          <div class="form-arrow">›</div>
        </div>
      </div>

      <div class="form-card">
        <div class="form-section-title doc-form-section">⚖️ 仲裁请求</div>
        <div class="form-row">
          <div class="form-label">请求事项</div>
          <div class="form-value" style="font-size:13px;">${f.claim.text}</div>
          <div class="form-arrow">›</div>
        </div>
        <div class="form-row">
          <div class="form-label">起诉日期</div>
          <div class="form-value">${f.claim.date}</div>
          <div class="form-arrow">›</div>
        </div>
      </div>

      <div class="doc-law-ref">
        <div class="doc-law-title">📌 AI自动引用相关法条</div>
        <div class="doc-law-text">${f.lawRefs.join('<br><br>')}</div>
      </div>

      <div style="padding:0 16px 20px;">
        <button class="btn-primary doc-export" id="doc-export">
          <span id="export-icon">📥</span>
          <span id="export-text">导出仲裁申请书 PDF</span>
        </button>
      </div>
    </div>
  </div>`;
}

export function mount() {
  // 文书类型选择
  document.querySelectorAll('.doc-type-item').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.doc-type-item').forEach(i => i.classList.remove('selected'));
      el.classList.add('selected');
    });
  });

  // 导出按钮
  const btn = document.getElementById('doc-export');
  btn.addEventListener('click', () => {
    const icon = document.getElementById('export-icon');
    const text = document.getElementById('export-text');
    if (text.textContent.includes('导出')) {
      icon.innerHTML = '<div class="spinner"></div>';
      text.textContent = '正在生成文书…';
      setTimeout(() => {
        icon.textContent = '✅';
        text.textContent = '生成完成！点击下载';
        toast('仲裁申请书已生成，共 4 页');
        setTimeout(() => {
          icon.textContent = '📥';
          text.textContent = '导出仲裁申请书 PDF';
        }, 3000);
      }, 2200);
    }
  });
}
