/** Server-side entry point. Client components import public-retrieval-types only. */
import knowledge from './generated/public-knowledge.json';
import type {
  KnowledgeCitation,
  KnowledgeHit,
  KnowledgeSearch,
  KnowledgeSearchOptions,
  KnowledgeTopic,
} from './public-retrieval-types';

export type {
  KnowledgeCitation,
  KnowledgeHit,
  KnowledgeSearch,
  KnowledgeSearchOptions,
  KnowledgeTopic,
} from './public-retrieval-types';

type Section = { field: string; text: string };
type IndexedDocument = {
  id: string;
  kind: 'case' | 'provision';
  title: string;
  sourceId: string;
  refs: string[];
  topics: KnowledgeTopic[];
  tags: string[];
  sections: Section[];
  outcome?: string;
  versionNote: string;
  versionLabel?: string;
  articleLabel?: string;
  effectiveOn?: string | null;
  expiresOn?: string | null;
  region?: string | null;
  decisionDate?: string | null;
  annotationStatus: 'agent_curated_not_legal_expert_reviewed';
};
type IndexedSource = {
  id: string;
  title: string;
  url: string;
  publisher: string;
  publishedOn: string | null;
  retrievedAt: string;
  paragraphs: { id: string; text: string }[];
};
type Index = { fingerprint: string; sources: IndexedSource[]; documents: IndexedDocument[] };
type Concept = { label: string; aliases: string[]; terms: string[]; topic?: KnowledgeTopic };

const index = knowledge as Index;
const sources = new Map(index.sources.map((source) => [source.id, source]));
const paragraphMaps = new Map(index.sources.map((source) => [
  source.id, new Map(source.paragraphs.map((paragraph) => [paragraph.id, paragraph.text])),
]));

// Finite labor-law vocabulary. Personal names, company names, amounts and arbitrary
// words are never search terms. Expansion improves recall; it is not legal inference.
const concepts: Concept[] = [
  { label: '欠薪', aliases: ['欠薪', '欠工资', '拖欠', '欠发', '未足额', '不发工资'], terms: ['欠薪', '拖欠', '欠付', '欠发', '未足额'], topic: 'wage_arrears' },
  { label: '工资', aliases: ['工资', '薪资', '薪水', '月薪', '劳动报酬', '劳务报酬'], terms: ['工资', '劳动报酬', '劳务报酬'], topic: 'wage_arrears' },
  { label: '工资支付记录', aliases: ['工资流水', '银行流水', '流水', '转账', '工资条', '支付凭证', '工资台账', '工资记录'], terms: ['转账', '支付凭证', '支付记录', '工资发放', '发放花名册', '工资台账', '个人账户'] },
  { label: '未签劳动合同', aliases: ['没签', '未签', '没合同', '没有合同', '未订立', '未签订'], terms: ['未订立', '未签订', '未与', '书面劳动合同'], topic: 'employment_relationship' },
  { label: '劳动合同', aliases: ['劳动合同', '劳务合同'], terms: ['劳动合同', '劳务合同'], topic: 'employment_relationship' },
  { label: '劳动关系', aliases: ['劳动关系', '劳务关系', '混同用工', '关联企业', '确认用工'], terms: ['劳动关系', '用工', '关联企业', '混同'], topic: 'employment_relationship' },
  { label: '合作协议', aliases: ['合作协议', '承包协议', '外包', '挂靠', '劳务公司'], terms: ['合作协议', '承包协议', '外包', '挂靠', '劳务公司'], topic: 'employment_relationship' },
  { label: '考勤管理', aliases: ['考勤', '打卡', '签到', '排班', '出勤', '实际管理', '劳动管理'], terms: ['考勤', '签到', '出勤', '劳动管理', '工作制度', '管理规则'], topic: 'employment_relationship' },
  { label: '工作聊天记录', aliases: ['聊天', '微信', '工作群', '群聊', 'qq'], terms: ['聊天', '微信', 'qq', '工作沟通'] },
  { label: '平台接单', aliases: ['骑手', '配送员', '司机', '平台接单', '自主接单', '众包', '派单'], terms: ['骑手', '配送员', '司机', '自主', '众包', '派单'], topic: 'employment_relationship' },
  { label: '举证', aliases: ['举证', '证据', '证明材料'], terms: ['举证', '证据', '凭证', '证言'] },
  { label: '仲裁时效', aliases: ['仲裁时效', '申请期限', '一年时效', '时效'], terms: ['仲裁时效', '时效', '一年'] },
  { label: '劳动仲裁', aliases: ['劳动仲裁', '劳动争议仲裁', '仲裁申请'], terms: ['仲裁', '劳动争议'] },
  { label: '劳动争议调解仲裁法', aliases: ['劳动争议调解仲裁法', '劳动仲裁法', '仲裁法'], terms: ['劳动争议调解仲裁法'] },
  { label: '劳动争议司法解释', aliases: ['劳动争议司法解释', '劳动争议案件适用法律', '劳动争议解释'], terms: ['劳动争议案件适用法律问题的解释'] },
  { label: '劳动法', aliases: ['劳动法'], terms: ['劳动法'] },
  { label: '二倍工资', aliases: ['二倍工资', '双倍工资'], terms: ['二倍工资', '书面劳动合同'], topic: 'employment_relationship' },
  { label: '欠条', aliases: ['工资欠条', '欠条'], terms: ['工资欠条', '欠条'], topic: 'wage_arrears' },
];

