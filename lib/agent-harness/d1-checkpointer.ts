import type { RunnableConfig } from '@langchain/core/runnables';
import {
  BaseCheckpointSaver,
  WRITES_IDX_MAP,
  compareWritesSortKeys,
  copyCheckpoint,
  getCheckpointId,
  maxChannelVersion,
  TASKS,
  writesSortKey,
  type ChannelVersions,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointPendingWrite,
  type CheckpointTuple,
  type PendingWrite,
  type SerializerProtocol,
} from '@langchain/langgraph-checkpoint';

export interface D1CheckpointScope {
  ownerId: string;
  caseId: string;
  runId: string;
}

type BlobValue = ArrayBuffer | Uint8Array | number[];
interface CheckpointRow {
  checkpoint_ns: string;
  checkpoint_id: string;
  parent_checkpoint_id: string | null;
  checkpoint_type: string;
  checkpoint: BlobValue;
  metadata_type: string;
  metadata: BlobValue;
}
interface WriteRow {
  task_id: string;
  write_index: number;
  task_path: string;
  channel: string;
  value_type: string;
  value: BlobValue;
}

const scopeSql = 'owner_id = ? AND case_id = ? AND run_id = ?';
const checkpointKey = 'owner_id, case_id, run_id, checkpoint_ns, checkpoint_id';
const writeKey = `${checkpointKey}, task_id, write_index`;

function identifier(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    throw new Error(`${field} must be ${allowEmpty ? 'a' : 'a non-empty'} string.`);
  }
  return value;
}

function bytes(value: BlobValue): Uint8Array {
  return value instanceof ArrayBuffer ? new Uint8Array(value) : Uint8Array.from(value);
}

// D1 accepts ArrayBuffers. Copying also removes a Uint8Array's offset and length.
function binding(value: Uint8Array): ArrayBuffer {
  return Uint8Array.from(value).buffer;
}

function assertSuccess(result: D1Result, operation: string): void {
  if (!result.success) throw new Error(`D1 checkpoint ${operation} failed: ${result.error ?? 'unknown error'}`);
}

function configuredCheckpointId(config: RunnableConfig): string | undefined {
  for (const field of ['checkpoint_id', 'thread_ts']) {
    const value: unknown = config.configurable?.[field];
    if (value !== undefined && value !== null) identifier(value, field, true);
  }
  return getCheckpointId(config) || undefined;
}

/**
 * A saver for one authenticated server-selected owner/case/run scope.
 * Construct it only after application ownership and version checks. Configurable
 * owner/case fields are never used as authority. This storage adapter neither
 * authorizes business actions nor serializes concurrent graph invocations: the
 * caller must prevent competing invocations for the same run. A committed D1
 * batch is atomic; it does not make external tool effects exactly-once.
 *
 * Apply the checked-in migration explicitly before use; writes never auto-create
 * tables or fall back to in-memory storage when D1 or serialization fails.
 */
export class D1CheckpointSaver extends BaseCheckpointSaver {
  private readonly scope: Readonly<D1CheckpointScope>;

  constructor(
    private readonly db: D1Database,
    scope: D1CheckpointScope,
    serde?: SerializerProtocol,
  ) {
    super(serde);
    this.scope = Object.freeze({
      ownerId: identifier(scope.ownerId, 'scope.ownerId'),
      caseId: identifier(scope.caseId, 'scope.caseId'),
      runId: identifier(scope.runId, 'scope.runId'),
    });
  }

  private scopeBindings(): string[] {
    return [this.scope.ownerId, this.scope.caseId, this.scope.runId];
  }

  private validateConfig(config: RunnableConfig): { namespace: string; checkpointId?: string } {
    if (config.configurable?.thread_id !== this.scope.runId) {
      throw new Error('configurable.thread_id must match the trusted scope.runId.');
    }
    const namespace = identifier(config.configurable?.checkpoint_ns ?? '', 'checkpoint_ns', true);
    return { namespace, checkpointId: configuredCheckpointId(config) };
  }

  private config(namespace: string, checkpointId: string): RunnableConfig {
    return { configurable: {
      thread_id: this.scope.runId,
      checkpoint_ns: namespace,
      checkpoint_id: checkpointId,
    } };
  }

