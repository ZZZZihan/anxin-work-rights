// Real disposable D1 storage; fixtures contain no case or model data.
import { readFileSync } from 'node:fs';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RunnableConfig } from '@langchain/core/runnables';
import {
  ERROR, INTERRUPT, MemorySaver,
  type Checkpoint, type CheckpointMetadata, type CheckpointTuple, type SerializerProtocol,
} from '@langchain/langgraph-checkpoint';
import { agentHarnessCheckpointSchemaStatements } from './checkpoint-schema';
import { D1CheckpointSaver } from './d1-checkpointer';

let mf: Miniflare;
let db: D1Database;
const scope = { ownerId: 'synthetic-owner', caseId: 'synthetic-case', runId: 'synthetic-run' };
const config = (checkpointId?: string, namespace = ''): RunnableConfig => ({ configurable: {
  thread_id: scope.runId, checkpoint_ns: namespace,
  ...(checkpointId === undefined ? {} : { checkpoint_id: checkpointId }),
} });
const checkpoint = (id: string, channelValues: Record<string, unknown> = {}): Checkpoint => ({
  v: 4, id, ts: '2026-10-19T00:00:00.000Z', channel_values: channelValues,
  channel_versions: { value: 3, string_version: '0004' }, versions_seen: { node: { value: 2 } },
});
const metadata = (step = 0): CheckpointMetadata => ({ source: step === -1 ? 'input' : 'loop', step, parents: {} });
async function listed(saver: D1CheckpointSaver, cfg: RunnableConfig, options = {}) {
  const result: CheckpointTuple[] = [];
  for await (const tuple of saver.list(cfg, options)) result.push(tuple);
  return result;
}

