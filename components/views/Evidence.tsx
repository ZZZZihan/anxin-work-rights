'use client';

import { DragEvent, useRef, useState } from 'react';
import {
  Download,
  FileArchive,
  FileCheck2,
  FileImage,
  FileText,
  FolderLock,
  Info,
  LockKeyhole,
  Plus,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { apiRequest, formatDate, formatFileSize } from '@/lib/client';
import { createOperationId } from '@/lib/client-uuid';
import type { EvidenceFile } from '@/lib/types';
import type { SharedViewProps } from '../types';

const categories = ['劳动关系', '工资支付', '考勤加班', '解除经过', '工伤材料', '沟通记录', '其他材料'];

export default function Evidence({
  data,
  setData,
  activeCaseId,
  setActiveCaseId,
  navigate,
  notify,
}: SharedViewProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const retryInputRef = useRef<HTMLInputElement>(null);
  const retryItemRef = useRef<EvidenceFile | null>(null);
  const [category, setCategory] = useState(categories[0]);
  const [note, setNote] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const activeCase = data.cases.find((item) => item.id === activeCaseId) ?? data.cases[0];
  const evidence = data.evidence.filter((item) => item.caseId === activeCase?.id);

  const upload = async (file: File | undefined, retry?: EvidenceFile) => {
    if (!file || !activeCase || uploading) return;
    if (retry) {
      // Match the server's stored filename; the server also verifies the content hash.
      const name = file.name.replace(/[\\/]/g, '-').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120) || '未命名文件';
      if (name !== retry.name || file.size !== retry.size || file.type !== retry.mimeType) {
        const message = `请选择“${retry.name}”的原文件；名称、大小和文件类型必须与原记录一致。`;
        setUploadError(message);
        notify(message, 'error');
        return;
      }
    }
    const form = new FormData();
    form.append('file', file);
    form.append('caseId', retry?.caseId ?? activeCase.id);
    form.append('operationId', retry?.id ?? createOperationId());
    form.append('category', retry?.category ?? category);
    form.append('note', retry?.note ?? note);
    setUploading(true);
    setUploadError('');
    try {
      const result = await apiRequest<{ evidence: EvidenceFile }>('/api/evidence', {
        method: 'POST',
        body: form,
      });
      setData((current) => current ? {
        ...current,
        evidence: [result.evidence, ...current.evidence.filter((item) => item.id !== result.evidence.id)],
      } : current);
      if (!retry) setNote('');
      notify(retry ? '原上传记录已恢复，文件已安全保存。' : '文件已安全保存到当前案件。');
    } catch (error) {
      const message = error instanceof Error ? error.message : '上传失败。';
      notify(message, 'error');
      const refreshed = await apiRequest<import('@/lib/types').BootstrapData>('/api/bootstrap').catch(() => null);
      if (refreshed) {
        setData(refreshed);
        setUploadError(`${message} 若材料清单中显示“上传未完成”，请使用该记录的“选择原文件重试”。`);
      } else {
        setUploadError(`${message} 当前未能刷新材料状态，请稍后刷新页面，恢复后在“上传未完成”记录中选择原文件重试。`);
      }
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const retryUpload = (item: EvidenceFile) => {
    if (uploading) return;
    retryItemRef.current = item;
    retryInputRef.current?.click();
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length > 1) {
      const message = '一次只能上传一个文件，请分次选择或拖入。';
      setUploadError(message);
      notify(message, 'error');
      return;
    }
    void upload(event.dataTransfer.files[0]);
  };

  const remove = async (item: EvidenceFile) => {
    if (!window.confirm(`确认删除“${item.name}”？${data.synthetic?.directEntry ? '' : data.synthetic ? '合成' : '真实'}上传的文件会一并从私有存储中删除。`)) return;
    setDeletingId(item.id);
    try {
      await apiRequest<{ ok: true }>(`/api/evidence?id=${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      setData((current) => current ? {
        ...current,
        evidence: current.evidence.filter((entry) => entry.id !== item.id),
      } : current);
      notify('证据记录已删除。');
    } catch (error) {
      notify(error instanceof Error ? error.message : '删除失败。', 'error');
      const refreshed = await apiRequest<import('@/lib/types').BootstrapData>('/api/bootstrap').catch(() => null);
      if (refreshed) setData(refreshed);
    } finally {
      setDeletingId(null);
    }
  };

  if (!activeCase) {
    return (
      <section className="panel empty-panel standalone-empty workspace-view evidence-view">
        <FolderLock size={30} /><h1>先创建一个案件</h1><p>证据文件需要归入具体案件，便于形成完整材料清单。</p>
        <button className="button button-primary" onClick={() => navigate('cases')}><Plus size={17} />创建案件</button>
      </section>
    );
  }

  return (
    <div className="view-stack workspace-view evidence-view">
      <section className="page-heading-row">
        <div className="workspace-heading-copy">
          <span className="workspace-page-icon tone-blue" aria-hidden="true"><FolderLock size={25} /></span>
          <div>
            <h1>证据管家</h1>
            <p>把原文件和来源说明一起保存，让每一份材料都能找到来处。</p>
          </div>
        </div>
        <label className="case-switcher">
          <span>当前案件</span>
          <select value={activeCase.id} onChange={(event) => setActiveCaseId(event.target.value)}>
            {data.cases.map((item) => <option key={item.id} value={item.id}>{item.company} · {item.type}</option>)}
          </select>
        </label>
      </section>

      <div className="evidence-layout">
        <section className="upload-panel panel">
          <div className="section-heading">
            <div><span className="eyebrow">上传材料</span><h2>{data.synthetic?.directEntry ? '添加文件' : data.synthetic ? '添加合成文件' : '添加真实文件'}</h2></div>
            {!data.synthetic?.directEntry && <span className="private-badge"><LockKeyhole size={14} />仅你可见</span>}
          </div>

          {uploadError && <div className="integrity-note" role="alert"><Info size={18} /><p>{uploadError}</p></div>}

          <div
            className={`drop-zone ${dragging ? 'dragging' : ''}`}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            <span className="upload-icon"><UploadCloud size={28} /></span>
            <h3>{uploading ? '正在安全上传…' : '把文件拖到这里'}</h3>
            <p>一次选择或拖入一个文件；单个不超过 10MB</p>
            <button className="button button-secondary" disabled={uploading} onClick={() => inputRef.current?.click()}>
              <Plus size={17} />选择文件
            </button>
            <input
              ref={inputRef}
              hidden
              type="file"
              accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.txt"
              onChange={(event) => void upload(event.target.files?.[0])}
            />
            <small>支持 PDF、Word、PNG、JPG、TXT</small>
          </div>

          <div className="upload-meta-grid">
            <label className="field"><span>材料类别</span><select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="field"><span>来源 / 说明（可选）</span><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="例如：2026-03-05 从银行 App 导出" /></label>
          </div>

          <div className="integrity-note">
            <Info size={18} />
            <p><strong>保留原件提示</strong><span>截图尽量包含时间、账号和上下文；录音、照片等请保留原始文件，不要只保存转发副本。</span></p>
          </div>
        </section>

        <aside className="evidence-summary panel">
          <span className="workspace-card-icon tone-mint" aria-hidden="true"><FolderLock size={22} /></span>
          <span className="eyebrow">当前案件</span>
          <h2>{activeCase.company}</h2>
          <p>{activeCase.type}</p>
          <div className="evidence-count"><strong>{evidence.length}</strong><span>份材料记录</span></div>
          <div className="evidence-category-list">
            {categoryCounts(evidence).map(([name, count]) => (
              <div key={name}><span>{name}</span><strong>{count}</strong></div>
            ))}
          </div>
        </aside>
      </div>

      <section className="panel evidence-list-panel">
        <div className="section-heading">
          <div><span className="eyebrow">材料清单</span><h2>{activeCase.company}</h2></div>
          <span className="muted-count">{evidence.length} 项</span>
        </div>
        <div className="evidence-table" role="list">
          <input
            ref={retryInputRef}
            hidden
            type="file"
            accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.txt"
            aria-label="选择原文件重试上传"
            onChange={(event) => {
              const file = event.target.files?.[0];
              const item = retryItemRef.current;
              event.target.value = '';
              if (item) void upload(file, item);
            }}
          />
          {evidence.map((item) => (
            <article className="evidence-row" key={item.id} role="listitem">
              <span className={`file-icon ${fileTone(item.mimeType)}`}>{fileIcon(item.mimeType)}</span>
              <div className="evidence-main">
                <div className="evidence-name-row">
                  <strong>{item.name}</strong>
                  <span className={`evidence-status ${item.status}`}>{item.status === 'example' ? '示例记录' : item.status === 'uploaded' ? '已上传' : item.status === 'deleting' ? '删除待重试' : item.status === 'upload_failed' || item.status === 'uploading' ? '上传未完成' : '待核对'}</span>
                </div>
                <span>{item.category} · {formatFileSize(item.size)} · {formatDate(item.uploadedAt, true)}</span>
                {item.note && <small>{item.note}</small>}
              </div>
              <div className="evidence-actions">
                {(item.status === 'uploading' || item.status === 'upload_failed') && (
                  <button className="button button-secondary" aria-label={`选择原文件重试 ${item.name}`} disabled={uploading || deletingId === item.id} onClick={() => retryUpload(item)}>
                    <UploadCloud size={16} />选择原文件重试
                  </button>
                )}
                {item.downloadable ? (
                  <a className="icon-button" aria-label={`下载 ${item.name}`} href={`/api/evidence/${encodeURIComponent(item.id)}/download`}><Download size={17} /></a>
                ) : (
                  <button className="icon-button" aria-label="文件暂不可下载" disabled><Download size={17} /></button>
                )}
                <button className="icon-button danger" aria-label={`删除 ${item.name}`} disabled={deletingId === item.id} onClick={() => void remove(item)}><Trash2 size={17} /></button>
              </div>
            </article>
          ))}
          {!evidence.length && (
            <div className="inline-empty"><FolderLock size={26} /><strong>还没有材料</strong><span>从上方上传第一份{data.synthetic?.directEntry ? '' : data.synthetic ? '合成' : '真实'}文件。</span></div>
          )}
        </div>
      </section>
    </div>
  );
}

function categoryCounts(items: EvidenceFile[]) {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
}

function fileTone(mime: string) {
  if (mime.includes('image')) return 'image';
  if (mime.includes('pdf')) return 'pdf';
  if (mime.includes('word')) return 'word';
  return 'file';
}

function fileIcon(mime: string) {
  if (mime.includes('image')) return <FileImage size={21} />;
  if (mime.includes('pdf')) return <FileText size={21} />;
  if (mime.includes('word')) return <FileCheck2 size={21} />;
  return <FileArchive size={21} />;
}
