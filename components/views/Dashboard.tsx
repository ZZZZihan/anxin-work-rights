'use client';

import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  FileCheck2,
  FileText,
  FolderLock,
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
    <div className="clio-dashboard">
      <section className="clio-overview">
        <div className="clio-welcome">
          <span className="clio-overview-label">我的工作台</span>
          <h1>{greeting()}，{data.user.displayName}</h1>
          <p>把眼前的一件事处理好，让每一步都有依据。</p>
          <section className="clio-metrics" aria-label="案件概况">
            <article className="tone-cases"><div className="clio-metric-value"><strong>{activeCases.length}</strong><span className="clio-metric-icon"><ClipboardList size={20} aria-hidden="true" /></span></div><span>进行中案件</span></article>
            <article className="tone-nodes"><div className="clio-metric-value"><strong>{upcoming.length}</strong><span className="clio-metric-icon"><CalendarDays size={20} aria-hidden="true" /></span></div><span>14 天内节点</span></article>
            <article className="tone-evidence"><div className="clio-metric-value"><strong>{data.evidence.length}</strong><span className="clio-metric-icon"><FolderLock size={20} aria-hidden="true" /></span></div><span>证据记录</span></article>
          </section>
        </div>

        <section className="clio-priority" aria-labelledby="next-action-title">
          <header className="clio-priority-heading">
            <span className="clio-priority-label"><ClipboardList size={19} aria-hidden="true" />优先处理</span>
            {urgent && <span className="clio-priority-status">{statusLabels[urgent.status]}</span>}
          </header>
          <h2 className="clio-priority-title" id="next-action-title">{urgent ? urgent.nextAction : '从一件事开始，慢慢整理清楚'}</h2>
          <p className="clio-priority-case">{urgent ? `${urgent.company} · ${urgent.type}` : '创建案件，记录发生的事，再一步步补齐证据。'}</p>
          {urgent && (
            <div className="clio-priority-meta">
              <span>目标日期 {formatDate(urgent.deadline, true)}</span>
              {daysUntil(urgent.deadline) !== null && <strong>{deadlineCopy(daysUntil(urgent.deadline)!)}</strong>}
            </div>
          )}
          <div className="clio-priority-actions">
            {urgent ? (
              <>
                <button className="button button-primary" onClick={() => openCase(urgent)}>查看行动清单 <ArrowRight size={17} aria-hidden="true" /></button>
                <button className="button button-secondary" onClick={() => openCase(urgent, 'evidence')}><FolderLock size={17} aria-hidden="true" />补充证据</button>
              </>
            ) : (
              <button className="button button-primary" onClick={() => navigate('cases')}><Plus size={18} aria-hidden="true" />新建案件</button>
            )}
          </div>
        </section>
      </section>

      <div className="clio-workspace">
        <section className="clio-cases" aria-labelledby="my-cases-title">
          <header className="clio-section-heading">
            <h2 id="my-cases-title">我的案件</h2>
            <div className="clio-section-actions">
              <button className="text-button" onClick={() => navigate('cases')}>查看全部 <ArrowRight size={15} aria-hidden="true" /></button>
              <button className="button button-primary clio-new-case" onClick={() => navigate('cases')}><Plus size={17} aria-hidden="true" />新建案件</button>
            </div>
          </header>
          <div className="clio-case-list">
            {activeCases.slice(0, 4).map((item) => (
              <button className="clio-case-row" key={item.id} onClick={() => openCase(item)}>
                <span className="clio-case-icon"><FileText size={21} aria-hidden="true" /></span>
                <span className="clio-case-copy">
                  <strong>{item.company}</strong>
                  <span>{item.type}</span>
                  {item.nextAction && <small>下一步：{item.nextAction}</small>}
                </span>
                <span className="clio-case-meta">
                  <span className={`clio-status-pill ${item.status}`}>{statusLabels[item.status]}</span>
                  <span className="clio-case-detail">
                    <strong>{item.amount > 0 ? formatMoney(item.amount) : '金额待核'}</strong>
                    {daysUntil(item.deadline) !== null && <small>{deadlineCopy(daysUntil(item.deadline)!)}</small>}
                  </span>
                </span>
                <ChevronRight size={17} aria-hidden="true" />
              </button>
            ))}
            {!activeCases.length && <div className="clio-empty-state"><CheckCircle2 size={26} aria-hidden="true" /><strong>当前没有待推进的案件</strong><span>新建案件后，进度会显示在这里。</span></div>}
          </div>
        </section>

        <aside className="clio-tools">
          <section className="clio-shortcuts" aria-labelledby="quick-entry-title">
            <header className="clio-section-heading"><h2 id="quick-entry-title">快速入口</h2></header>
            <div className="clio-shortcut-list">
              <button className="tone-violet" onClick={() => navigate('chat')}><span className="clio-shortcut-icon"><ListChecks size={20} aria-hidden="true" /></span><span className="clio-shortcut-copy"><strong>梳理问题</strong><small>厘清事实，明确诉求</small></span><ChevronRight size={16} aria-hidden="true" /></button>
              <button className="tone-blue" onClick={() => navigate('evidence')}><span className="clio-shortcut-icon"><Upload size={20} aria-hidden="true" /></span><span className="clio-shortcut-copy"><strong>上传材料</strong><small>整理并上传相关证据</small></span><ChevronRight size={16} aria-hidden="true" /></button>
              <button className="tone-mint" onClick={() => navigate('documents')}><span className="clio-shortcut-icon"><FileCheck2 size={20} aria-hidden="true" /></span><span className="clio-shortcut-copy"><strong>起草文书</strong><small>参考模板，准备所需文书</small></span><ChevronRight size={16} aria-hidden="true" /></button>
              <a className="tone-apricot" href="tel:12333"><span className="clio-shortcut-icon"><PhoneCall size={20} aria-hidden="true" /></span><span className="clio-shortcut-copy"><strong>拨打 12333</strong><small>咨询政策与办理流程</small></span><ChevronRight size={16} aria-hidden="true" /></a>
            </div>
          </section>

          <section className="clio-resources" aria-labelledby="official-resources">
            <header className="clio-section-heading"><h2 id="official-resources">官方入口</h2></header>
            <div className="clio-resource-list">
              <a href={OFFICIAL_SOURCES.arbitrationLaw.url} target="_blank" rel="noreferrer"><span className="clio-resource-copy"><strong>劳动争议程序</strong><small>了解仲裁、诉讼基本流程</small></span><ArrowRight size={16} aria-hidden="true" /></a>
              <a href={OFFICIAL_SOURCES.service12333.url} target="_blank" rel="noreferrer"><span className="clio-resource-copy"><strong>12333 服务平台</strong><small>人力资源社会保障服务</small></span><ArrowRight size={16} aria-hidden="true" /></a>
            </div>
          </section>
        </aside>
      </div>
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
