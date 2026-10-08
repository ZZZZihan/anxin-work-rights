'use client';

import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  FileCheck2,
  FileText,
  FolderLock,
  Landmark,
  Link2,
  ListChecks,
  PhoneCall,
  Plus,
  Upload,
} from 'lucide-react';
import { daysUntil, formatDate, formatMoney } from '@/lib/client';
import { OFFICIAL_SOURCES } from '@/lib/legal';
import type { WorkCase } from '@/lib/types';
import type { SharedViewProps } from '../types';

const statusLabels: Record<WorkCase['status'], string> = {
  collecting: '整理材料',
  negotiating: '沟通协商',
  arbitration: '仲裁准备',
  completed: '已完成',
  archived: '已归档',
};

export default function Dashboard({ data, setActiveCaseId, navigate }: SharedViewProps) {
  const activeCases = data.cases.filter((item) => item.status !== 'completed');
  const upcoming = activeCases.filter((item) => {
    const days = daysUntil(item.deadline);
    return days !== null && days >= 0 && days <= 14;
  });
  const urgent = [...activeCases].sort((a, b) => {
    const aDate = a.deadline ? new Date(a.deadline).getTime() : Number.POSITIVE_INFINITY;
    const bDate = b.deadline ? new Date(b.deadline).getTime() : Number.POSITIVE_INFINITY;
    return aDate - bDate;
  })[0];

  const openCase = (item: WorkCase, destination: 'cases' | 'evidence' = 'cases') => {
    setActiveCaseId(item.id);
    navigate(destination);
  };

  return (
    <div className="view-stack">
      <section className="welcome-row">
        <div>
          <h1>{greeting()}，{data.user.displayName}</h1>
          <p>先处理离期限最近的一件事，把事实和证据一步步整理清楚。</p>
        </div>
        <button className="button button-primary desktop-action" onClick={() => navigate('cases')}>
          <Plus size={19} aria-hidden="true" />新建案件
        </button>
      </section>

      <section className="action-hero" aria-labelledby="next-action-title">
        <span className="action-hero-icon"><ClipboardList size={30} aria-hidden="true" /></span>
        <div className="action-hero-copy">
          <h2 id="next-action-title">{urgent ? urgent.nextAction : '从一件事开始，慢慢整理清楚'}</h2>
          <p>{urgent ? `${urgent.company} · ${urgent.type}` : '创建案件，记录发生的事，再一步步补齐证据。'}</p>
          {urgent && (
            <div className="hero-meta">
              <span>目标日期 {formatDate(urgent.deadline, true)}</span>
              {daysUntil(urgent.deadline) !== null && <strong>{deadlineCopy(daysUntil(urgent.deadline)!)}</strong>}
            </div>
          )}
        </div>
        <div className="action-hero-buttons">
          {urgent ? (
            <>
              <button className="button button-secondary" onClick={() => openCase(urgent)}>查看行动清单 <ArrowRight size={17} /></button>
              <button className="button button-primary" onClick={() => openCase(urgent, 'evidence')}><FolderLock size={17} />补充证据</button>
            </>
          ) : (
            <button className="button button-primary" onClick={() => navigate('cases')}><Plus size={18} />新建案件</button>
          )}
        </div>
      </section>

      <section className="metric-grid" aria-label="案件概况">
        <article className="metric-card"><strong>{activeCases.length}</strong><span>进行中案件</span></article>
        <article className="metric-card"><strong>{upcoming.length}</strong><span>14 天内节点</span></article>
        <article className="metric-card"><strong>{data.evidence.length}</strong><span>证据记录</span></article>
      </section>

      <div className="dashboard-grid">
        <section className="panel case-overview-panel">
          <div className="section-heading">
            <h2>正在处理</h2>
            <button className="text-button" onClick={() => navigate('cases')}>查看全部 <ArrowRight size={15} /></button>
          </div>
          <div className="case-mini-list">
            {activeCases.slice(0, 3).map((item) => (
              <button className="case-mini" key={item.id} onClick={() => openCase(item)}>
                <FileText className="case-mini-icon" size={21} aria-hidden="true" />
                <span className="case-mini-copy">
                  <strong>{item.company}</strong>
                  <span>{item.type}<span className="case-mini-mobile-status"> · {statusLabels[item.status]}</span></span>
                  {daysUntil(item.deadline) !== null && <small className="case-mini-deadline">{deadlineCopy(daysUntil(item.deadline)!)}</small>}
                </span>
                <span className={`status-pill ${item.status}`}>{statusLabels[item.status]}</span>
                <span className="case-mini-side"><strong>{item.amount > 0 ? formatMoney(item.amount) : '金额待核'}</strong></span>
                <ChevronRight className="case-mini-arrow" size={17} aria-hidden="true" />
              </button>
            ))}
            {!activeCases.length && <div className="inline-empty"><CheckCircle2 size={26} /><strong>当前没有待推进的案件</strong><span>新建案件后，进度会显示在这里。</span></div>}
          </div>
        </section>

        <section className="panel quick-panel">
          <div className="section-heading"><h2>现在可以做</h2></div>
          <div className="quick-grid">
            <button onClick={() => navigate('chat')}><span className="quick-icon"><ListChecks size={21} /></span><span><strong>梳理问题</strong><small>厘清关键事实，明确你的诉求</small></span><ChevronRight size={17} /></button>
            <button onClick={() => navigate('evidence')}><span className="quick-icon"><Upload size={21} /></span><span><strong>上传材料</strong><small>按时间顺序整理并上传相关证据</small></span><ChevronRight size={17} /></button>
            <button onClick={() => navigate('documents')}><span className="quick-icon"><FileCheck2 size={21} /></span><span><strong>起草文书</strong><small>参考模板，完成申请或仲裁文书</small></span><ChevronRight size={17} /></button>
            <a href="tel:12333"><span className="quick-icon"><PhoneCall size={21} /></span><span><strong>拨打 12333</strong><small>咨询劳动保障相关政策与办理流程</small></span><ChevronRight size={17} /></a>
          </div>
        </section>
      </div>

      <section className="source-strip" aria-labelledby="official-resources">
        <h2 id="official-resources">官方入口</h2>
        <div className="source-links">
          <a href={OFFICIAL_SOURCES.arbitrationLaw.url} target="_blank" rel="noreferrer"><span className="quick-icon"><Landmark size={21} /></span><span><strong>劳动争议程序</strong><small>了解仲裁、诉讼等基本流程</small></span><ChevronRight size={17} /></a>
          <a href={OFFICIAL_SOURCES.service12333.url} target="_blank" rel="noreferrer"><span className="quick-icon"><Link2 size={21} /></span><span><strong>12333 服务平台</strong><small>进入人力资源社会保障服务平台</small></span><ChevronRight size={17} /></a>
        </div>
      </section>
    </div>
  );
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 11) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function deadlineCopy(days: number) {
  if (days < 0) return `已过 ${Math.abs(days)} 天`;
  if (days === 0) return '今天到期';
  return `还有 ${days} 天`;
}