function recognizedQuery(raw: string): { labels: string[]; terms: string[]; topics: KnowledgeTopic[]; articles: string[] } {
  if (typeof raw === 'string' && raw.length > 60000) {
    throw new RangeError('检索材料最多支持 60000 字，请拆分材料后再查询。');
  }
  const text = (typeof raw === 'string' ? raw : '')
    .replace(/https?:\/\/[^\s<>]+/gi, ' ')
    .replace(/[a-z0-9._%+-]{1,254}@[a-z0-9.-]{1,253}\.[a-z]{2,63}/gi, ' ')
    .toLocaleLowerCase('zh-CN');
  const found = concepts.filter((concept) => concept.aliases.some((alias) => text.includes(alias)));
  // Article labels are accepted only alongside a recognized labor-law concept.
  const articles = found.length ? [...text.matchAll(/第[〇零一二三四五六七八九十百千万两0-9]{1,10}条/g)].map((match) => match[0]) : [];
  return {
    labels: [...new Set([...found.map((concept) => concept.label), ...articles])],
    terms: [...new Set([...found.flatMap((concept) => concept.terms), ...articles])],
    topics: [...new Set(found.flatMap((concept) => concept.topic ? [concept.topic] : []))],
    articles,
  };
}

const fieldWeights: Record<string, number> = {
  facts: 4, claims: 3, issues: 4, reasoning: 2, evidence: 5, outcome: 2, text: 4,
};

function rank(document: IndexedDocument, terms: string[]) {
  const fields = [
    { text: document.title, weight: 8 },
    { text: document.tags.join(' '), weight: 6 },
    ...document.sections.map((section) => ({ text: section.text, weight: fieldWeights[section.field] ?? 1 })),
  ].map((field) => ({ ...field, text: field.text.toLocaleLowerCase('zh-CN') }));
  const matchedTerms = terms.filter((term) => fields.some((field) => field.text.includes(term)));
  const score = fields.reduce((total, field) => total + matchedTerms.reduce(
    (sum, term) => sum + (field.text.includes(term) ? field.weight : 0), 0,
  ), 0);
  return { score, matchedTerms };
}

function excerpt(text: string, limit: number): string {
  return text.length <= limit ? text : text.slice(0, limit) + '…';
}

