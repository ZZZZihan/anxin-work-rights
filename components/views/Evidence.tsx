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
  const [category, setCategory] = useState(categories[0]);
  const [note, setNote] = useState('');
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const activeCase = data.cases.find((item) => item.id === activeCaseId) ?? data.cases[0];
  const evidence = data.evidence.filter((item) => item.caseId === activeCase?.id);

  const upload = async (file: File | undefined) => {
    if (!file || !activeCase) return;
    const form = new FormData();
    form.append('file', file);
    form.append('caseId', activeCase.id);
    form.append('category', category);
    form.append('note', note);
    setUploading(true);
    try {
      const result = await apiRequest<{ evidence: EvidenceFile }>('/api/evidence', {
        method: 'POST',
        body: form,
      });
      setData((current) => current ? {
        ...current,
        evidence: [result.evidence, ...current.evidence],
      } : current);
      setNote('');
      notify('文件已安全保存到当前案件。');
    } catch (error) {
      notify(error instanceof Error ? error.message : '上传失败。', 'error');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void upload(event.dataTransfer.files[0]);
  };

  const remove = async (item: EvidenceFile) => {
    if (!window.confirm(`确认删除“${item.name}”？真实上传的文件会一并从私有存储中删除。`)) return;
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
    } finally {
      setDeletingId(null);
    }
  };

  if (!activeCase) {
    return (
      <section className="panel empty-panel standalone-empty">
        <FolderLock size={30} /><h1>先创建一个案件</h1><p>证据文件需要归入具体案件，便于形成完整材料清单。</p>
        <button className="button button-primary" onClick={() => navigate('cases')}><Plus size={17} />创建案件</button>
      </section>
    );
  }

  return (
    <div className="view-stack">
      <section className="page-heading-row">
        <div>
          <span className="eyebrow">PRIVATE EVIDENCE VAULT</span>
          <h1>证据管家</h1>
          <p>保留原文件、完整上下文和来源说明；系统不会假装做过 OCR 或证据效力判断。</p>
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
            <div><span className="eyebrow">上传材料</span><h2>添加真实文件</h2></div>
            <span className="private-badge"><LockKeyhole size={14} />仅你可见</span>
          </div>

          <div
            className={`drop-zone ${dragging ? 'dragging' : ''}`}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            <span className="upload-icon"><UploadCloud size={28} /></span>
            <h3>{uploading ? '正在安全上传…' : '把文件拖到这里'}</h3>
            <p>或从设备选择文件；单个不超过 10MB</p>
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
          {evidence.map((item) => (
            <article className="evidence-row" key={item.id} role="listitem">
              <span className={`file-icon ${fileTone(item.mimeType)}`}>{fileIcon(item.mimeType)}</span>
              <div className="evidence-main">
                <div className="evidence-name-row">
                  <strong>{item.name}</strong>
                  <span className={`evidence-status ${item.status}`}>{item.status === 'example' ? '示例记录' : item.status === 'uploaded' ? '已上传' : '待核对'}</span>
                </div>
                <span>{item.category} · {formatFileSize(item.size)} · {formatDate(item.uploadedAt, true)}</span>
                {item.note && <small>{item.note}</small>}
              </div>
              <div className="evidence-actions">
                {item.downloadable ? (
                  <a className="icon-button" aria-label={`下载 ${item.name}`} href={`/api/evidence/${encodeURIComponent(item.id)}/download`}><Download size={17} /></a>
                ) : (
                  <button className="icon-button" aria-label="示例记录不可下载" disabled><Download size={17} /></button>
                )}
                <button className="icon-button danger" aria-label={`删除 ${item.name}`} disabled={deletingId === item.id} onClick={() => void remove(item)}><Trash2 size={17} /></button>
              </div>
            </article>
          ))}
          {!evidence.length && (
            <div className="inline-empty"><FolderLock size={26} /><strong>还没有材料</strong><span>从上方上传第一份真实文件。</span></div>
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
