'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2,
  ClipboardList,
  FileText,
  Folder,
  House,
  LogOut,
  Menu,
  RefreshCw,
  Scale,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react';
import Dashboard from './views/Dashboard';
import Cases from './views/Cases';
import Evidence from './views/Evidence';
import Chat from './views/Chat';
import Documents from './views/Documents';
import { initials } from '@/lib/client';
import type { BootstrapData, ViewKey } from '@/lib/types';
import type { ToastTone } from './types';

const navigation: Array<{
  key: ViewKey;
  label: string;
  shortLabel: string;
  description: string;
  icon: typeof House;
}> = [
  { key: 'home', label: '行动首页', shortLabel: '首页', description: '今天先做什么', icon: House },
  { key: 'cases', label: '案件追踪', shortLabel: '案件', description: '进度与下一步', icon: ClipboardList },
  { key: 'evidence', label: '证据管家', shortLabel: '证据', description: '材料归档', icon: Folder },
  { key: 'chat', label: '权益助手', shortLabel: '咨询', description: '规则路径初筛', icon: UserRound },
  { key: 'documents', label: '文书工作台', shortLabel: '文书', description: '草稿与导出', icon: FileText },
];

type ToastState = { id: number; message: string; tone: ToastTone } | null;

export default function AnxinApp() {
  const router = useRouter();
  const [data, setData] = useState<BootstrapData | null>(null);
  const [view, setView] = useState<ViewKey>('home');
  const [activeCaseId, setActiveCaseId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mobileMenu, setMobileMenu] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch('/api/bootstrap', { cache: 'no-store' });
        if (response.status === 401) {
          router.push('/signin-with-chatgpt?return_to=%2F');
          return;
        }
        const body = (await response.json().catch(() => ({}))) as BootstrapData & { error?: string };
        if (!response.ok) throw new Error(body.error || '无法读取数据。');
        if (cancelled) return;
        setData(body);
        setActiveCaseId((current) => body.cases.some((item) => item.id === current) ? current : body.cases[0]?.id ?? '');
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : '暂时无法打开工作台。');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [loadAttempt, router]);

  useEffect(() => {
    const applyHash = () => {
      const candidate = window.location.hash.replace('#', '') as ViewKey;
      if (navigation.some((item) => item.key === candidate)) setView(candidate);
    };
    applyHash();
    window.addEventListener('hashchange', applyHash);
    return () => window.removeEventListener('hashchange', applyHash);
  }, []);

  const notify = useCallback((message: string, tone: ToastTone = 'success') => {
    const id = Date.now();
    setToast({ id, message, tone });
    window.setTimeout(() => setToast((current) => current?.id === id ? null : current), 3400);
  }, []);

  const navigate = useCallback((nextView: ViewKey) => {
    setView(nextView);
    setMobileMenu(false);
    if (window.location.hash !== `#${nextView}`) window.history.pushState(null, '', `#${nextView}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const currentNav = navigation.find((item) => item.key === view) ?? navigation[0];
  const activeCase = useMemo(
    () => data?.cases.find((item) => item.id === activeCaseId),
    [data?.cases, activeCaseId],
  );

  if (loading) return <LoadingScreen />;
  if (error || !data) return (
    <ErrorScreen
      message={error}
      retry={() => {
        setLoading(true);
        setError('');
        setLoadAttempt((current) => current + 1);
      }}
    />
  );

  const directEntry = data.synthetic?.directEntry === true;
  const shared = {
    data,
    setData,
    activeCaseId,
    setActiveCaseId,
    navigate,
    notify,
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileMenu ? 'mobile-open' : ''}`}>
        <div className="brand-block">
          <span className="brand-mark"><Scale size={23} /></span>
          <div><strong>安薪乐业</strong><span>劳动权益行动工作台</span></div>
          <button className="mobile-close icon-button" aria-label="关闭菜单" onClick={() => setMobileMenu(false)}><X size={20} /></button>
        </div>

        <nav className="side-nav" aria-label="主要导航">
          {navigation.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.key} className={view === item.key ? 'active' : ''} aria-current={view === item.key ? 'page' : undefined} onClick={() => navigate(item.key)}>
                <span className="nav-icon"><Icon size={20} /></span>
                <span><strong>{item.label}</strong><small>{item.description}</small></span>
              </button>
            );
          })}
        </nav>

        {!directEntry && <div className="sidebar-trust">
          <ShieldCheck size={20} />
          <div><strong>私有工作台</strong><span>资料按登录用户隔离</span></div>
        </div>}
        <div className="sidebar-profile">
          <span className="avatar">{initials(data.user.displayName)}</span>
          <div><strong>{data.user.displayName}</strong><span>{data.user.email}</span></div>
          {!directEntry && <a href="/signout-with-chatgpt?return_to=%2F" aria-label="退出登录"><LogOut size={17} /></a>}
        </div>
      </aside>

      {mobileMenu && <button className="menu-scrim" aria-label="关闭菜单" onClick={() => setMobileMenu(false)} />}

      <main className="main-shell">
        <header className="topbar">
          <button className="mobile-menu-button" aria-label="打开菜单" onClick={() => setMobileMenu(true)}><Menu size={21} /></button>
          <div className="mobile-brand"><span className="brand-mark small"><Scale size={18} /></span><strong>安薪乐业</strong></div>
          <div className="topbar-context">
            <span>{currentNav.label}</span>
            {activeCase && view !== 'home' && <><i /> <strong>{activeCase.company}</strong></>}
          </div>
          <div className="topbar-account"><span className="account-icon"><UserRound size={18} /></span><span>{data.user.displayName}</span></div>
        </header>

        {data.synthetic && !directEntry && (
          <section className="synthetic-notice" role="note" aria-label="合成验收环境提示">
            <strong>仅限合成数据 · HTTP 验收环境</strong>
            <span>HTTP 可被抓包或篡改，请勿输入真实资料或复用真实密码。截止：{new Date(data.synthetic.expiresAt).toLocaleString('zh-CN')}。</span>
          </section>
        )}

        <div className={`page-content page-${view}`}>
          {view === 'home' && <Dashboard {...shared} />}
          {view === 'cases' && <Cases {...shared} />}
          {view === 'evidence' && <Evidence {...shared} />}
          {view === 'chat' && <Chat {...shared} />}
          {view === 'documents' && <Documents {...shared} />}
        </div>

        <footer className="app-footer">
          <span>安薪乐业提供信息整理与办事辅助，不替代律师、仲裁机构或人社部门意见。</span>
          <a href="https://12333.gov.cn/" target="_blank" rel="noreferrer">官方 12333 服务平台</a>
        </footer>
      </main>

      <nav className="bottom-nav" aria-label="移动端主要导航">
        {navigation.map((item) => {
          const Icon = item.icon;
          return <button key={item.key} className={view === item.key ? 'active' : ''} aria-current={view === item.key ? 'page' : undefined} onClick={() => navigate(item.key)}><Icon size={20} /><span>{item.shortLabel}</span></button>;
        })}
      </nav>

      {toast && (
        <div className={`toast ${toast.tone}`} role="status">
          {toast.tone === 'success' ? <CheckCircle2 size={18} /> : toast.tone === 'error' ? <X size={18} /> : <ShieldCheck size={18} />}
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}

function LoadingScreen() {
  return (
    <main className="loading-screen">
      <span className="brand-mark large"><Scale size={29} /></span>
      <h1>安薪乐业</h1>
      <p>正在打开你的劳动权益工作台…</p>
      <div className="loading-bar"><i /></div>
    </main>
  );
}

function ErrorScreen({ message, retry }: { message: string; retry: () => void }) {
  return (
    <main className="loading-screen error-screen">
      <span className="brand-mark large"><ShieldCheck size={29} /></span>
      <h1>工作台暂时没有打开</h1>
      <p>{message || '请检查网络后重试。'}</p>
      <button className="button button-primary" onClick={retry}><RefreshCw size={17} />重新加载</button>
    </main>
  );
}
