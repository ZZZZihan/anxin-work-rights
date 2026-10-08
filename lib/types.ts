export type ViewKey = 'home' | 'cases' | 'evidence' | 'chat' | 'documents';

export type UserProfile = {
  userId: string;
  displayName: string;
  email: string;
};

export type WorkCase = {
  id: string;
  type: string;
  company: string;
  amount: number;
  status: 'collecting' | 'negotiating' | 'arbitration' | 'completed' | 'archived';
  currentStep: number;
  nextAction: string;
  deadline: string | null;
  location: string;
  description: string;
  createdAt: string;
  updatedAt: string;
};

export type EvidenceFile = {
  id: string;
  caseId: string;
  name: string;
  category: string;
  size: number;
  mimeType: string;
  status: 'uploaded' | 'needs_review' | 'example' | 'uploading' | 'upload_failed' | 'deleting';
  note: string;
  downloadable: boolean;
  uploadedAt: string;
};

export type LegalSource = {
  title: string;
  url: string;
  detail: string;
};

export type ChatMessage = {
  id: string;
  caseId: string;
  role: 'user' | 'assistant';
  content: string;
  sources: LegalSource[];
  createdAt: string;
};

export type DocumentDraft = {
  id: string;
  caseId: string;
  type: string;
  fields: Record<string, string>;
  revision: number;
  updatedAt: string;
};

export type BootstrapData = {
  synthetic?: { environmentId: string; expiresAt: string };
  user: UserProfile;
  cases: WorkCase[];
  archivedCases: WorkCase[];
  evidence: EvidenceFile[];
  messages: ChatMessage[];
  documents: DocumentDraft[];
};

export type LegalGuidance = {
  content: string;
  sources: LegalSource[];
};
