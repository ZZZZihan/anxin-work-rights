'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Calculator, Check, Info, LoaderCircle, RefreshCw, ScanText, Undo2 } from 'lucide-react';
import type { AmountField, Assertion, CandidateKind, FactAction, FactScope, MaterialFactsResponse, Qualifier } from '@/lib/material-fact-types';
import { getCandidateRepresentation, isV2Candidate, isV3Candidate } from '@/lib/material-facts-v3';
import { getReviewedExtractionCoverage } from '@/lib/material-fact-coverage-review';
import './MaterialFactsPanel.css';

const kinds: Record<CandidateKind, string> = { worker: '劳动者', employer: '用人单位', period: '期间', monthly_rate: '月工资标准', due_total: '应付总额候选', paid_total: '已付总额候选', arrears: '欠款表述', award: '裁判 / 命令支付', payment: '单笔付款', other_amount: '其他金额' };
const assertions: Record<Assertion, string> = { claimed: '一方主张', admitted: '原文明示承认', decided: '裁判认定 / 命令', narrated: '文书叙述', unknown: '身份未明确' };
const qualifiers: Record<Qualifier, string> = { wage_period: '工资期间', employment_period: '任职期间', contract_period: '合同期间', other_period: '其他期间', gross: '税前', net: '实发 / 税后', partial: '部分金额', unknown: '口径未明' };
const emptyScope: FactScope = { worker: '', employer: '', start: '', end: '' };
const emptyAmount = () => ({ amount: '', note: '', complete: false, verified: false });
const meanings: Record<string, string> = { due_total: '应付总额表述', paid_total: '已付总额表述', payment: '单笔 / 部分支付', arrears: '欠付表述', award: '裁判 / 命令支付', rate: '工资计价标准', other_money: '其他金额', employment_period: '实际工作期间', wage_period: '工资所属期间', contract_signing: '合同签订时间', contract_performance: '约定履行期间', payment_date: '付款时间', other_date: '其他日期' };
const scopes: Record<string, string> = { individual: '个人', group: '班组 / 多人合计', organization: '单位', unknown: '归属未明' };
const completeness: Record<string, string> = { complete: '原文表述为累计完整，仍待核实', partial: '单笔或部分，不能代替完整总额', unknown: '完整性未明', not_applicable: '此类别不判断工资总额完整性' };
const rateUnits: Record<string, string> = { month: '每月', day: '每天', hour: '每小时', piece: '每件', unknown: '计价单位未明' };
const isOlder = (body: MaterialFactsResponse | null, latest: MaterialFactsResponse | null) => !!body && !!latest
  && (body.generation < latest.generation || (body.generation === latest.generation && body.revision < latest.revision));
type Props = { caseId: string; evidenceVersion: string; onOpenSource: (id: string) => void; notify: (message: string, tone?: 'success' | 'error') => void };

