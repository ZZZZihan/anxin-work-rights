'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { BookOpen, ExternalLink, Search } from 'lucide-react';
import type { KnowledgeSearch } from '@/lib/public-retrieval-types';

type KnowledgeResultsProps = { result: KnowledgeSearch };

function publicSourceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

function ResultList({ result, title }: { result: KnowledgeSearch; title: string }) {
  const topicLabels = { wage_arrears: '工资拖欠', employment_relationship: '劳动关系' };
  return (
    <div className="knowledge-result-list">
      <div className="knowledge-heading">
        <div><h3>{title}</h3><p>检索词：{result.query || '未提取到检索词'}</p></div>
        <span className="knowledge-count">{result.hits.length} 条关联结果</span>
      </div>
      {result.expandedTerms.length > 0 && <p className="knowledge-terms">相关词：{result.expandedTerms.join('、')}</p>}
      <p className="knowledge-method">本地关键词与主题检索 · 资料版本 <code title={result.fingerprint}>{result.fingerprint.slice(0, 12)}</code></p>
      {result.hits.length === 0 && (
        <div className="knowledge-empty"><BookOpen size={22} /><p>当前资料库没有匹配结果。可以补充具体事实或更换检索词，未匹配不表示没有相关权利。</p></div>
      )}
      {result.hits.map((hit) => (
        <details className="knowledge-card" key={hit.id}>
          <summary>
            <span className="knowledge-kind">{hit.kind === 'provision' ? '法条' : '案例'}</span>
            <span className="knowledge-card-title">{hit.title}<small>{hit.summary}</small></span>
            <span className="knowledge-expand">查看出处</span>
          </summary>
          <div className="knowledge-card-body">
            {hit.matchedTerms.length > 0 && <p className="knowledge-terms">匹配：{hit.matchedTerms.join('、')}</p>}
            {hit.topics.length > 0 && <p className="knowledge-terms">主题：{hit.topics.map((topic) => topicLabels[topic]).join('、')}</p>}
            {(hit.versionLabel || hit.articleLabel || hit.effectiveOn || hit.decisionDate) && <p className="knowledge-terms">{[hit.versionLabel, hit.articleLabel, hit.effectiveOn ? `施行：${hit.effectiveOn}` : '', hit.decisionDate ? `裁判日期：${hit.decisionDate}` : ''].filter(Boolean).join(' · ')}</p>}
            <p className="knowledge-version">{hit.versionNote || '请打开官方来源核对当前版本。'}<br />{hit.kind === 'provision' ? '条文版本及对当前事实的适用仍需核对。' : '案例中的事实和裁判条件需逐项比较，个案适用尚未确认。'}资料标注尚未经过法律专家复核。</p>
            {hit.citations.map((citation, index) => {
              const url = publicSourceUrl(citation.sourceUrl);
              return (
                <article className="knowledge-citation" key={`${citation.paragraphId}:${index}`}>
                  <div className="knowledge-citation-heading"><strong>来源段落 {citation.paragraphId}</strong><span>{citation.publisher}</span></div>
                  <blockquote>{citation.text}</blockquote>
                  <p className="knowledge-source-meta">{citation.sourceTitle} · 发布：{citation.publishedOn || '来源未注明'} · 收录：{citation.retrievedAt || '未注明'}</p>
                  {url ? <a className="knowledge-source-link" href={url} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} />查看官方原文</a> : <p className="knowledge-source-meta">当前来源链接不可用，请按来源标题核对。</p>}
                </article>
              );
            })}
            {hit.citations.length === 0 && <p className="knowledge-source-meta">此条结果暂无可显示的来源段落，请核对官方资料后再引用。</p>}
          </div>
        </details>
      ))}
    </div>
  );
}

export default function KnowledgeResults({ result }: KnowledgeResultsProps) {
  const [query, setQuery] = useState('');
  const [manualResult, setManualResult] = useState<KnowledgeSearch | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const mountedRef = useRef(false);
  const requestRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; requestRef.current?.abort(); };
  }, []);

  const search = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const terms = query.trim();
    if (terms.length < 2) { setError('请输入至少两个字的具体事实或关键词。'); return; }
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const generation = ++generationRef.current;
    setSearching(true);
    setError('');
    try {
      const response = await fetch(`/api/knowledge?query=${encodeURIComponent(terms)}`, { signal: controller.signal });
      const body = await response.json() as KnowledgeSearch & { error?: string };
      if (!response.ok) throw new Error(body.error || '检索暂时没有成功，请稍后重试。');
      if (mountedRef.current && generation === generationRef.current) setManualResult(body);
    } catch (failure) {
      if (mountedRef.current && !controller.signal.aborted && generation === generationRef.current) setError(failure instanceof Error ? failure.message : '检索失败。');
    } finally {
      if (mountedRef.current && generation === generationRef.current) setSearching(false);
    }
  };

  return (
    <section className="knowledge-section" aria-label="法条案例与来源">
      <div className="knowledge-section-title"><BookOpen size={20} /><div><h2>法条、案例与出处</h2><p>依据材料中的关键词关联公开资料，核对事实后再判断是否适用。</p></div></div>
      <ResultList result={result} title="材料关联结果" />
      <form className="knowledge-search-form" onSubmit={(event) => void search(event)}>
        <label htmlFor="material-knowledge-query">补充检索</label>
        <div className="knowledge-search-controls"><input id="material-knowledge-query" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={180} placeholder="例如：拖欠工资、未签合同、加班费" /><button className="button button-secondary" disabled={searching}><Search size={16} />{searching ? '正在检索…' : '检索公开资料'}</button></div>
        <p>补充检索会单独展示，不会改写已保存的材料识别结果。</p>
        {error && <p className="knowledge-error" role="alert">{error}</p>}
      </form>
      {manualResult && <ResultList result={manualResult} title="补充检索结果" />}
    </section>
  );
}
