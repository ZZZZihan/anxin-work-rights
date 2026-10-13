'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArrowRight,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  MapPin,
  Pencil,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { statusForStep } from '@/lib/validation';
import { apiRequest, daysUntil, formatDate, formatMoney } from '@/lib/client';
import type { WorkCase } from '@/lib/types';
import type { SharedViewProps } from '../types';

const steps = ['整理事实', '固定证据', '沟通协商', '申请仲裁', '完成归档'];
const caseTypes = ['欠薪争议', '解除劳动合同', '加班工资', '工伤认定', '社保争议', '其他劳动争议'];
const statusLabels: Record<WorkCase['status'], string> = {
  collecting: '整理材料',
  negotiating: '沟通协商',
  arbitration: '仲裁准备',
  completed: '已完成',
  archived: '已归档',
};

export default function Cases({
  data,
  setData,
  activeCaseId,
  setActiveCaseId,
  navigate,
  notify,
}: SharedViewProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState<WorkCase | null | 'new'>(null);
  const [savingStep, setSavingStep] = useState(false);
  const [savingArchive, setSavingArchive] = useState(false);
  const archivePending = useRef(false);

  const filtered = useMemo(() => (filter === 'archived' ? data.archivedCases : data.cases).filter((item) => {
    const matchesQuery = `${item.company}${item.type}${item.location}`.toLowerCase().includes(query.toLowerCase());
    const matchesFilter = filter === 'all' || item.status === filter;
    return matchesQuery && matchesFilter;
  }), [data.cases, data.archivedCases, query, filter]);

  const activeCase = filtered.find((item) => item.id === activeCaseId) ?? filtered[0];
  useEffect(() => {
    const visibleId = activeCase?.id ?? '';
    if (visibleId !== activeCaseId) setActiveCaseId(visibleId);
  }, [activeCase?.id, activeCaseId, setActiveCaseId]);

  const updateCase = (nextCase: WorkCase) => {
    setData((current) => current ? {
      ...current,
      cases: current.cases.map((item) => item.id === nextCase.id ? nextCase : item),
    } : current);
  };

  const advanceStep = async () => {
    if (!activeCase || archivePending.current || activeCase.status === 'archived' || activeCase.currentStep >= steps.length - 1) return;
    setSavingStep(true);
    const nextStep = activeCase.currentStep + 1;
    const nextStatus = statusForStep(nextStep);
    try {
      const result = await apiRequest<{ case: WorkCase }>('/api/cases', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: activeCase.id,
          currentStep: nextStep,
          status: nextStatus,
          nextAction: nextStep >= 4 ? '核对结果并归档材料' : steps[nextStep],
        }),
      });
      updateCase(result.case);
      notify(nextStep >= 4 ? '案件已标记完成。' : `已进入“${steps[nextStep]}”阶段。`);
    } catch (error) {
      notify(error instanceof Error ? error.message : '更新失败。', 'error');
    } finally {
      setSavingStep(false);
    }
  };

  const archiveCase = async () => {
    if (!activeCase || archivePending.current || activeCase.status === 'archived' || !window.confirm(`确认归档“${activeCase.company}”案件？记录仍保存在后台。`)) return;
    archivePending.current = true;
    setSavingArchive(true);
    try {
      const result = await apiRequest<{ case: WorkCase }>('/api/cases', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: activeCase.id, status: 'archived' }),
      });
      setData((current) => current ? {
        ...current,
        cases: current.cases.filter((item) => item.id !== activeCase.id),
        archivedCases: [result.case, ...current.archivedCases.filter((item) => item.id !== result.case.id)],
      } : current);
      const next = filtered.find((item) => item.id !== activeCase.id);
      setActiveCaseId(next?.id ?? '');
      notify('案件已归档。');
    } catch (error) {
      notify(error instanceof Error ? error.message : '归档失败。', 'error');
    } finally {
      archivePending.current = false;
      setSavingArchive(false);
    }
  };

  const restoreCase = async () => {
    if (!activeCase || archivePending.current || activeCase.status !== 'archived') return;
    archivePending.current = true;
    setSavingArchive(true);
    try {
      const result = await apiRequest<{ case: WorkCase }>('/api/cases', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: activeCase.id, status: statusForStep(activeCase.currentStep) }),
      });
      setData((current) => current ? {
        ...current,
        cases: [result.case, ...current.cases.filter((item) => item.id !== result.case.id)],
        archivedCases: current.archivedCases.filter((item) => item.id !== result.case.id),
      } : current);
      setActiveCaseId(result.case.id);
      setFilter('all'); notify('案件已恢复。');
    } catch (error) { notify(error instanceof Error ? error.message : '恢复失败。', 'error'); }
    finally { archivePending.current = false; setSavingArchive(false); }
  };

  return (
    <div className="view-stack workspace-view cases-view">
      <section className="page-heading-row">
        <div className="workspace-heading-copy">
          <span className="workspace-page-icon tone-blue" aria-hidden="true"><BriefcaseBusiness size={25} /></span>
          <div>
            <h1>案件追踪</h1>
            <p>每个案件只有一个明确的下一步，材料和记录都围绕它展开。</p>
          </div>
        </div>
        <button className="button button-primary" onClick={() => setEditing('new')}>
          <Plus size={18} />新建案件
        </button>
      </section>

      <div className="case-workspace">
        <section className="case-list-panel panel" aria-label="案件列表">
          <div className="case-list-tools">
            <label className="search-field">
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">搜索案件</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索单位、类型或城市" />
            </label>
            <label className="select-compact">
              <span className="sr-only">按状态筛选</span>
              <select value={filter} onChange={(event) => setFilter(event.target.value)}>
                <option value="all">全部状态</option>
                <option value="collecting">整理材料</option>
                <option value="negotiating">沟通协商</option>
                <option value="arbitration">仲裁准备</option>
                <option value="completed">已完成</option>
                <option value="archived">已归档</option>
              </select>
            </label>
          </div>
          <div className="case-card-list">
            {filtered.map((item) => {
              const days = daysUntil(item.deadline);
              return (
                <button
                  key={item.id}
                  className={`case-list-card ${item.id === activeCase?.id ? 'active' : ''}`}
                  aria-pressed={item.id === activeCase?.id}
                  onClick={() => setActiveCaseId(item.id)}
                >
                  <span className="case-list-card-top">
                    <span className={`status-dot ${item.status}`} />
                    <span className="status-label">{statusLabels[item.status]}</span>
                    {days !== null && days >= 0 && days <= 7 && <span className="deadline-chip">{days === 0 ? '今天' : `${days} 天`}</span>}
                  </span>
                  <strong>{item.company}</strong>
                  <span>{item.type}</span>
                  <span className="case-list-card-bottom">
                    <small>{item.amount ? formatMoney(item.amount) : '金额待核'}</small>
                    <small>{formatDate(item.deadline)}</small>
                  </span>
                  <ChevronRight size={17} className="case-card-chevron" />
                </button>
              );
            })}
            {!filtered.length && (
              <div className="inline-empty"><Search size={24} /><strong>没有匹配的案件</strong><span>试试其他关键词或状态。</span></div>
            )}
          </div>
        </section>

        {activeCase ? (
          <section className="case-detail panel" aria-label="案件详情">
            <div className="case-detail-header">
              <div>
                <span className={`status-pill ${activeCase.status}`}>{statusLabels[activeCase.status]}</span>
                <h2>{activeCase.company}</h2>
                <p>{activeCase.type} · 建档于 {formatDate(activeCase.createdAt, true)}</p>
              </div>
              <div className="icon-actions">
                <button className="icon-button" aria-label="编辑案件" disabled={savingStep || savingArchive || activeCase.status === 'archived'} onClick={() => setEditing(activeCase)}><Pencil size={17} /></button>
                <button className="icon-button" aria-label={activeCase.status === 'archived' ? '恢复案件' : '归档案件'} disabled={savingStep || savingArchive} onClick={activeCase.status === 'archived' ? restoreCase : archiveCase}><Archive size={17} /></button>
              </div>
            </div>

            <div className="case-facts-grid">
              <div className="tone-mint"><span><CircleDollarSign size={16} />争议金额</span><strong>{activeCase.amount ? formatMoney(activeCase.amount) : '待核算'}</strong></div>
              <div className="tone-apricot"><span><CalendarDays size={16} />目标日期</span><strong>{formatDate(activeCase.deadline, true)}</strong></div>
              <div className="tone-violet"><span><MapPin size={16} />发生地</span><strong>{activeCase.location || '待补充'}</strong></div>
            </div>

            <div className="case-progress-block">
              <div className="section-heading compact">
                <div><span className="eyebrow">行动路径</span><h3>当前进度</h3></div>
                <span className="step-counter">{Math.min(activeCase.currentStep + 1, steps.length)} / {steps.length}</span>
              </div>
              <ol className="progress-steps">
                {steps.map((step, index) => (
                  <li key={step} className={index < activeCase.currentStep ? 'done' : index === activeCase.currentStep ? 'current' : ''}>
                    <span>{index < activeCase.currentStep ? <Check size={15} /> : index + 1}</span>
                    <small>{step}</small>
                  </li>
                ))}
              </ol>
            </div>

            <div className="next-action-card">
              <span className="next-action-icon"><ClipboardList size={21} /></span>
              <div><span>下一步行动</span><strong>{activeCase.nextAction}</strong></div>
              {activeCase.status !== 'completed' && activeCase.status !== 'archived' && (
                <button className="button button-primary button-small" disabled={savingStep || savingArchive} onClick={advanceStep}>
                  {savingStep ? '正在更新…' : '完成本步'} <ArrowRight size={16} />
                </button>
              )}
            </div>

            <div className="case-description">
              <span className="eyebrow">事实摘要</span>
              <p>{activeCase.description || '还没有填写事实摘要。编辑案件后补充关键时间、人物和发生经过。'}</p>
            </div>

            <div className="case-detail-actions" hidden={activeCase.status === 'archived'}>
              <button className="button button-secondary tone-blue" onClick={() => navigate('evidence')}>查看证据 <ArrowRight size={16} /></button>
              <button className="button button-secondary tone-violet" onClick={() => navigate('chat')}>继续梳理 <ArrowRight size={16} /></button>
              <button className="button button-secondary tone-mint" onClick={() => navigate('documents')}>起草文书 <ArrowRight size={16} /></button>
            </div>
          </section>
        ) : (
          <section className="panel empty-panel case-empty">
            <BriefcaseBusiness size={28} />
            <h2>{data.cases.length || data.archivedCases.length ? '没有匹配的案件' : '创建第一个案件'}</h2>
            <p>{data.cases.length || data.archivedCases.length ? '试试其他关键词或状态。' : '填写单位、争议类型和下一步即可开始。'}</p>
            <button className="button button-primary" onClick={() => setEditing('new')}><Plus size={17} />新建案件</button>
          </section>
        )}
      </div>

      {editing && (
        <CaseDialog
          value={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            if (editing === 'new') {
              setQuery('');
              setFilter('all');
            }
            setData((current) => current ? {
              ...current,
              cases: editing === 'new'
                ? [saved, ...current.cases]
                : current.cases.map((item) => item.id === saved.id ? saved : item),
            } : current);
            setActiveCaseId(saved.id);
            setEditing(null);
            notify(editing === 'new' ? '案件已创建。' : '案件信息已更新。');
          }}
          notify={notify}
        />
      )}
    </div>
  );
}