  private async readWrites(namespace: string, checkpointId: string): Promise<WriteRow[]> {
    const result = await this.db.prepare(`SELECT task_id, write_index, task_path, channel, value_type, value
      FROM agent_harness_checkpoint_writes WHERE ${scopeSql} AND checkpoint_ns = ? AND checkpoint_id = ?`)
      .bind(...this.scopeBindings(), namespace, checkpointId).all<WriteRow>();
    assertSuccess(result, 'read writes');
    return result.results.sort((a, b) => compareWritesSortKeys(
      writesSortKey(a.task_path, a.task_id, a.write_index),
      writesSortKey(b.task_path, b.task_id, b.write_index),
    ));
  }

  private async tuple(row: CheckpointRow, metadata?: CheckpointMetadata): Promise<CheckpointTuple> {
    const checkpoint = await this.serde.loadsTyped(row.checkpoint_type, bytes(row.checkpoint)) as Checkpoint;
    const savedMetadata = metadata ?? await this.serde.loadsTyped(row.metadata_type, bytes(row.metadata)) as CheckpointMetadata;
    const writes = await this.readWrites(row.checkpoint_ns, row.checkpoint_id);
    const pendingWrites: CheckpointPendingWrite[] = await Promise.all(writes.map(async (write) => [
      write.task_id, write.channel, await this.serde.loadsTyped(write.value_type, bytes(write.value)),
    ] as CheckpointPendingWrite));

    // LangGraph's pre-v4 format stored pending sends on the parent checkpoint.
    if (checkpoint.v < 4 && row.parent_checkpoint_id !== null) {
      const parentWrites = await this.readWrites(row.checkpoint_ns, row.parent_checkpoint_id);
      checkpoint.channel_values[TASKS] = await Promise.all(parentWrites.filter(write => write.channel === TASKS)
        .map(write => this.serde.loadsTyped(write.value_type, bytes(write.value))));
      checkpoint.channel_versions[TASKS] = Object.keys(checkpoint.channel_versions).length
        ? maxChannelVersion(...Object.values(checkpoint.channel_versions)) : this.getNextVersion(undefined);
    }

    return {
      config: this.config(row.checkpoint_ns, row.checkpoint_id),
      checkpoint,
      metadata: savedMetadata,
      pendingWrites,
      ...(row.parent_checkpoint_id === null ? {} : {
        parentConfig: this.config(row.checkpoint_ns, row.parent_checkpoint_id),
      }),
    };
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const { namespace, checkpointId } = this.validateConfig(config);
    const result = await this.db.prepare(`SELECT * FROM agent_harness_checkpoints
      WHERE ${scopeSql} AND checkpoint_ns = ?${checkpointId === undefined ? '' : ' AND checkpoint_id = ?'}
      ORDER BY checkpoint_id DESC LIMIT 1`)
      .bind(...this.scopeBindings(), namespace, ...(checkpointId === undefined ? [] : [checkpointId]))
      .all<CheckpointRow>();
    assertSuccess(result, 'read checkpoint');
    return result.results[0] ? this.tuple(result.results[0]) : undefined;
  }

