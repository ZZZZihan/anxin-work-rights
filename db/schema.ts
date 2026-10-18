import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const profiles = sqliteTable('profiles', {
  userId: text('user_id').primaryKey(),
  displayName: text('display_name').notNull(),
  email: text('email').notNull(),
  seededAt: text('seeded_at').notNull(),
});

export const cases = sqliteTable(
  'cases',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    type: text('type').notNull(),
    company: text('company').notNull(),
    amount: integer('amount').notNull().default(0),
    status: text('status').notNull(),
    currentStep: integer('current_step').notNull().default(0),
    nextAction: text('next_action').notNull(),
    deadline: text('deadline'),
    location: text('location').notNull().default(''),
    description: text('description').notNull().default(''),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('cases_user_idx').on(table.userId)],
);

export const evidenceFiles = sqliteTable(
  'evidence_files',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    caseId: text('case_id').notNull(),
    name: text('name').notNull(),
    category: text('category').notNull(),
    size: integer('size').notNull().default(0),
    mimeType: text('mime_type').notNull(),
    status: text('status').notNull(),
    note: text('note').notNull().default(''),
    objectKey: text('object_key'),
    contentHash: text('content_hash'),
    uploadedAt: text('uploaded_at').notNull(),
  },
  (table) => [
    index('evidence_user_idx').on(table.userId),
    index('evidence_case_idx').on(table.caseId),
  ],
);

// Retained after the visible evidence row is removed so delayed uploads cannot
// reuse a cancelled operation UUID. The key also supports late-object cleanup.
export const evidenceUploadCancellations = sqliteTable('evidence_upload_cancellations', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  objectKey: text('object_key'),
  cancelledAt: text('cancelled_at').notNull(),
});

export const evidenceAnalyses = sqliteTable('evidence_analyses', {
  evidenceId: text('evidence_id').primaryKey(),
  userId: text('user_id').notNull(),
  contentHash: text('content_hash').notNull(),
  documentKind: text('document_kind').notNull(),
  status: text('status').notNull(),
  revision: integer('revision').notNull().default(1),
  runId: text('run_id').notNull(),
  jobId: text('job_id'),
  resultJson: text('result_json'),
  error: text('error'),
  startedAt: text('started_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [index('analyses_user_idx').on(table.userId)]);

export const caseMaterialGenerations = sqliteTable('case_material_generations', {
  caseId: text('case_id').primaryKey(),
  userId: text('user_id').notNull(),
  generation: integer('generation').notNull().default(1),
});

export const caseMaterialFacts = sqliteTable('case_material_facts', {
  caseId: text('case_id').primaryKey(),
  userId: text('user_id').notNull(),
  revision: integer('revision').notNull().default(1),
  stateJson: text('state_json').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [index('material_facts_user_idx').on(table.userId)]);

export const chatMessages = sqliteTable(
  'chat_messages',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    caseId: text('case_id').notNull(),
    role: text('role').notNull(),
    content: text('content').notNull(),
    sourcesJson: text('sources_json').notNull().default('[]'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('chat_user_idx').on(table.userId),
    index('chat_case_idx').on(table.caseId),
  ],
);

export const documentDrafts = sqliteTable(
  'document_drafts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    caseId: text('case_id').notNull(),
    type: text('type').notNull(),
    fieldsJson: text('fields_json').notNull(),
    revision: integer('revision').notNull().default(1),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('documents_user_idx').on(table.userId),
    index('documents_case_idx').on(table.caseId),
    uniqueIndex('documents_owner_case_type_idx').on(table.userId, table.caseId, table.type),
  ],
);
