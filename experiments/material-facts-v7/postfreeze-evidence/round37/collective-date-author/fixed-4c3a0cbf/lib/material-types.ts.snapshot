import type { KnowledgeSearch } from './public-retrieval-types';

export type DocumentKind = 'contract' | 'wage_statement' | 'chat' | 'other';
export const documentKindLabels: Record<DocumentKind, string> = {
  contract: '劳动合同', wage_statement: '工资流水', chat: '聊天记录', other: '其他材料',
};

export type MaterialBlock = {
  id: string;
  page: number;
  text: string;
  /** Normalized [left, top, width, height], or null for text-only input. */
  bbox: [number, number, number, number] | null;
  confidence: number | null;
};

export type MaterialField = {
  id: string;
  key: string;
  label: string;
  value: string;
  extractedValue: string;
  quote: string;
  blockIds: string[];
  origin: 'model' | 'rule';
  review: 'pending' | 'confirmed' | 'corrected';
  confirmed: boolean;
};

export type MaterialResult = {
  engine: { ocr: string; structuring: 'local_vision_model' | 'local_text_model' | 'ocr_rules'; model: string | null; modelDigest?: string; imageCount?: number };
  pageCount: number;
  blocks: MaterialBlock[];
  fields: MaterialField[];
  warnings: string[];
  source: { evidenceId: string; name: string; sha256: string; mimeType: string };
  knowledge: KnowledgeSearch;
};

export type MaterialAnalysis = {
  evidenceId: string;
  documentKind: DocumentKind;
  status: 'running' | 'ready' | 'failed';
  revision: number;
  result: MaterialResult | null;
  error: string | null;
  updatedAt: string;
};

export type MaterialAnalysisResponse = {
  analysis: MaterialAnalysis | null;
  configured: boolean;
};
