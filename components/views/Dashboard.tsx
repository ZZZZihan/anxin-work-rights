'use client';

import {
  ArrowRight,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  FileCheck2,
  FolderLock,
  Landmark,
  MessageCircleMore,
  PhoneCall,
  Plus,
  ShieldCheck,
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
          <span className="eyebrow">今日行动工作台</span>
          <h1>{greeting()}，{data.user.displayName}</h1>
          <p>先处理离期限最近的一件事，把事实和证据一步步整理清楚。</p>
        </div>
        <button className="button button-primary desktop-action" onClick={() => navigate('cases')}>
          <Plus size={18} aria-hidden="true" />新建案件
        </button>
      </section>

      {urgent ? (
        <section className="action-hero" aria-labelledby="next-action-title">
          <div className="action-hero-copy">
            <span className="status-kicker"><CalendarClock size={16} />下一项重要行动</span>
            <h2 id="next-action-title">{urgent.nextAction}</h2>
            <p>{urgent.company} · {urgent.type}</p>
            <div className="hero-meta">
              <span>目标日期 {formatDate(urgent.deadline, true)}</span>
              {daysUntil(urgent.deadline) !== null && (
                <strong>{deadlineCopy(daysUntil(urgent.deadline)!)}</strong>
              )}
            </div>
          </div>
          <div className="action-hero-buttons">
            <button className="button button-light" onClick={() => openCase(urgent)}>
              查看行动清单 <ArrowRight size={17} />
            </button>
            <button className="button button-ghost-light" onClick={() => openCase(urgent, 'evidence')}>
              <FolderLock size={17} />补充证据
            </button>
          </div>
        </section>
      ) : (
        <section className="empty-panel">
          <CheckCircle2 size={28} />
          <h2>当前没有待推进的案件</h2>
          <p>创建一个案件，系统会帮你拆成事实、证据和下一步行动。</p>
          <button className="button button-primary" onClick={() => navigate('cases')}><Plus size={17} />新建案件</button>
        </section>
      )}

      <section className="metric-grid" aria-label="案件概况">
        <article className="metric-card">
          <span className="metric-icon navy"><BriefcaseBusiness size={21} /></span>
          <div><strong>{activeCases.length}</strong><span>进行中案件</span></div>
        </article>
        <article className="metric-card">
          <span className="metric-icon orange"><CalendarClock size={21} /></span>
          <div><strong>{upcoming.length}</strong><span>14 天内节点</span></div>
        </article>
        <article className="metric-card">
          <span className="metric-icon teal"><FileCheck2 size={21} /></span>
          <div><strong>{data.evidence.length}</strong><span>证据记录</span></div>
        </article>
      </section>

      <div className="dashboard-grid">
        <section className="panel case-overview-panel">
          <div className="section-heading">
            <div><span className="eyebrow">案件进度</span><h2>正在处理</h2></div>
            <button className="text-button" onClick={() => navigate('cases')}>查看全部 <ArrowRight size={15} /></button>
          </div>
          <div className="case-mini-list">
            {data.cases.slice(0, 3).map((item) => (
              <button className="case-mini" key={item.id} onClick={() => openCase(item)}>
                <span className="case-type-icon"><BriefcaseBusiness size={19} /></span>
                <span className="case-mini-copy">
                  <strong>{item.company}</strong>
                  <span>{item.type} · {statusLabels[item.status]}</span>
                </span>
                <span className="case-mini-side">
                  {item.amount > 0 && <strong>{formatMoney(item.amount)}</strong>}
                  <span>{formatDate(item.deadline)}</span>
                </span>
                <ArrowRight className="case-mini-arrow" size={17} />
              </button>
            ))}
          </div>
        </section>

        <section className="panel quick-panel">
          <div className="section-heading">
            <div><span className="eyebrow">快捷入口</span><h2>现在可以做</h2></div>
          </div>
          <div className="quick-grid">
            <button onClick={() => navigate('chat')}><MessageCircleMore size={21} /><span><strong>梳理问题</strong><small>规则库初筛</small></span></button>
            <button onClick={() => navigate('evidence')}><FolderLock size={21} /><span><strong>上传材料</strong><small>私有文件库</small></span></button>
            <button onClick={() => navigate('documents')}><FileCheck2 size={21} /><span><strong>起草文书</strong><small>保存与导出</small></span></button>
            <a href="tel:12333"><PhoneCall size={21} /><span><strong>拨打 12333</strong><small>官方人社咨询</small></span></a>
          </div>
        </section>
      </div>

      <section className="source-strip" aria-labelledby="official-resources">
        <div className="source-strip-title">
          <span className="source-shield"><ShieldCheck size={22} /></span>
          <div><span className="eyebrow">官方入口</span><h2 id="official-resources">核实规则与办事口径</h2></div>
        </div>
        <div className="source-links">
          <a href={OFFICIAL_SOURCES.arbitrationLaw.url} target="_blank" rel="noreferrer"><Landmark size={18} /><span>劳动争议程序</span><ArrowRight size={15} /></a>
          <a href={OFFICIAL_SOURCES.service12333.url} target="_blank" rel="noreferrer"><PhoneCall size={18} /><span>12333 服务平台</span><ArrowRight size={15} /></a>
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
