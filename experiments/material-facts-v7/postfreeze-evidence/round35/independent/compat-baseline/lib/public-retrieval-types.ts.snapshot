/** Public, serializable contracts. This file never imports the knowledge index. */
export type KnowledgeTopic = 'wage_arrears' | 'employment_relationship';

export type KnowledgeCitation = {
  paragraphId: string;
  text: string;
  sourceUrl: string;
  sourceTitle: string;
  sourceId: string;
  publisher: string;
  publishedOn: string | null;
  retrievedAt: string;
};

export type KnowledgeHit = {
  id: string;
  kind: 'case' | 'provision';
  title: string;
  summary: string;
  matchedTerms: string[];
  topics: KnowledgeTopic[];
  citations: KnowledgeCitation[];
  versionNote: string;
  versionLabel?: string;
  articleLabel?: string;
  effectiveOn?: string | null;
  expiresOn?: string | null;
  region?: string | null;
  decisionDate?: string | null;
  annotationStatus: 'agent_curated_not_legal_expert_reviewed';
};

export type KnowledgeSearch = {
  method: 'deterministic_keyword_topic_v1';
  fingerprint: string;
  /** Recognized legal concepts only; never the original uploaded material. */
  query: string;
  expandedTerms: string[];
  hits: KnowledgeHit[];
};

export type KnowledgeSearchOptions = {
  topic?: KnowledgeTopic;
  /** Total result limit, default 6, clamped to 1..20. */
  limit?: number;
};