export default function MaterialFactsPanel({ caseId, evidenceVersion, onOpenSource, notify }: Props) {
  const [data, setData] = useState<MaterialFactsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [draftNotice, setDraftNotice] = useState('');
  const [scope, setScope] = useState<FactScope>(emptyScope);
  const [scopeNote, setScopeNote] = useState('');
  const [scopeVerified, setScopeVerified] = useState(false);
  const [amounts, setAmounts] = useState({ due: emptyAmount(), paid: emptyAmount() });
  const [reviewed, setReviewed] = useState<Record<string, boolean>>({});
  const [exclusions, setExclusions] = useState<Record<string, string>>({});
  const dataRef = useRef<MaterialFactsResponse | null>(null);
  const alive = useRef(true);
  const requestSequence = useRef(0);
  const dirty = useRef(false);
  const scopeDirty = useRef(false);

  const accept = useCallback((body: MaterialFactsResponse, fromMutation = false) => {
    const previous = dataRef.current;
    // A completed POST may arrive after a newer material refresh. Never restore
    // an invalidated calculation or clear a draft using an older response.
    if (isOlder(body, previous)) return false;
    if (previous && (body.generation !== previous.generation || JSON.stringify(body.state.scope) !== JSON.stringify(previous.state.scope) || (!fromMutation && dirty.current && body.revision !== previous.revision))) {
      setScopeVerified(false);
      setReviewed({});
      setAmounts((current) => ({ due: { ...current.due, complete: false, verified: false }, paid: { ...current.paid, complete: false, verified: false } }));
      if (dirty.current) setDraftNotice('材料或核算范围已变化。输入草稿仍保留，请重新核对候选和完整性后保存。');
    }
    if (!previous || !scopeDirty.current) {
      setScope(body.state.scope ?? emptyScope);
      if (previous && JSON.stringify(body.state.scope) !== JSON.stringify(previous.state.scope)) setScopeNote('');
    }
    dataRef.current = body;
    setData(body);
    return true;
  }, []);

  const request = useCallback(async (init?: RequestInit): Promise<MaterialFactsResponse> => {
    const result = await fetch(`/api/cases/${encodeURIComponent(caseId)}/facts`, { cache: 'no-store', ...init });
    const body = await result.json() as MaterialFactsResponse & { error?: string };
    if (!result.ok) throw Object.assign(new Error(body.error || '事实确认暂未完成。'), { status: result.status });
    return body as MaterialFactsResponse;
  }, [caseId]);

  const reload = useCallback(async (manual = false) => {
    const sequence = ++requestSequence.current;
    const startedFrom = dataRef.current;
    if (manual || !dataRef.current) setLoading(true);
    try {
      const body = await request();
      if (!alive.current || sequence !== requestSequence.current) return;
      if (!accept(body)) return;
      setError('');
      if (manual) {
        setConflict(false);
        setScopeVerified(false);
        setReviewed({});
        setAmounts((current) => ({ due: { ...current.due, complete: false, verified: false }, paid: { ...current.paid, complete: false, verified: false } }));
        if (dirty.current) setDraftNotice('已读取最新版本。输入草稿仍保留，请根据当前材料重新勾选核对后保存。');
      }
    } catch (failure) {
      if (!alive.current || sequence !== requestSequence.current) return;
      if (isOlder(startedFrom, dataRef.current)) return;
      if ((failure as Error & { status?: number }).status === 409) setConflict(true);
      setError(failure instanceof Error ? failure.message : '读取事实确认状态失败。');
    } finally { if (alive.current && sequence === requestSequence.current) setLoading(false); }
  }, [accept, request]);

  useEffect(() => {
    alive.current = true;
    requestSequence.current++;
    const timer = window.setTimeout(() => { void reload(); }, 0);
    return () => { alive.current = false; window.clearTimeout(timer); };
  }, [reload, evidenceVersion]);

  const running = data?.state.job?.status === 'running';
  const hasData = data !== null;
  useEffect(() => {
    if (!hasData || conflict || saving) return;
    let cancelled = false;
    let timer: number;
    const tick = async () => {
      await reload();
      if (!cancelled) timer = window.setTimeout(() => { void tick(); }, running ? 1800 : 8000);
    };
    timer = window.setTimeout(() => { void tick(); }, running ? 1800 : 8000);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [hasData, running, conflict, saving, reload]);

  const submit = async (action: FactAction) => {
    const current = dataRef.current;
    if (!current || saving || loading || conflict) return;
    requestSequence.current++;
    setSaving(true);
    setError('');
    try {
      const result = await request({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...action, revision: current.revision, generation: current.generation }) });
      if (!alive.current) return;
      if (!accept(result, true)) return;
      if (action.action === 'confirm_scope') { scopeDirty.current = false; setScope(result.state.scope ?? emptyScope); setScopeNote(''); setScopeVerified(false); setReviewed({}); setAmounts((values) => ({ due: { ...values.due, complete: false, verified: false }, paid: { ...values.paid, complete: false, verified: false } })); }
      if (action.action === 'confirm_amount') setAmounts((values) => ({ ...values, [action.field]: emptyAmount() }));
      if (action.action === 'extract' || action.action === 'exclude_source' || action.action === 'revoke') { setReviewed({}); setScopeVerified(false); setAmounts((values) => ({ due: { ...values.due, complete: false, verified: false }, paid: { ...values.paid, complete: false, verified: false } })); }
      if (action.action === 'extract' && result.state.job?.status === 'failed') notify('候选提取未开始；旧金额确认已失效，请恢复服务后重试。', 'error');
      else notify(action.action === 'calculate' ? '已按当前确认记录生成计算结果。' : action.action === 'extract' ? '已提交候选提取请求，结果会自动更新。' : '事实操作已保存。');
    } catch (failure) {
      if (!alive.current) return;
      if (isOlder(current, dataRef.current)) return;
      if ((failure as Error & { status?: number }).status === 409) {
        setConflict(true);
        setError('材料或确认记录已更新。当前输入尚未保存且仍保留，请重新加载最新版本，再根据当前材料核对。');
      } else setError(failure instanceof Error ? failure.message : '保存失败，当前输入仍保留。');
    } finally { if (alive.current) setSaving(false); }
  };

  const updateAmount = (field: AmountField, patch: Partial<ReturnType<typeof emptyAmount>>) => {
    dirty.current = true;
    setAmounts((current) => ({ ...current, [field]: { ...current[field], ...patch } }));
  };
  const disabled = saving || loading || conflict;
  const allReviewed = data?.candidates.every((candidate) => reviewed[candidate.id]) ?? false;

  return (
    <section className="panel material-facts-panel" aria-label="材料到事实确认">
      <div className="section-heading"><div><span className="eyebrow">材料 → 候选 → 用户确认</span><h2>核对本期工资事实</h2></div><button className="button button-secondary" disabled={saving || loading} onClick={() => void reload(true)}><RefreshCw size={16} />重新读取状态</button></div>
      <p className="material-help">先逐份提取并阅读材料候选，再明确本次核算的劳动者、单位和工资期间。金额必须由你核实并输入；原文核对勾选与本处的总额确认分别保存。</p>
      {loading && <p className="material-progress" role="status"><LoaderCircle size={18} />正在读取事实确认状态…</p>}
      {error && <div className="material-error" role="alert"><p>{error}</p>{conflict && <strong>保存已暂停；重新读取后可继续核对，输入草稿仍在本页。</strong>}</div>}
      {draftNotice && <p className="material-notice" role="status">{draftNotice}</p>}
      {data && <>
        <div className="material-result-meta"><span>候选提取：{data.backend}</span><span>材料版本 {data.generation} · 确认版本 {data.revision}</span><span>候选均待用户判断</span></div>
        {data.backend === 'deepseek' && <p className="material-notice">当前由维护者配置为 DeepSeek：提取候选会向 DeepSeek 官方 API 发送材料文字。请仅处理已获授权发送的材料。</p>}
        {!data.configured && <div className="material-notice"><Info size={18} /><p>候选提取服务暂不可用。已保存材料和确认仍可查看；恢复服务后可重试提取。</p></div>}
        {running && <p className="material-progress" role="status"><LoaderCircle size={18} />{data.state.job?.error ?? '正在提取材料候选，尚未形成事实确认…'}</p>}
        {data.state.job?.status === 'failed' && <div className="material-error" role="alert"><strong>候选提取未完成</strong><p>{data.state.job.error}</p><p>请在对应材料处重新提取。失败结果不会变成确认金额。</p>{data.state.job.raw !== undefined && <details className="fact-raw"><summary>查看未通过协议校验的原始回答</summary><p>{data.state.job.backend ?? '处理方式未确认'}{data.state.job.model ? ` · ${data.state.job.model}` : ''}</p><pre>{data.state.job.raw}</pre></details>}</div>}

        <div className="fact-sources">
          <h3>1. 逐份处理材料并阅读候选</h3>
          {!data.sources.length && <p className="material-help">请先上传本次核算所需材料。没有材料时不能生成计算结果。</p>}
          {data.sources.map((source) => {
            const material = data.state.materials.find((item) => item.evidenceId === source.id);
            const candidates = data.candidates.filter((item) => item.evidenceId === source.id);
            const coverage = material?.status === 'extracted' ? getReviewedExtractionCoverage(material) : null;
            const legacyEmpty = material?.status === 'extracted' && !coverage && candidates.length === 0;
            const extractionLabel = legacyEmpty ? '旧版提取无可用候选 · 需核对原文' : coverage?.status === 'empty' ? '未提取到候选 · 需核对原文' : coverage?.status === 'none_accepted' ? '候选均未通过核验 · 需核对原文' : coverage?.status === 'possible_missing' ? `${candidates.length} 条候选 · 可能有遗漏` : `${candidates.length} 条候选 · 待核对`;
            return <article className="fact-source-card" key={source.id}>
              <div className="fact-source-heading"><div><strong>{source.name}</strong><span>{material?.status === 'excluded' ? '已说明与本次核算无关' : material?.status === 'extracted' ? extractionLabel : source.ready ? '原文已识别 · 待提取候选' : '原文尚未就绪'}</span></div><button className="material-text-button" onClick={() => onOpenSource(source.id)}>识别 / 对照原文</button></div>
              <p className="fact-source-meta">原文件 SHA-256：<code>{source.sha256 ? source.sha256.slice(0, 16) : '上传尚未完成'}</code> · 原文版本 {source.analysisRevision}</p>
              {coverage && coverage.status !== 'no_signal' && <div className="fact-conflict-note" role="status"><strong>{coverage.status === 'empty' ? '提取结果为空' : coverage.status === 'none_accepted' ? '候选暂不可用' : '请检查可能遗漏的信息'}</strong><p>{coverage.message}</p><p>请对照原文补充核实，必要时重新提取。提示不会补写事实或确认金额。</p>{coverage.signals.some(signal => !signal.covered) && <details><summary>查看待核对的原文线索</summary><ul>{coverage.signals.filter(signal => !signal.covered).slice(0, 12).map((signal, index) => <li key={`${signal.blockId}-${signal.start}-${index}`}>{signal.text}</li>)}</ul></details>}</div>}
              {legacyEmpty && <div className="fact-conflict-note" role="status"><strong>旧版结果没有可用候选</strong><p>这不能证明材料中没有工资事实。请对照原文核实并重新提取；旧记录保持原样，未补写或确认金额。</p></div>}
              {material?.status === 'excluded' && <p className="fact-exclusion"><strong>排除依据：</strong>{material.exclusionReason}</p>}
              {candidates.map((candidate) => { const representation = getCandidateRepresentation(candidate); return <div className="fact-candidate" key={candidate.id}>
                <div className="fact-candidate-heading"><strong>{representation ? meanings[representation.meaning] : kinds[candidate.kind]}：{candidate.value}</strong><span>{assertions[candidate.assertion]}{!representation && ` · ${qualifiers[candidate.qualifier]}`}</span></div>
                {representation ? <>
                  <p><strong>{scopes[representation.scope]}</strong>：{representation.subject ?? '原文未明确对应对象'}{representation.kind === 'money' ? ` · 工资归属期间：${representation.period ?? '未明确，不推断'}` : ' · 该日期对应的劳动者或受益群体'}</p>
                  <p>{completeness[representation.completeness]}{representation.rateUnit ? ` · ${rateUnits[representation.rateUnit]}` : ''}</p>
                  {representation.scope === 'group' && <p className="fact-conflict-note">这是群体范围的表述，不能将全部金额归给班组代表或某一个人。</p>}
                  {representation.meaning === 'contract_signing' && <p className="material-help">签约时间不证明实际工作或工资所属期间。</p>}
                </> : <p>旧版候选：对象 {candidate.subject ?? '未明确'} · 期间 {candidate.period ?? '未明确'}。尚未区分个人与群体、完整与部分；请重新提取或对照原文核实。</p>}
                {(isV3Candidate(candidate) || isV2Candidate(candidate)) && candidate.reviewIssues.length > 0 && <div className="fact-conflict-note"><strong>需要进一步核对</strong><ul>{candidate.reviewIssues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}</ul></div>}
                {isV3Candidate(candidate) && representation?.kind === 'money' && <p className={candidate.normalization.status === 'exact' ? 'material-help' : 'fact-conflict-note'}>{candidate.normalization.status === 'exact' ? `原文金额片段：${candidate.normalization.matchedText}；规范金额：${candidate.normalization.amount} 元，仍待核实。` : `未生成精确金额：${candidate.normalization.reason.replaceAll('value', '候选金额')}。原文已保留，不按 0 元处理。`}</p>}
                <blockquote>{candidate.quote}</blockquote>
                <p className="fact-source-meta">第 {candidate.page} 页 · 原文块 {candidate.blockId} · 字符位置 {candidate.start}–{candidate.end}{candidate.amount ? ` · 金额规范值 ${candidate.amount} 元` : ''}</p>
                <label className="fact-check"><input type="checkbox" checked={reviewed[candidate.id] ?? false} disabled={disabled} onChange={(event) => { dirty.current = true; setReviewed((current) => ({ ...current, [candidate.id]: event.target.checked })); }} />我已阅读这条候选及其原文，理解其金额类型、主张身份与所属范围</label>
              </div>; })}

              {Boolean(material?.rejected.length) && <details className="fact-rejected"><summary>{material!.rejected.length} 条候选未通过校验</summary><ul>{material!.rejected.map((item) => <li key={item.index}>第 {item.index + 1} 条：{item.reason}</li>)}</ul></details>}
              {material?.raw !== null && material?.raw !== undefined && <details className="fact-raw"><summary>查看本次提取的原始回答</summary><p>处理方式：{material.backend}{material.model ? ` · ${material.model}` : ''}。字面校验通过仅说明引用位置可对照，仍需判断语义与材料真实性。</p><pre>{material.raw}</pre></details>}
              <div className="fact-source-actions"><button className="button button-secondary" disabled={disabled || running || !source.ready || !data.configured} onClick={() => void submit({ action: 'extract', evidenceId: source.id })}><ScanText size={16} />{material ? '重新提取候选' : '提取候选'}</button></div>
              {material?.status !== 'excluded' && <div className="fact-exclude-form"><label className="field"><span>若此材料与本次工资核算无关，请说明依据</span><input value={exclusions[source.id] ?? ''} maxLength={500} placeholder="例如：属于另一劳动者或另一工资期间，并已核对原文" disabled={disabled || running} onChange={(event) => { dirty.current = true; setExclusions((current) => ({ ...current, [source.id]: event.target.value })); }} /></label><button className="button button-secondary" disabled={disabled || running || !(exclusions[source.id] ?? '').trim()} onClick={() => void submit({ action: 'exclude_source', evidenceId: source.id, reason: exclusions[source.id] ?? '' })}>确认与本次核算无关</button></div>}
            </article>;
          })}
        </div>

        <section className="fact-scope" aria-label="核算范围确认">
          <div className="fact-section-heading"><h3>2. 明确本次工资核算范围</h3>{data.state.scope && <button className="material-text-button" disabled={disabled || running} onClick={() => void submit({ action: 'revoke', field: 'scope' })}><Undo2 size={14} />撤回范围确认</button>}</div>
          {data.state.scope && <p className="fact-confirmation">已确认：{data.state.scope.worker} · {data.state.scope.employer} · {data.state.scope.start} 至 {data.state.scope.end}</p>}
          {data.state.scopeReview && <p className="fact-confirmation">范围核实依据：{data.state.scopeReview.note}<br />确认时间：{data.state.scopeReview.at}</p>}
          <form onSubmit={(event) => { event.preventDefault(); void submit({ action: 'confirm_scope', scope, note: scopeNote, verified: true }); }}>
            <div className="fact-scope-fields">{(['worker', 'employer', 'start', 'end'] as const).map((key) => <label className="field" key={key}><span>{{ worker: '劳动者全名', employer: '用人单位全名', start: '工资期间开始', end: '工资期间结束' }[key]}</span><input type={key === 'start' || key === 'end' ? 'date' : 'text'} value={scope[key]} required maxLength={200} disabled={disabled || running} onChange={(event) => { dirty.current = true; scopeDirty.current = true; setScopeVerified(false); setScope((current) => ({ ...current, [key]: event.target.value })); }} /></label>)}</div>
            <label className="field"><span>范围核实依据 / 冲突处理说明</span><textarea value={scopeNote} maxLength={500} required rows={2} disabled={disabled || running} onChange={(event) => { dirty.current = true; scopeDirty.current = true; setScopeNote(event.target.value); }} placeholder="说明如何核实主体与工资期间；文书有多个主体或期间时请说明取舍" /></label>
            <label className="fact-check"><input type="checkbox" checked={scopeVerified} disabled={disabled || running} onChange={(event) => setScopeVerified(event.target.checked)} />我已核实劳动者、用人单位与工资期间；任职或合同期间已单独辨认</label>
            <button className="button button-primary" disabled={disabled || running || !scopeVerified} type="submit"><Check size={16} />确认核算范围</button>
          </form>
        </section>

        <section className="fact-amounts" aria-label="完整金额确认">
          <h3>3. 核实并输入本期完整总额</h3>
          <p className="material-help">班组合计不能当作个人金额；单笔付款、计价标准、欠款主张和裁判支付额不能直接替代完整应付 / 已付总额。请统一税前或实发等金额口径；空白保持未知，明确 0 元时才填写 0。</p>
          <div className="fact-amount-grid">{(['due', 'paid'] as const).map((field) => {
            const view = data.fields[field];
            const draft = amounts[field];
            const hasConflict = view.values.length > 1;
            const title = field === 'due' ? '本期完整应付总额' : '本期完整已付总额';
            return <form className={`fact-amount-card${hasConflict ? ' fact-has-conflict' : ''}`} key={field} onSubmit={(event) => { event.preventDefault(); void submit({ action: 'confirm_amount', field, amount: draft.amount, note: draft.note, reviewedCandidateIds: data.candidates.filter((candidate) => reviewed[candidate.id] && !['worker', 'employer', 'period'].includes(candidate.kind)).map((candidate) => candidate.id), complete: true, verified: true }); }}>
              <div className="fact-section-heading"><h4>{title}</h4><span>{view.status === 'confirmed' ? hasConflict ? '用户已确认 · 原候选有差异' : '用户已确认' : view.status === 'conflict' ? '候选存在冲突' : view.status === 'candidate' ? '存在待核实候选' : '仍未知'}</span></div>
              {view.values.length > 0 && <p className="fact-value-list">候选规范值：{view.values.join(' / ')} 元</p>}
              {hasConflict && <p className="fact-conflict-note">材料中存在不同候选。请逐项核对并说明处理依据；用户确认后仍保留原候选与差异，便于复查。</p>}
              {view.confirmation && <div className="fact-confirmation"><strong>已确认 {view.confirmation.amount} 元</strong><p>核实依据：{view.confirmation.note || '已核对完整性与候选'}</p><p>确认时间：{view.confirmation.at}</p><button type="button" className="material-text-button" disabled={disabled || running} onClick={() => void submit({ action: 'revoke', field })}><Undo2 size={14} />撤回此项确认</button></div>}
              <label className="field"><span>{view.confirmation ? '若需修订，请重新输入完整总额（元）' : `${title}（元）`}</span><input type="text" inputMode="decimal" value={draft.amount} required maxLength={20} placeholder="请核实后输入；未知时留空" disabled={disabled || running} onChange={(event) => updateAmount(field, { amount: event.target.value, verified: false, complete: false })} /></label>
              <label className="field"><span>核实依据、金额口径与冲突处理说明</span><textarea value={draft.note} rows={3} maxLength={500} required placeholder="说明完整总额如何核实、采用何种金额口径，以及如何处理不同材料的冲突" disabled={disabled || running} onChange={(event) => updateAmount(field, { note: event.target.value })} /></label>
              <label className="fact-check"><input type="checkbox" checked={draft.complete} disabled={disabled || running} onChange={(event) => updateAmount(field, { complete: event.target.checked })} />我已核实该金额覆盖已确认工资期间的完整{field === 'due' ? '应付' : '已付'}总额，金额口径一致</label>
              <label className="fact-check"><input type="checkbox" checked={draft.verified} disabled={disabled || running} onChange={(event) => updateAmount(field, { verified: event.target.checked })} />我已逐条阅读上方全部当前候选，并核实本项金额与冲突处理依据</label>
              <button className="button button-primary" type="submit" disabled={disabled || running || !data.state.scope || !allReviewed || !draft.amount.trim() || !draft.complete || !draft.verified}><Check size={16} />确认{field === 'due' ? '应付' : '已付'}总额</button>
            </form>;
          })}</div>
        </section>

        <section className="fact-calculation" aria-label="核算结果">
          <h3>4. 根据用户确认计算差额</h3>
          {data.unresolved.length > 0 && <div className="fact-unresolved"><strong>仍需处理</strong><ul>{data.unresolved.map((reason, index) => <li key={index}>{reason}</li>)}</ul></div>}
          <button className="button button-primary" disabled={disabled || running || !data.canCalculate} onClick={() => void submit({ action: 'calculate' })}><Calculator size={17} />{saving ? '正在保存…' : '按已确认事实计算差额'}</button>
          {data.state.calculation && <div className="fact-calculation-result" role="status"><strong>已确认应付 {data.state.calculation.due} 元 − 已确认已付 {data.state.calculation.paid} 元 = {data.state.calculation.gap} 元</strong><p>仅表示本次确认范围内的算术差额，候选本身不会授予计算权限。</p><p>材料版本 {data.state.calculation.generation} · 回执 {data.state.calculation.receiptId} · {data.state.calculation.at}</p></div>}
        </section>
      </>}
    </section>
  );
}
