'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  BookOpenCheck,
  BriefcaseBusiness,
  ExternalLink,
  Info,
  MessageCircleMore,
  Plus,
  Scale,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { apiRequest } from '@/lib/client';
import { LEGAL_REVIEWED_AT, QUICK_QUESTIONS } from '@/lib/legal';
import type { ChatMessage } from '@/lib/types';
import type { SharedViewProps } from '../types';

export default function Chat({
  data,
  setData,
  activeCaseId,
  setActiveCaseId,
  navigate,
  notify,
}: SharedViewProps) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const activeCase = data.cases.find((item) => item.id === activeCaseId) ?? data.cases[0];
  const messages = data.messages.filter((item) => item.caseId === activeCase?.id);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages.length, sending]);

  const send = async (event?: FormEvent, suggested?: string) => {
    event?.preventDefault();
    const message = (suggested ?? input).trim();
    if (!message || !activeCase || sending) return;
    setSending(true);
    setInput('');
    try {
      const result = await apiRequest<{ messages: ChatMessage[] }>('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId: activeCase.id, message }),
      });
      setData((current) => current ? {
        ...current,
        messages: [...current.messages, ...result.messages],
      } : current);
    } catch (error) {
      setInput(message);
      notify(error instanceof Error ? error.message : '暂时无法回复。', 'error');
    } finally {
      setSending(false);
    }
  };

  if (!activeCase) {
    return (
      <section className="workspace-view chat-view panel empty-panel standalone-empty">
        <MessageCircleMore size={30} /><h1>先创建一个案件</h1><p>咨询记录会和具体案件关联，避免不同事实相互混淆。</p>
        <button className="button button-primary" onClick={() => navigate('cases')}><Plus size={17} />创建案件</button>
      </section>
    );
  }

  return (
    <div className="workspace-view chat-view chat-page">
      <section className="chat-main panel">
        <header className="chat-header">
          <div className="assistant-identity">
            <span className="assistant-mark"><Scale size={22} /></span>
            <div><h1>劳动权益助手</h1><span><i />规则库初筛 · 来源可追溯</span></div>
          </div>
          <label className="case-switcher compact-switcher">
            <span>围绕案件</span>
            <select value={activeCase.id} disabled={sending} onChange={(event) => setActiveCaseId(event.target.value)}>
              {data.cases.map((item) => <option key={item.id} value={item.id}>{item.company} · {item.type}</option>)}
            </select>
          </label>
        </header>

        <div className="chat-boundary">
          <Info size={16} />
          <span>当前回复来自经过整理的规则路径，不替代律师意见，也不预测案件结果。具体时效和地区口径请向官方机构核实。</span>
        </div>

        <div className="message-stream" aria-live="polite">
          <article className="message assistant-message">
            <span className="message-avatar"><Sparkles size={17} /></span>
            <div className="message-content">
              <p>你好，我会围绕当前案件，帮你把问题拆成事实时间线、证据缺口和可执行的下一步。你可以直接描述发生了什么。</p>
              {!messages.length && (
                <div className="quick-questions">
                  {QUICK_QUESTIONS.map((question) => (
                    <button key={question} onClick={() => void send(undefined, question)}>{question}</button>
                  ))}
                </div>
              )}
            </div>
          </article>

          {messages.map((message) => (
            <article key={message.id} className={`message ${message.role === 'assistant' ? 'assistant-message' : 'user-message'}`}>
              {message.role === 'assistant' && <span className="message-avatar"><Scale size={17} /></span>}
              <div className="message-content">
                <p>{message.content}</p>
                {!!message.sources.length && (
                  <div className="source-cards">
                    <span className="source-cards-label"><BookOpenCheck size={15} />本次引用</span>
                    {message.sources.map((source) => (
                      <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
                        <span><strong>{source.title}</strong><small>{source.detail}</small></span>
                        <ExternalLink size={15} />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </article>
          ))}

          {sending && (
            <article className="message assistant-message">
              <span className="message-avatar"><Scale size={17} /></span>
              <div className="message-content typing"><i /><i /><i /><span className="sr-only">正在整理回复</span></div>
            </article>
          )}
          <div ref={endRef} />
        </div>

        <form className="chat-composer" onSubmit={(event) => void send(event)}>
          <label>
            <span className="sr-only">输入你的劳动权益问题</span>
            <textarea
              rows={2}
              disabled={sending}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              placeholder="描述发生了什么，或告诉我你缺少哪些材料…"
              maxLength={2000}
            />
          </label>
          <button aria-label="发送问题" disabled={sending || !input.trim()}><ArrowUp size={19} /></button>
          <small>Enter 发送 · Shift + Enter 换行</small>
        </form>
      </section>

      <aside className="chat-context">
        <section className="panel case-context-card">
          <span className="eyebrow">当前案件</span>
          <span className="context-icon"><BriefcaseBusiness size={20} /></span>
          <h2>{activeCase.company}</h2>
          <p>{activeCase.type}</p>
          <dl>
            <div><dt>下一步</dt><dd>{activeCase.nextAction}</dd></div>
            <div><dt>事实摘要</dt><dd>{activeCase.description || '待补充'}</dd></div>
          </dl>
          <button className="button button-secondary button-full" onClick={() => navigate('cases')}>查看案件详情</button>
        </section>

        <section className="panel trust-card">
          <ShieldCheck size={23} />
          <div><strong>信息边界清楚</strong><p>不展示虚构胜率，不把规则提示写成确定结论。</p></div>
          <small>规则内容复核于 {LEGAL_REVIEWED_AT}</small>
        </section>
      </aside>
    </div>
  );
}