describe('D1 LangGraph checkpoint persistence', () => {
  beforeAll(async () => {
    mf = new Miniflare(convertV4MiniflareOptions({
      modules: true, script: 'export default { fetch() { return new Response("synthetic checkpoint test"); } };',
      compatibilityDate: '2026-09-11', d1Databases: ['DB'],
    }));
    db = await mf.getD1Database('DB') as unknown as D1Database;
    const migration = readFileSync(new URL('../../drizzle/0006_agent_harness_checkpoints.sql', import.meta.url), 'utf8');
    await db.batch(migration.split('--> statement-breakpoint').filter(sql => sql.trim()).map(sql => db.prepare(sql)));
    // Both local-preview statements and the migration can describe the same DB.
    await db.batch(agentHarnessCheckpointSchemaStatements.map(sql => db.prepare(sql)));
  }, 30_000);
  beforeEach(async () => {
    await db.batch([
      db.prepare('DELETE FROM agent_harness_checkpoint_writes'),
      db.prepare('DELETE FROM agent_harness_checkpoints'),
    ]);
  });
  afterAll(async () => { await mf?.dispose(); }, 20_000);

  it('round trips snapshots, versions, metadata and binary through a newly constructed saver', async () => {
    const saver = new D1CheckpointSaver(db, scope);
    expect(await saver.getTuple(config())).toBeUndefined();
    const first = checkpoint('001', {
      value: '合成状态', bytes: new Uint8Array([0, 128, 255]),
      absent: undefined, set: new Set(['first', 'second']),
    });
    const saved = await saver.put(config(), first, metadata(-1), first.channel_versions);
    const reopened = new D1CheckpointSaver(db, scope);
    const tuple = await reopened.getTuple(config());
    expect(tuple).toMatchObject({ config: saved, checkpoint: first, metadata: metadata(-1), pendingWrites: [] });
    expect(tuple?.parentConfig).toBeUndefined();
    expect(tuple?.checkpoint.channel_values.bytes).toBeInstanceOf(Uint8Array);
    expect(tuple?.checkpoint.channel_values.set).toBeInstanceOf(Set);
    expect(reopened.getNextVersion(3)).toBe(4);
    expect(await reopened.get(saved)).toEqual(first);
  });

  it('persists serializer type tags and exact offset byte slices for checkpoints, metadata and writes', async () => {
    const base = new MemorySaver().serde;
    const serde: SerializerProtocol = {
      async dumpsTyped(data: unknown) {
        const [type, serialized] = await base.dumpsTyped(data);
        const padded = new Uint8Array(serialized.length + 3);
        padded.set(serialized, 2);
        const kind = data && typeof data === 'object' && 'channel_values' in data ? 'checkpoint'
          : data && typeof data === 'object' && 'source' in data ? 'metadata' : 'value';
        return [`custom/${kind}/${type}`, padded.subarray(2, 2 + serialized.length)];
      },
      async loadsTyped(type, data) {
        if (!type.startsWith('custom/')) throw new Error('lost custom serde type');
        return base.loadsTyped(type.slice(type.lastIndexOf('/') + 1), data);
      },
    };
    const saver = new D1CheckpointSaver(db, scope, serde);
    const saved = await saver.put(config(), checkpoint('001'), metadata(), {});
    await saver.putWrites(saved, [['bytes', new Uint8Array([0, 7, 128, 255])]], 'task');
    const reopened = new D1CheckpointSaver(db, scope, serde);
    expect((await reopened.getTuple(saved))?.pendingWrites).toEqual([
      ['task', 'bytes', new Uint8Array([0, 7, 128, 255])],
    ]);
    expect(await db.prepare('SELECT checkpoint_type, metadata_type FROM agent_harness_checkpoints').first())
      .toEqual({ checkpoint_type: 'custom/checkpoint/json', metadata_type: 'custom/metadata/json' });
    expect(await db.prepare('SELECT value_type, hex(value) AS bytes FROM agent_harness_checkpoint_writes').first())
      .toEqual({ value_type: 'custom/value/bytes', bytes: '000780FF' });
    expect((await listed(reopened, config()))[0].checkpoint.id).toBe('001');
  });

  it('isolates namespaces and lists newest first with before, metadata, ID and limit filters', async () => {
    const saver = new D1CheckpointSaver(db, scope);
    for (const [id, step] of [['002', 1], ['001', -1], ['003', 2]] as const) {
      await saver.put(config(), checkpoint(id), metadata(step), {});
    }
    await saver.put(config(undefined, 'child:synthetic'), checkpoint('004'), metadata(4), {});
    expect((await saver.getTuple(config()))?.checkpoint.id).toBe('003');
    expect((await saver.getTuple(config(undefined, 'child:synthetic')))?.checkpoint.id).toBe('004');
    expect((await listed(saver, config())).map(tuple => tuple.checkpoint.id)).toEqual(['003', '002', '001']);
    expect((await listed(saver, { configurable: { thread_id: scope.runId } })).map(tuple => tuple.checkpoint.id))
      .toEqual(['004', '003', '002', '001']);
    expect((await listed(saver, config(), { before: config('003'), limit: 1 })).map(tuple => tuple.checkpoint.id)).toEqual(['002']);
    expect((await listed(saver, config(), { filter: { source: 'input' }, limit: 1 })).map(tuple => tuple.checkpoint.id)).toEqual(['001']);
    expect((await listed(saver, config('002'))).map(tuple => tuple.checkpoint.id)).toEqual(['002']);
    expect(await listed(saver, config(), { limit: 0 })).toEqual([]);
    await expect(listed(saver, config(), { limit: -1 })).rejects.toThrow('limit');
    await expect(listed(saver, config(), { before: { configurable: { thread_id: 'foreign', checkpoint_id: '003' } } }))
      .rejects.toThrow('scope.runId');
  });

  it('replays writes by task path, task ID and numeric index while respecting reserved write replay rules', async () => {
    const saver = new D1CheckpointSaver(db, scope);
    const saved = await saver.put(config(), checkpoint('001'), metadata(), {});
    await saver.putWrites(saved, [['value', 'later-path']], 'a-task', 'z');
    await saver.putWrites(saved, [['value', 'astral']], 'astral-task', '😀');
    await saver.putWrites(saved, [['value', 'bmp']], 'bmp-task', '\ue000');
    await saver.putWrites(saved, [['value', 'path-first']], 'z-task', 'a');
    await saver.putWrites(saved, Array.from({ length: 12 }, (_, index): [string, number] => ['index', index]), 'numbers', 'b');
    await saver.putWrites(saved, [['value', 'first-success'], [ERROR, 'old-error'], [INTERRUPT, [{ id: 'pause' }]]], 'input');
    await saver.putWrites(saved, [['value', 'must-not-overwrite'], [ERROR, 'new-error']], 'input');
    const writes = (await new D1CheckpointSaver(db, scope).getTuple(saved))?.pendingWrites;
    expect(writes).toEqual([
      ['input', INTERRUPT, [{ id: 'pause' }]],
      ['input', ERROR, 'new-error'],
      ['input', 'value', 'first-success'],
      ['z-task', 'value', 'path-first'],
      ...Array.from({ length: 12 }, (_, index) => ['numbers', 'index', index]),
      ['a-task', 'value', 'later-path'],
      ['bmp-task', 'value', 'bmp'],
      ['astral-task', 'value', 'astral'],
    ]);
    expect((await listed(saver, config()))[0].pendingWrites).toEqual(writes);
    await saver.putWrites(saved, [['constructor', 'plain-channel']], 'reserved-looking-channel');
    expect((await saver.getTuple(saved))?.pendingWrites).toContainEqual(['reserved-looking-channel', 'constructor', 'plain-channel']);
  });

  it('preserves fork parent chains and reconstructs only on-path delta writes', async () => {
    const saver = new D1CheckpointSaver(db, scope);
    const root = await saver.put(config(), checkpoint('001', { delta: 'seed' }), metadata(-1), {});
    await saver.putWrites(root, [['delta', 'root-write']], 'root-task');
    const child = await saver.put(root, checkpoint('002'), metadata(1), {});
    await saver.putWrites(child, [['delta', 'child-write']], 'child-task');
    const unrelated = await saver.put(root, checkpoint('003'), metadata(2), {});
    await saver.putWrites(unrelated, [['delta', 'off-path']], 'unrelated-task');
    const fork = await saver.put(child, checkpoint('004'), metadata(3), {});
    await saver.putWrites(fork, [['delta', 'target-pending']], 'target-task');
    expect((await saver.getTuple(fork))?.parentConfig).toEqual(child);
    expect(await saver.getDeltaChannelHistory({ config: fork, channels: ['delta', 'missing'] })).toEqual({
      delta: { seed: 'seed', writes: [['root-task', 'delta', 'root-write'], ['child-task', 'delta', 'child-write']] },
      missing: { writes: [] },
    });
    await expect(saver.put(fork, checkpoint('004'), metadata(), {})).rejects.toThrow('own parent');
  });

  it('binds owner, case and run authority to constructor scope and deletes only that scope across namespaces', async () => {
    const saver = new D1CheckpointSaver(db, scope);
    const foreign = [
      { ...scope, ownerId: "other-owner'; DROP TABLE cases; --" },
      { ...scope, caseId: 'other-case' },
      { ...scope, runId: 'other-run' },
    ];
    for (const otherScope of foreign) {
      const other = new D1CheckpointSaver(db, otherScope);
      const saved = await other.put({ configurable: { thread_id: otherScope.runId } }, checkpoint('001', { owner: 'foreign' }), metadata(), {});
      await other.putWrites(saved, [['value', 'foreign-write']], 'task');
    }
    const forged = { configurable: { thread_id: scope.runId, ownerId: foreign[0].ownerId, caseId: foreign[1].caseId } };
    expect(await saver.getTuple(forged)).toBeUndefined();
    expect(await listed(saver, forged)).toEqual([]);
    const saved = await saver.put(forged, checkpoint('001', { owner: 'trusted' }), metadata(), {});
    await saver.putWrites(saved, [['value', 'trusted-write']], 'task');
    await saver.put(config(undefined, "ns'; SELECT 1; --"), checkpoint('002'), metadata(), {});
    await expect(saver.deleteThread('other-run')).rejects.toThrow('scope.runId');
    for (const bad of [{}, { configurable: { thread_id: 'other-run' } }]) {
      await expect(saver.getTuple(bad)).rejects.toThrow('scope.runId');
      await expect(listed(saver, bad)).rejects.toThrow('scope.runId');
      await expect(saver.put(bad, checkpoint('003'), metadata(), {})).rejects.toThrow('scope.runId');
      await expect(saver.putWrites(bad, [['value', 1]], 'task')).rejects.toThrow('scope.runId');
    }
    await expect(saver.putWrites(config(), [['value', 1]], 'task')).rejects.toThrow('checkpoint_id');
    await expect(saver.getTuple({ configurable: { thread_id: scope.runId, checkpoint_id: 0 } })).rejects.toThrow('checkpoint_id');
    await saver.deleteThread(scope.runId);
    expect(await listed(saver, { configurable: { thread_id: scope.runId } })).toEqual([]);
    expect(await db.prepare('SELECT COUNT(*) AS count FROM agent_harness_checkpoint_writes').first()).toEqual({ count: 3 });
    for (const otherScope of foreign) {
      expect((await new D1CheckpointSaver(db, otherScope).getTuple({ configurable: { thread_id: otherScope.runId } }))?.checkpoint.channel_values.owner)
        .toBe('foreign');
    }
  });

  it('rolls back failed write batches and propagates serialization, missing schema and corrupt type errors', async () => {
    const saver = new D1CheckpointSaver(db, scope);
    const saved = await saver.put(config(), checkpoint('001'), metadata(), {});
    await db.prepare(`CREATE TRIGGER synthetic_checkpoint_write_abort BEFORE INSERT ON agent_harness_checkpoint_writes
      WHEN NEW.channel = 'synthetic-abort' BEGIN SELECT RAISE(ABORT, 'synthetic D1 write failure'); END`).run();
    try {
      await expect(saver.putWrites(saved, [['value', 'must-roll-back'], ['synthetic-abort', 'failure']], 'task'))
        .rejects.toThrow('synthetic D1 write failure');
      expect((await saver.getTuple(saved))?.pendingWrites).toEqual([]);
    } finally { await db.prepare('DROP TRIGGER synthetic_checkpoint_write_abort').run(); }
    const base = new MemorySaver().serde;
    const failing = new D1CheckpointSaver(db, scope, {
      ...base,
      async dumpsTyped(value: unknown) {
        if (value === 'cannot serialize') throw new Error('synthetic serialization failure');
        return base.dumpsTyped(value);
      },
      loadsTyped: base.loadsTyped.bind(base),
    });
    await expect(failing.putWrites(saved, [['value', 'must-not-commit'], ['value', 'cannot serialize']], 'task'))
      .rejects.toThrow('synthetic serialization failure');
    expect((await saver.getTuple(saved))?.pendingWrites).toEqual([]);
    await db.prepare("UPDATE agent_harness_checkpoints SET checkpoint_type = 'corrupt-type'").run();
    await expect(saver.getTuple(saved)).rejects.toThrow('Unknown serialization type');
    await db.prepare('ALTER TABLE agent_harness_checkpoints RENAME TO synthetic_saved_checkpoints').run();
    try {
      await expect(saver.put(config(), checkpoint('002'), metadata(), {})).rejects.toThrow('no such table');
    } finally { await db.prepare('ALTER TABLE synthetic_saved_checkpoints RENAME TO agent_harness_checkpoints').run(); }
  });
});