function toHit(document: IndexedDocument, terms: string[]): KnowledgeHit | null {
  const source = sources.get(document.sourceId);
  const paragraphs = paragraphMaps.get(document.sourceId);
  if (!source || !paragraphs || document.refs.some((ref) => !paragraphs.has(ref))) return null;
  const citations: KnowledgeCitation[] = document.refs.map((paragraphId) => ({
    paragraphId,
    text: paragraphs.get(paragraphId)!,
    sourceUrl: source.url,
    sourceTitle: source.title,
    sourceId: source.id,
    publisher: source.publisher,
    publishedOn: source.publishedOn,
    retrievedAt: source.retrievedAt,
  }));
  const mainSection = document.sections.filter((section) => section.field !== 'outcome')
    .map((section, ordinal) => ({ section, ordinal, score: terms.filter((term) => section.text.toLocaleLowerCase('zh-CN').includes(term)).length }))
    .sort((a, b) => b.score - a.score || a.ordinal - b.ordinal)[0]?.section;
  const summary = document.kind === 'provision'
    ? excerpt(mainSection?.text ?? '', 440)
    : [excerpt(mainSection?.text ?? '', 300), document.outcome ? `原文结果：${excerpt(document.outcome, 200)}` : ''].filter(Boolean).join('\n');
  return {
    id: document.id,
    kind: document.kind,
    title: document.title,
    summary,
    matchedTerms: [...terms],
    topics: [...document.topics],
    citations,
    versionNote: document.versionNote,
    annotationStatus: document.annotationStatus,
    ...(document.kind === 'case' ? { region: document.region ?? null, decisionDate: document.decisionDate ?? null } : {
      versionLabel: document.versionLabel,
      articleLabel: document.articleLabel,
      effectiveOn: document.effectiveOn ?? null,
      expiresOn: document.expiresOn ?? null,
    }),
  };
}

export function searchPublicKnowledge(query: string, options: KnowledgeSearchOptions = {}): KnowledgeSearch {
  const recognized = recognizedQuery(query);
  const result: KnowledgeSearch = {
    method: 'deterministic_keyword_topic_v1',
    fingerprint: index.fingerprint,
    query: recognized.labels.join(' '),
    expandedTerms: recognized.terms,
    hits: [],
  };
  if (!recognized.terms.length) return result;
  if (options.topic && !['wage_arrears', 'employment_relationship'].includes(options.topic)) return result;
  const limit = Number.isFinite(options.limit) ? Math.min(20, Math.max(1, Math.floor(options.limit!))) : 6;
  const candidates = index.documents
    .filter((document) => !options.topic || document.topics.includes(options.topic))
    .filter((document) => !recognized.articles.length || recognized.articles.some((article) =>
      [document.title, ...document.sections.map((section) => section.text)].some((text) => text.includes(article))))
    .map((document) => {
      const ranked = rank(document, recognized.terms);
      const topicBonus = ranked.score && document.topics.some((topic) => recognized.topics.includes(topic)) ? 3 : 0;
      return { document, ...ranked, score: ranked.score + topicBonus };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || (a.document.id < b.document.id ? -1 : a.document.id > b.document.id ? 1 : 0));
  const queues = {
    case: candidates.filter((candidate) => candidate.document.kind === 'case'),
    provision: candidates.filter((candidate) => candidate.document.kind === 'provision'),
  };
  // Keep both available document kinds visible without manufacturing an empty-kind fallback.
  let nextKind: 'case' | 'provision' = candidates[0]?.document.kind ?? 'case';
  while (result.hits.length < limit && (queues.case.length || queues.provision.length)) {
    const candidate = queues[nextKind].shift() ?? queues[nextKind === 'case' ? 'provision' : 'case'].shift();
    if (candidate) {
      const hit = toHit(candidate.document, candidate.matchedTerms);
      if (hit) result.hits.push(hit);
    }
    nextKind = nextKind === 'case' ? 'provision' : 'case';
  }
  return result;
}

/** Exact ID lookup for an authenticated route displaying saved public citations. */
export function getPublicKnowledgeRecord(id: string): KnowledgeHit | null {
  const document = index.documents.find((record) => record.id === id);
  return document ? toHit(document, []) : null;
}
