export const materialSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS evidence_analyses (
    evidence_id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    document_kind TEXT NOT NULL,
    status TEXT NOT NULL,
    revision INTEGER DEFAULT 1 NOT NULL,
    run_id TEXT NOT NULL,
    job_id TEXT,
    result_json TEXT,
    error TEXT,
    started_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS analyses_user_idx ON evidence_analyses (user_id)',
];