  async *list(config: RunnableConfig, options: CheckpointListOptions = {}): AsyncGenerator<CheckpointTuple> {
    const { namespace, checkpointId } = this.validateConfig(config);
    if (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit < 0)) {
      throw new Error('Checkpoint list limit must be a non-negative safe integer.');
    }
    const before = options.before;
    if (before?.configurable?.thread_id !== undefined && before.configurable.thread_id !== this.scope.runId) {
      throw new Error('Checkpoint list before must belong to the trusted scope.runId.');
    }
    const beforeId = before ? configuredCheckpointId(before) : undefined;
    if (options.limit === 0) return;
    const predicates = [scopeSql];
    const values = this.scopeBindings();
    // An omitted list namespace means all namespaces within this one scope.
    if (config.configurable?.checkpoint_ns !== undefined) {
      predicates.push('checkpoint_ns = ?'); values.push(namespace);
    }
    if (checkpointId !== undefined) {
      predicates.push('checkpoint_id = ?'); values.push(checkpointId);
    }
    if (beforeId) {
      predicates.push('checkpoint_id < ?'); values.push(beforeId);
    }
    const result = await this.db.prepare(`SELECT * FROM agent_harness_checkpoints
      WHERE ${predicates.join(' AND ')} ORDER BY checkpoint_id DESC, checkpoint_ns ASC`)
      .bind(...values).all<CheckpointRow>();
    assertSuccess(result, 'list checkpoints');
    let yielded = 0;
    for (const row of result.results) {
      const metadata = await this.serde.loadsTyped(row.metadata_type, bytes(row.metadata)) as CheckpointMetadata;
      // Match MemorySaver's metadata filter semantics, after deserialization.
      if (options.filter && !Object.entries(options.filter).every(([key, value]) =>
        (metadata as Record<string, unknown>)[key] === value)) continue;
      yield await this.tuple(row, metadata);
      yielded += 1;
      if (options.limit !== undefined && yielded >= options.limit) return;
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    newVersions: ChannelVersions,
  ): Promise<RunnableConfig> {
    const { namespace, checkpointId: parentId } = this.validateConfig(config);
    identifier(checkpoint.id, 'checkpoint.id');
    if (checkpoint.id === parentId) throw new Error('A checkpoint cannot be its own parent.');
    // Full snapshots preserve channel_values, channel_versions and versions_seen.
    // Unlike blob-per-channel savers no separate newVersions write is necessary.
    void newVersions;
    const [[checkpointType, checkpointBytes], [metadataType, metadataBytes]] = await Promise.all([
      this.serde.dumpsTyped(copyCheckpoint(checkpoint)), this.serde.dumpsTyped(metadata),
    ]);
    const result = await this.db.prepare(`INSERT INTO agent_harness_checkpoints
      (${checkpointKey}, parent_checkpoint_id, checkpoint_type, checkpoint, metadata_type, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (${checkpointKey}) DO UPDATE SET
      parent_checkpoint_id = excluded.parent_checkpoint_id, checkpoint_type = excluded.checkpoint_type,
      checkpoint = excluded.checkpoint, metadata_type = excluded.metadata_type, metadata = excluded.metadata`)
      .bind(...this.scopeBindings(), namespace, checkpoint.id, parentId ?? null,
        checkpointType, binding(checkpointBytes), metadataType, binding(metadataBytes)).run();
    assertSuccess(result, 'put checkpoint');
    return this.config(namespace, checkpoint.id);
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string, taskPath = ''): Promise<void> {
    const { namespace, checkpointId } = this.validateConfig(config);
    if (checkpointId === undefined) throw new Error('putWrites requires configurable.checkpoint_id.');
    identifier(taskId, 'taskId'); identifier(taskPath, 'taskPath', true);
    // Serialize everything first: a serializer failure cannot commit a prefix.
    const statements = await Promise.all(writes.map(async ([channel, value], index) => {
      identifier(channel, 'channel');
      const writeIndex = Object.hasOwn(WRITES_IDX_MAP, channel) ? WRITES_IDX_MAP[channel] : index;
      const [valueType, valueBytes] = await this.serde.dumpsTyped(value);
      const conflict = writeIndex < 0 ? `DO UPDATE SET task_path = excluded.task_path,
        channel = excluded.channel, value_type = excluded.value_type, value = excluded.value` : 'DO NOTHING';
      return this.db.prepare(`INSERT INTO agent_harness_checkpoint_writes
        (${writeKey}, task_path, channel, value_type, value) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (${writeKey}) ${conflict}`)
        .bind(...this.scopeBindings(), namespace, checkpointId, taskId, writeIndex, taskPath,
          channel, valueType, binding(valueBytes));
    }));
    if (statements.length === 0) return;
    const results = await this.db.batch(statements);
    if (results.length !== statements.length) throw new Error('D1 checkpoint put writes returned an incomplete batch.');
    results.forEach(result => assertSuccess(result, 'put writes'));
  }

  async deleteThread(threadId: string): Promise<void> {
    if (threadId !== this.scope.runId) throw new Error('deleteThread must match the trusted scope.runId.');
    const results = await this.db.batch([
      this.db.prepare(`DELETE FROM agent_harness_checkpoint_writes WHERE ${scopeSql}`).bind(...this.scopeBindings()),
      this.db.prepare(`DELETE FROM agent_harness_checkpoints WHERE ${scopeSql}`).bind(...this.scopeBindings()),
    ]);
    if (results.length !== 2) throw new Error('D1 checkpoint delete returned an incomplete batch.');
    results.forEach(result => assertSuccess(result, 'delete thread'));
  }
}
