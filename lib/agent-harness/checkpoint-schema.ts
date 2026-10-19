// Explicit migrations own production DDL; local previews reuse these statements.
export const agentHarnessCheckpointMigration = '0006_agent_harness_checkpoints.sql';
export const agentHarnessCheckpointSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS agent_harness_checkpoints (
    owner_id TEXT NOT NULL,
    case_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    checkpoint_ns TEXT NOT NULL,
    checkpoint_id TEXT NOT NULL,
    parent_checkpoint_id TEXT,
    checkpoint_type TEXT NOT NULL,
    checkpoint BLOB NOT NULL,
    metadata_type TEXT NOT NULL,
    metadata BLOB NOT NULL,
    PRIMARY KEY (owner_id, case_id, run_id, checkpoint_ns, checkpoint_id)
  )`,
  `CREATE TABLE IF NOT EXISTS agent_harness_checkpoint_writes (
    owner_id TEXT NOT NULL,
    case_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    checkpoint_ns TEXT NOT NULL,
    checkpoint_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    write_index INTEGER NOT NULL,
    task_path TEXT NOT NULL,
    channel TEXT NOT NULL,
    value_type TEXT NOT NULL,
    value BLOB NOT NULL,
    PRIMARY KEY (owner_id, case_id, run_id, checkpoint_ns, checkpoint_id, task_id, write_index)
  )`,
];
