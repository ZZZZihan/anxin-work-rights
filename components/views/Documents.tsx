'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Download,
  FileClock,
  FileText,
  Info,
  ListChecks,
  Plus,
  Printer,
  Save,
  ScrollText,
} from 'lucide-react';
import { apiRequest } from '@/lib/client';
import type { DocumentDraft, WorkCase } from '@/lib/types';
import type { SharedViewProps } from '../types';

type TemplateField = { key: string; label: string; placeholder: string; multiline?: boolean };
type Template = { id: string; title: string; description: string; icon: typeof FileText; fields: TemplateField[] };

const templates: Template[] = [
  {
    id: 'arbitration-application',
    title: '劳动仲裁申请书',
    description: '整理当事人、仲裁请求和事实理由',
    icon: ScrollText,
    fields: [
      { key: 'applicantName', label: '申请人', placeholder: '姓名' },
      { key: 'contact', label: '联系方式', placeholder: '手机号码' },
      { key: 'respondent', label: '被申请人', placeholder: '单位完整名称' },
      { key: 'respondentAddress', label: '单位地址', placeholder: '工商登记或实际经营地址' },
      { key: 'requests', label: '仲裁请求', placeholder: '一项一行，写明金额或具体事项', multiline: true },
      { key: 'facts', label: '事实与理由', placeholder: '按时间顺序陈述劳动关系、争议发生和沟通过程', multiline: true },
      { key: 'evidenceList', label: '证据目录', placeholder: '证据名称、来源和拟证明事项', multiline: true },
    ],
  },
  {
    id: 'wage-demand-letter',
    title: '欠薪催告函',
    description: '向单位书面确认欠付金额与付款期限',
    icon: FileClock,
    fields: [
      { key: 'sender', label: '发函人', placeholder: '姓名' },
      { key: 'contact', label: '联系方式', placeholder: '手机号码' },
      { key: 'recipient', label: '收函单位', placeholder: '单位完整名称' },
      { key: 'amount', label: '欠付金额', placeholder: '例如：人民币 12,480 元' },
      { key: 'dueDate', label: '希望付款日期', placeholder: '例如：2026 年 9 月 2 日' },
      { key: 'facts', label: '欠付经过', placeholder: '工资期间、约定标准、已付和未付情况', multiline: true },
      { key: 'paymentMethod', label: '收款方式', placeholder: '可填写银行卡尾号或另行沟通' },
    ],
  },
  {
    id: 'injury-material-checklist',
    title: '工伤认定材料清单',
    description: '记录事故事实与待准备的申请材料',
    icon: ListChecks,
    fields: [
      { key: 'worker', label: '受伤职工', placeholder: '姓名' },
      { key: 'contact', label: '联系方式', placeholder: '手机号码' },
      { key: 'employer', label: '用人单位', placeholder: '单位完整名称' },
      { key: 'injuryDate', label: '事故日期', placeholder: '例如：2026 年 8 月 1 日' },
      { key: 'injuryPlace', label: '事故地点', placeholder: '具体工作地点' },
      { key: 'injuryFacts', label: '事故经过', placeholder: '工作任务、发生经过、现场人员与后续就医', multiline: true },
      { key: 'medicalInstitution', label: '就医机构', placeholder: '医院名称及就诊时间' },
      { key: 'materials', label: '材料清单', placeholder: '劳动关系、诊断材料、事故证明、身份证明等', multiline: true },
    ],
  },
  {
    id: 'fact-timeline',
    title: '案件事实时间线',
    description: '把关键日期、人物、事件和证据对齐',
    icon: FileText,
    fields: [
      { key: 'title', label: '时间线标题', placeholder: '例如：欠薪与协商经过' },
      { key: 'participants', label: '相关人员', placeholder: '姓名、职务、联系方式或角色' },
      { key: 'events', label: '关键事件', placeholder: '每行一项：日期｜发生事项｜对应证据', multiline: true },
      { key: 'gaps', label: '待核实事项', placeholder: '尚不确定的日期、金额或人员', multiline: true },
      { key: 'notes', label: '补充说明', placeholder: '其他需要保留的背景', multiline: true },
    ],
  },
];

