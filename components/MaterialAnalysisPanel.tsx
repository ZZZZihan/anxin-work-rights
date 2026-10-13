'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Download, Info, LoaderCircle, RefreshCw, ScanText, X } from 'lucide-react';
import type { EvidenceFile } from '@/lib/types';
import { documentKindLabels, type DocumentKind, type MaterialAnalysis, type MaterialAnalysisResponse, type MaterialBlock, type MaterialField } from '@/lib/material-types';
import type { ToastTone } from './types';
import KnowledgeResults from './KnowledgeResults';

type DraftField = { value: string; confirmed: boolean };
type MaterialAnalysisPanelProps = { evidence: EvidenceFile; onClose: () => void; notify: (message: string, tone?: ToastTone) => void };

function inferDocumentKind(evidence: EvidenceFile): DocumentKind {
  // The selected upload category is a fallback; an informative filename wins.
  if (/聊天|沟通|微信|短信/.test(evidence.name)) return 'chat';
  if (/合同/.test(evidence.name)) return 'contract';
  if (/工资|流水|薪资|收入|转账/.test(evidence.name)) return 'wage_statement';
  if (/劳动关系/.test(evidence.category)) return 'contract';
  if (/工资/.test(evidence.category)) return 'wage_statement';
  if (/沟通/.test(evidence.category)) return 'chat';
  return 'other';
}

function supportsAnalysis(evidence: EvidenceFile): boolean {
  return ['image/png', 'image/jpeg', 'application/pdf', 'text/plain'].includes(evidence.mimeType)
    || /\.(png|jpe?g|pdf|txt)$/i.test(evidence.name);
}

function isImage(evidence: EvidenceFile): boolean {
  return ['image/png', 'image/jpeg'].includes(evidence.mimeType) || /\.(png|jpe?g)$/i.test(evidence.name);
}

function draftsFor(analysis: MaterialAnalysis | null): Record<string, DraftField> {
  return Object.fromEntries((analysis?.result?.fields ?? []).map((field) => [field.id, { value: field.value, confirmed: field.confirmed }]));
}

function boxStyle(block: MaterialBlock) {
  if (!block.bbox || block.bbox.some((value) => !Number.isFinite(value))) return null;
  const [left, top, width, height] = block.bbox;
  if (left < 0 || top < 0 || width <= 0 || height <= 0 || left + width > 1.001 || top + height > 1.001) return null;
  return { left: `${left * 100}%`, top: `${top * 100}%`, width: `${Math.min(width, 1 - left) * 100}%`, height: `${Math.min(height, 1 - top) * 100}%` };
}

function PrivateOriginalImage({ url, name }: { url: string; name: string }) {
  // Same-origin blob previews must bypass remote image optimization.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={`${name} 原图，用于对照识别字段`} />;
}