function CaseDialog({
  value,
  onClose,
  onSaved,
  notify,
}: {
  value: WorkCase | null;
  onClose: () => void;
  onSaved: (value: WorkCase) => void;
  notify: SharedViewProps['notify'];
}) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    company: value?.company ?? '',
    type: value?.type ?? '欠薪争议',
    amount: value?.amount ? String(value.amount) : '',
    deadline: value?.deadline ?? '',
    location: value?.location ?? '',
    nextAction: value?.nextAction ?? '补充案件事实与证据',
    description: value?.description ?? '',
  });

  const update = (key: keyof typeof form, next: string) => setForm((current) => ({ ...current, [key]: next }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const result = await apiRequest<{ case: WorkCase }>('/api/cases', {
        method: value ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(value ? { id: value.id } : {}), ...form }),
      });
      onSaved(result.case);
    } catch (error) {
      notify(error instanceof Error ? error.message : '保存失败。', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.currentTarget === event.target && onClose()}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="case-dialog-title">
        <div className="modal-header">
          <div><span className="eyebrow">案件资料</span><h2 id="case-dialog-title">{value ? '编辑案件' : '新建案件'}</h2></div>
          <button className="icon-button" aria-label="关闭" onClick={onClose}><X size={19} /></button>
        </div>
        <form className="form-grid" onSubmit={submit}>
          <label className="field field-span-2"><span>单位名称 *</span><input required value={form.company} onChange={(event) => update('company', event.target.value)} placeholder="例如：某某科技有限公司" /></label>
          <label className="field"><span>争议类型 *</span><select value={form.type} onChange={(event) => update('type', event.target.value)}>{value && !caseTypes.includes(value.type) && <option value={value.type}>{value.type}</option>}{caseTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
          <label className="field"><span>争议金额（元）</span><input inputMode="numeric" min="0" type="number" value={form.amount} onChange={(event) => update('amount', event.target.value)} placeholder="暂不确定可留空" /></label>
          <label className="field"><span>目标日期</span><input type="date" value={form.deadline} onChange={(event) => update('deadline', event.target.value)} /></label>
          <label className="field"><span>城市 / 地区</span><input value={form.location} onChange={(event) => update('location', event.target.value)} placeholder="例如：江苏省南京市" /></label>
          <label className="field field-span-2"><span>下一步行动</span><input value={form.nextAction} onChange={(event) => update('nextAction', event.target.value)} placeholder="一件具体、可完成的事" /></label>
          <label className="field field-span-2"><span>事实摘要</span><textarea rows={5} value={form.description} onChange={(event) => update('description', event.target.value)} placeholder="按时间顺序记录入职、工资约定、争议发生和单位回应…" /></label>
          <div className="modal-footer field-span-2">
            <button type="button" className="button button-secondary" onClick={onClose}>取消</button>
            <button className="button button-primary" disabled={saving}>{saving ? '正在保存…' : value ? '保存修改' : '创建案件'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