export default function Documents({
  data,
  setData,
  activeCaseId,
  setActiveCaseId,
  navigate,
  notify,
}: SharedViewProps) {
  const [templateId, setTemplateId] = useState(templates[0].id);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const activeCase = data.cases.find((item) => item.id === activeCaseId) ?? data.cases[0];
  const template = templates.find((item) => item.id === templateId) ?? templates[0];
  const draft = data.documents.find((item) => item.caseId === activeCase?.id && item.type === templateId);

  const defaults = useMemo(
    () => activeCase ? buildDefaults(templateId, activeCase, data.user.displayName) : {},
    [activeCase, data.user.displayName, templateId],
  );

  useEffect(() => {
    // Switching the case or template starts a new editable working copy.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFields(draft?.fields ?? defaults);
    setSaved(Boolean(draft));
  }, [draft, activeCase?.id, defaults]);

  const update = (key: string, value: string) => {
    setSaved(false);
    setFields((current) => ({ ...current, [key]: value }));
  };

  const save = async () => {
    if (!activeCase) return;
    setSaving(true);
    try {
      const result = await apiRequest<{ document: DocumentDraft }>('/api/documents', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId: activeCase.id, type: templateId, fields }),
      });
      setData((current) => current ? {
        ...current,
        documents: [
          result.document,
          ...current.documents.filter((item) => item.id !== result.document.id),
        ],
      } : current);
      setSaved(true);
      notify('草稿已保存。');
    } catch (error) {
      notify(error instanceof Error ? error.message : '保存失败。', 'error');
    } finally {
      setSaving(false);
    }
  };

  const markup = activeCase ? buildDocumentMarkup(template, fields, activeCase) : '';

  const downloadWord = () => {
    const blob = new Blob([`\ufeff${documentShell(markup)}`], { type: 'application/msword;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${template.title}-${activeCase?.company ?? '草稿'}.doc`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const printDocument = () => {
    const printWindow = window.open('', '_blank', 'width=900,height=720');
    if (!printWindow) {
      notify('浏览器阻止了打印窗口，请允许弹窗后重试。', 'error');
      return;
    }
    printWindow.document.open();
    printWindow.document.write(documentShell(markup, true));
    printWindow.document.close();
    printWindow.focus();
    window.setTimeout(() => printWindow.print(), 250);
  };

  if (!activeCase) {
    return (
      <section className="panel empty-panel standalone-empty">
        <FileText size={30} /><h1>先创建一个案件</h1><p>文书草稿会自动带入当前案件的单位与事实摘要。</p>
        <button className="button button-primary" onClick={() => navigate('cases')}><Plus size={17} />创建案件</button>
      </section>
    );
  }

  return (
    <div className="view-stack">
      <section className="page-heading-row">
        <div>
          <span className="eyebrow">DOCUMENT STUDIO</span>
          <h1>文书工作台</h1>
          <p>先保存可编辑草稿，再导出 Word 或使用浏览器“打印 / 存为 PDF”。</p>
        </div>
        <label className="case-switcher">
          <span>当前案件</span>
          <select value={activeCase.id} onChange={(event) => setActiveCaseId(event.target.value)}>
            {data.cases.map((item) => <option key={item.id} value={item.id}>{item.company} · {item.type}</option>)}
          </select>
        </label>
      </section>

      <section className="template-picker" aria-label="文书模板">
        {templates.map((item) => {
          const Icon = item.icon;
          const hasDraft = data.documents.some((entry) => entry.caseId === activeCase.id && entry.type === item.id);
          return (
            <button key={item.id} className={item.id === templateId ? 'active' : ''} onClick={() => setTemplateId(item.id)}>
              <span><Icon size={20} /></span>
              <div><strong>{item.title}</strong><small>{item.description}</small></div>
              {hasDraft && <i title="已有草稿"><Check size={13} /></i>}
            </button>
          );
        })}
      </section>

      <div className="document-workspace">
        <section className="panel document-editor">
          <div className="section-heading">
            <div><span className="eyebrow">编辑草稿</span><h2>{template.title}</h2></div>
            <span className={`save-state ${saved ? 'saved' : ''}`}>{saved ? <><Check size={14} />已保存</> : '尚未保存'}</span>
          </div>
          <div className="document-form">
            {template.fields.map((field) => (
              <label className={`field ${field.multiline ? 'field-wide' : ''}`} key={field.key}>
                <span>{field.label}</span>
                {field.multiline ? (
                  <textarea rows={field.key === 'facts' || field.key === 'events' ? 7 : 4} value={fields[field.key] ?? ''} onChange={(event) => update(field.key, event.target.value)} placeholder={field.placeholder} />
                ) : (
                  <input value={fields[field.key] ?? ''} onChange={(event) => update(field.key, event.target.value)} placeholder={field.placeholder} />
                )}
              </label>
            ))}
          </div>
          <div className="editor-actions">
            <button className="button button-primary" disabled={saving} onClick={() => void save()}><Save size={17} />{saving ? '正在保存…' : '保存草稿'}</button>
            <button className="button button-secondary" onClick={downloadWord}><Download size={17} />导出 Word</button>
            <button className="button button-secondary" onClick={printDocument}><Printer size={17} />打印 / 存为 PDF</button>
          </div>
          <div className="review-note"><Info size={17} /><span>提交前请逐项核对主体名称、金额、日期、仲裁请求和证据目录；系统不会替你确认法律主张是否适合个案。</span></div>
        </section>

        <aside className="panel document-preview">
          <div className="preview-bar"><span>页面预览</span><small>A4 · 草稿</small></div>
          <div className="paper-preview" dangerouslySetInnerHTML={{ __html: markup }} />
        </aside>
      </div>
    </div>
  );
}

function buildDefaults(type: string, item: WorkCase, displayName: string): Record<string, string> {
  const common = { contact: '', applicantName: displayName, sender: displayName, worker: displayName };
  if (type === 'arbitration-application') return {
    ...common,
    respondent: item.company,
    respondentAddress: item.location,
    requests: item.amount ? `1. 请求支付相关款项人民币 ${item.amount.toLocaleString('zh-CN')} 元；` : '',
    facts: item.description,
    evidenceList: '',
  };
  if (type === 'wage-demand-letter') return {
    ...common,
    recipient: item.company,
    amount: item.amount ? `人民币 ${item.amount.toLocaleString('zh-CN')} 元` : '',
    dueDate: item.deadline ?? '',
    facts: item.description,
    paymentMethod: '',
  };
  if (type === 'injury-material-checklist') return {
    ...common,
    employer: item.company,
    injuryDate: '',
    injuryPlace: item.location,
    injuryFacts: item.description,
    medicalInstitution: '',
    materials: '□ 劳动关系证明\n□ 医疗诊断材料\n□ 事故经过说明\n□ 身份证明\n□ 其他补充材料',
  };
  return {
    title: `${item.company} · ${item.type}事实时间线`,
    participants: '',
    events: item.description,
    gaps: '',
    notes: '',
  };
}

function buildDocumentMarkup(template: Template, fields: Record<string, string>, item: WorkCase): string {
  const rows = template.fields.map((field) => {
    const value = escapeHtml(fields[field.key] || '（待补充）').replace(/\n/g, '<br>');
    return `<section class="doc-section"><h3>${escapeHtml(field.label)}</h3><p>${value}</p></section>`;
  }).join('');
  return `<article class="generated-document"><p class="draft-mark">核对稿</p><h1>${escapeHtml(template.title)}</h1><p class="doc-case">关联案件：${escapeHtml(item.company)} · ${escapeHtml(item.type)}</p>${rows}<footer><p>填写日期：${new Intl.DateTimeFormat('zh-CN', { dateStyle: 'long' }).format(new Date())}</p><p>请在提交前核对全部内容并签字。</p></footer></article>`;
}

function documentShell(markup: string, autoPrint = false): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>安薪乐业文书草稿</title><style>
  @page{size:A4;margin:22mm}body{font-family:"PingFang SC","Microsoft YaHei",sans-serif;color:#172b43;line-height:1.75;margin:0}.generated-document{max-width:720px;margin:0 auto;position:relative}.draft-mark{position:absolute;right:0;top:0;border:1px solid #d36c42;color:#b7512b;padding:2px 10px;border-radius:99px;font-size:12px}.generated-document>h1{text-align:center;font-size:24px;margin:0 0 10px}.doc-case{text-align:center;color:#66778a;font-size:13px;margin-bottom:34px}.doc-section{margin:0 0 22px}.doc-section h3{font-size:14px;margin:0 0 7px}.doc-section p{white-space:normal;margin:0;border-bottom:1px solid #d9dee4;min-height:32px;padding-bottom:8px}.generated-document footer{margin-top:48px;text-align:right;font-size:12px;color:#69798a}
  </style></head><body>${markup}${autoPrint ? '<script>window.onload=function(){document.title="安薪乐业文书草稿"}<\/script>' : ''}</body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' })[char] ?? char);
}