export default function MaterialAnalysisPanel({ evidence, onClose, notify }: MaterialAnalysisPanelProps) {
  const [analysis, setAnalysis] = useState<MaterialAnalysis | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [requestError, setRequestError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [documentKind, setDocumentKind] = useState<DocumentKind>(() => inferDocumentKind(evidence));
  const [draftFields, setDraftFields] = useState<Record<string, DraftField>>({});
  const [focusedFieldId, setFocusedFieldId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; error: string }>({ url: '', error: '' });
  const aliveRef = useRef(false);
  const requestsRef = useRef(new Set<AbortController>());
  const loadGenerationRef = useRef(0);
  const sourceRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const sourceListRef = useRef<HTMLOListElement>(null);
  const sourceLineRefs = useRef(new Map<string, HTMLLIElement>());
  const endpoint = `/api/evidence/${encodeURIComponent(evidence.id)}/analysis`;
  const downloadUrl = `/api/evidence/${encodeURIComponent(evidence.id)}/download`;
  const supported = supportsAnalysis(evidence);
  const imageEvidence = isImage(evidence);
  const running = analysis?.status === 'running';
  const result = analysis?.status === 'ready' ? analysis.result : null;
  const fields = result?.fields ?? [];
  const focusedField = fields.find((field) => field.id === focusedFieldId);
  const focusedBlocks = result?.blocks.filter((block) => focusedField?.blockIds.includes(block.id)) ?? [];
  const sourcePage = focusedBlocks[0]?.page ?? 1;
  const pageLineCounts = new Map<number, number>();
  const sourceLines = (result?.blocks ?? []).map((block) => {
    const line = (pageLineCounts.get(block.page) ?? 0) + 1;
    pageLineCounts.set(block.page, line);
    return { block, line };
  });
  const dirty = fields.some((field) => draftFields[field.id]?.value !== field.value || draftFields[field.id]?.confirmed !== field.confirmed);

  const accept = useCallback((body: MaterialAnalysisResponse) => {
    setAnalysis(body.analysis);
    setConfigured(body.configured);
    setDraftFields(draftsFor(body.analysis));
    if (body.analysis) setDocumentKind(body.analysis.documentKind);
  }, []);

  const request = useCallback(async (init?: RequestInit): Promise<MaterialAnalysisResponse> => {
    const controller = new AbortController();
    requestsRef.current.add(controller);
    try {
      const response = await fetch(endpoint, { ...init, signal: controller.signal });
      const body = await response.json().catch(() => ({})) as MaterialAnalysisResponse & { error?: string };
      if (!response.ok) {
        const error = new Error(body.error || '当前请求没有成功，请稍后重试。') as Error & { status?: number };
        error.status = response.status;
        throw error;
      }
      return body;
    } finally { requestsRef.current.delete(controller); }
  }, [endpoint]);

  useEffect(() => {
    aliveRef.current = true;
    panelRef.current?.focus({ preventScroll: true });
    panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const generation = ++loadGenerationRef.current;
    void request().then((body) => {
      if (aliveRef.current && generation === loadGenerationRef.current) { accept(body); setLoading(false); }
    }).catch((failure: unknown) => {
      if (aliveRef.current && generation === loadGenerationRef.current) { setRequestError(failure instanceof Error ? failure.message : '无法读取识别状态。'); setLoading(false); }
    });
    const controllers = requestsRef.current;
    return () => { aliveRef.current = false; controllers.forEach((controller) => controller.abort()); };
  }, [request, accept]);

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const body = await request();
        if (cancelled || !aliveRef.current) return;
        accept(body);
        setRequestError('');
        if (body.analysis?.status !== 'running') return;
      } catch (failure) {
        if (cancelled || !aliveRef.current) return;
        setRequestError(failure instanceof Error ? `暂时无法更新进度：${failure.message} 将继续尝试。` : '暂时无法更新进度，将继续尝试。');
      }
      if (!cancelled && aliveRef.current) timer = setTimeout(() => void poll(), 1500);
    };
    timer = setTimeout(() => void poll(), 1500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [running, request, accept]);

  useEffect(() => {
    if (!imageEvidence) return;
    const controller = new AbortController();
    let objectUrl = '';
    let cancelled = false;
    void fetch(downloadUrl, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error('无法加载原图，请从材料清单下载核对。');
      const blob = await response.blob();
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setPreview({ url: objectUrl, error: '' });
    }).catch((failure: unknown) => {
      if (!cancelled) setPreview({ url: '', error: failure instanceof Error ? failure.message : '原图加载失败。' });
    });
    return () => { cancelled = true; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [downloadUrl, imageEvidence]);

  const reload = async () => {
    const generation = ++loadGenerationRef.current;
    setLoading(true);
    setRequestError('');
    try {
      const body = await request();
      if (!aliveRef.current || generation !== loadGenerationRef.current) return;
      accept(body);
      setConflict(false);
      setFocusedFieldId(null);
    } catch (failure) {
      if (aliveRef.current && generation === loadGenerationRef.current) setRequestError(failure instanceof Error ? failure.message : '重新加载失败。');
    } finally { if (aliveRef.current && generation === loadGenerationRef.current) setLoading(false); }
  };

  const start = async () => {
    if (running || starting || loading || !supported) return;
    setStarting(true);
    setRequestError('');
    try {
      const body = await request({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentKind, ...(analysis?.status === 'failed' ? { retry: true } : {}) }) });
      if (!aliveRef.current) return;
      accept(body);
      setConflict(false);
    } catch (failure) {
      if (aliveRef.current) setRequestError(failure instanceof Error ? failure.message : '识别没有开始，请稍后重试。');
    } finally { if (aliveRef.current) setStarting(false); }
  };

  const save = async () => {
    if (!analysis || saving || conflict || !dirty) return;
    setSaving(true);
    setRequestError('');
    try {
      const body = await request({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: analysis.revision, fields: fields.map((field) => ({ id: field.id, value: draftFields[field.id]?.value ?? field.value, confirmed: draftFields[field.id]?.confirmed ?? false })) }) });
      if (!aliveRef.current) return;
      accept(body);
      notify('字段核对已保存；原始识别值和来源仍可对照。');
    } catch (failure) {
      if (!aliveRef.current) return;
      if ((failure as Error & { status?: number }).status === 409) {
        setConflict(true);
        setRequestError('这份材料的识别结果已在其他操作中更新。当前修改尚未保存，请先复制需要保留的内容，再重新加载最新版本并核对。');
      } else setRequestError(failure instanceof Error ? failure.message : '核对保存失败，当前修改仍在页面中。');
    } finally { if (aliveRef.current) setSaving(false); }
  };

  const updateField = (field: MaterialField, value: string) => {
    setDraftFields((current) => ({ ...current, [field.id]: { value, confirmed: false } }));
  };

  const locateField = (field: MaterialField) => {
    setFocusedFieldId(field.id);
    sourceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const firstBlock = result?.blocks.find((block) => field.blockIds.includes(block.id));
    const line = firstBlock ? sourceLineRefs.current.get(firstBlock.id) : null;
    if (line) sourceListRef.current?.scrollTo({ top: line.offsetTop, behavior: 'smooth' });
  };

  return (
    <section id="material-analysis-panel" className="panel material-panel" ref={panelRef} tabIndex={-1} aria-label={`材料识别：${evidence.name}`}>
      <div className="material-heading"><div className="material-heading-copy"><span className="workspace-page-icon tone-violet" aria-hidden="true"><ScanText size={24} /></span><div><span className="eyebrow">识别 · 核对 · 查出处</span><h2>{evidence.name}</h2><p>识别结果需要与原文件逐项核对，才可用于整理案件事实。</p></div></div><button className="icon-button" aria-label="关闭材料识别面板" onClick={onClose}><X size={20} /></button></div>
      <div className="material-toolbar">
        <label className="field"><span>识别材料类型</span><select value={documentKind} onChange={(event) => setDocumentKind(event.target.value as DocumentKind)} disabled={loading || starting || running || Boolean(result)}>{Object.entries(documentKindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {!result && <button className="button button-primary" onClick={() => void start()} disabled={loading || starting || running || configured === false || !supported}><ScanText size={17} />{starting ? '正在开始…' : running ? '正在识别…' : analysis?.status === 'failed' ? '重试识别并检索' : '识别并检索'}</button>}
        <a className="button button-secondary" href={`${downloadUrl}${evidence.mimeType === 'application/pdf' || /\.pdf$/i.test(evidence.name) ? `#page=${sourcePage}` : ''}`}><Download size={16} />下载原文件{focusedField ? ` · 对照第 ${sourcePage} 页` : ''}</a>
      </div>
      {!supported && <div className="material-notice"><Info size={18} /><p>当前文件可以保存和下载，暂不支持自动识别。Word 请先转换为 PDF 或 PNG / JPEG 图片，再上传识别。</p></div>}
      {configured === false && supported && <div className="material-notice"><Info size={18} /><p>材料识别服务尚未配置。原文件已保存，请稍后再试，或先手动整理并核对材料。</p></div>}
      {requestError && <div className="material-error" role="alert"><p>{requestError}</p>{!running && <button className="button button-secondary" disabled={loading || saving || starting} onClick={() => void reload()}><RefreshCw size={16} />{conflict ? '重新加载最新版本' : '重新读取状态'}</button>}</div>}
      {loading && <p className="material-progress" role="status"><LoaderCircle size={18} />正在读取材料识别状态…</p>}
      {running && <div className="material-progress" role="status"><LoaderCircle size={20} /><div><strong>正在读取原文件并检索关联资料</strong><p>识别完成后会自动显示结果。此时尚未形成可核对的识别结论。</p></div></div>}
      {analysis?.status === 'failed' && <div className="material-error" role="alert"><strong>本次识别未完成</strong><p>{analysis.error || '请稍后重试，或检查文件是否清晰、完整。'}</p></div>}
      {result && (
        <>
          <div className="material-result-meta"><span>{result.engine.structuring === 'local_vision_model' ? '本机视觉模型提取' : result.engine.structuring === 'local_text_model' ? '文字识别 + 本地文本模型' : 'OCR + 规则提取'}</span>{result.engine.model && <span>模型：{result.engine.model}</span>}<span>文字读取：{result.engine.ocr}</span><span>{result.pageCount} 页 · 待人工核对</span><span title={result.source.sha256}>原文件 SHA-256：<code>{result.source.sha256.slice(0, 12)}</code></span></div>
          {result.warnings.length > 0 && <div className="material-notice"><Info size={18} /><div>{result.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div></div>}
          <div className="material-workspace">
            <section className="material-fields" aria-label="字段核对">
              <div className="material-section-heading"><h3>逐项核对事实</h3><span>{fields.filter((field) => draftFields[field.id]?.confirmed).length} / {fields.length} 项已勾选核对</span></div>
              <p className="material-help">修改后请对照原文重新勾选。未保存的修改只保留在本次页面中。</p>
              {fields.length === 0 && <div className="material-empty"><Info size={22} /><p>已读取材料文字，但没有提取到可核对字段。请查看原文，并补充清晰完整的材料。</p></div>}
              {fields.map((field) => {
                const draft = draftFields[field.id] ?? { value: field.value, confirmed: false };
                return (
                  <article className={`material-field-card ${focusedFieldId === field.id ? 'material-field-focused' : ''}`} key={field.id}>
                    <div className="material-field-label"><label htmlFor={`material-field-${field.id}`}>{field.label}</label><span>{draft.value !== field.extractedValue || field.review === 'corrected' ? draft.confirmed ? '用户修订 · 已核对原件' : '用户修订 · 待核对' : draft.confirmed ? '已勾选核对' : '待核对'}</span></div>
                    <textarea id={`material-field-${field.id}`} value={draft.value} onChange={(event) => updateField(field, event.target.value)} rows={2} maxLength={300} disabled={saving || loading} />
                    <p className="material-original-value"><strong>原始提取：</strong>{field.extractedValue || '未提取到值'}</p>
                    <blockquote>{field.quote || '暂无对应原文片段，请下载原文件核对。'}</blockquote>
                    <div className="material-field-actions"><label><input type="checkbox" checked={draft.confirmed} disabled={saving || loading} onChange={(event) => setDraftFields((current) => ({ ...current, [field.id]: { value: draft.value, confirmed: event.target.checked } }))} />已与原文件核对</label><button className="material-text-button" onClick={() => locateField(field)}>定位原文</button></div>
                  </article>
                );
              })}
              {fields.length > 0 && <div className="material-save-row"><button className="button button-primary" disabled={!dirty || saving || loading || conflict} onClick={() => void save()}><Check size={17} />{saving ? '正在保存…' : '保存核对结果'}</button><span>{dirty ? '有未保存的核对修改' : '当前核对结果已保存'}</span></div>}
            </section>
            <div className="material-source" ref={sourceRef}>
              <div className="material-section-heading"><h3>原文对照</h3><span>{focusedField ? `${focusedField.label} · 第 ${sourcePage} 页` : '点击字段的“定位原文”'}</span></div>
              {focusedBlocks.length > 0 && <div className="material-focused-excerpt">{focusedBlocks.map((block) => <p key={block.id}><strong>第 {block.page} 页对应原文：</strong>{block.text}</p>)}</div>}
              {imageEvidence && (
                <div className="material-image-preview">
                  {preview.url ? (
                    <div className="material-image-canvas">
                      <PrivateOriginalImage url={preview.url} name={evidence.name} />
                      {focusedBlocks.filter((block) => block.page === 1).map((block) => {
                        const style = boxStyle(block);
                        return style ? <span className="material-image-highlight" style={style} key={block.id} aria-label={`对应原文 ${block.text}`} /> : null;
                      })}
                    </div>
                  ) : <p>{preview.error || '正在加载私有原图…'}</p>}
                </div>
              )}
              {!imageEvidence && <p className="material-help">{evidence.mimeType === 'application/pdf' || /\.pdf$/i.test(evidence.name) ? `下载原 PDF 后对照第 ${sourcePage} 页。下面展示识别原文行；当前没有页面图像，不绘制位置高亮。` : '下面展示文件原文行，也可以下载原文件逐项核对。'}</p>}
              {focusedField && focusedBlocks.length === 0 && <p className="material-help">此字段没有可定位的原文行，请结合摘录和原文件核对。</p>}
              <ol className="material-source-lines" ref={sourceListRef}>{sourceLines.map(({ block, line }) => <li ref={(element) => { if (element) sourceLineRefs.current.set(block.id, element); else sourceLineRefs.current.delete(block.id); }} className={focusedField?.blockIds.includes(block.id) ? 'material-source-line-selected' : ''} key={block.id}><span>第 {block.page} 页 · 行 {line}</span><p>{block.text}</p></li>)}</ol>
              {result.blocks.length === 0 && <p className="material-help">未读取到原文行，请下载文件检查清晰度和内容。</p>}
            </div>
          </div>
          <KnowledgeResults result={result.knowledge} />
        </>
      )}
    </section>
  );
}
