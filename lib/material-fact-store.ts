import type { RequestUser } from './auth';
import { getDatabase } from './server';
import { callMaterialService, materialServiceConfigured } from './material-service-client';
import { MaterialServiceHttpError } from './material-service-errors';
import { enqueueMaterialFactCleanup, retryMaterialFactCleanup } from './material-fact-cleanup';
import { reviewFactsAgainstSources } from './material-fact-source-review';
import { validateMaterialResult } from './material-validation';
import { applyFactAction, buildFactView, emptyFactState, prepareCalculation, synchronizeFacts, validateFactSource } from './material-facts-v3';
import { ingestRuntimeCandidates } from './material-fact-runtime-ingest';
import type { FactAction, FactSource } from './material-fact-types';
import type { RuntimeFactState as FactState, RuntimeMaterialFactsResponse as MaterialFactsResponse } from './material-fact-runtime-types';

type SessionRow = { case_id: string; user_id: string; revision: number; state_json: string };
type SourceRow = { id: string; name: string; content_hash: string | null; mime_type: string; status: string; object_key: string | null; analysis_hash: string | null; analysis_status: string | null; revision: number | null; result_json: string | null };
type Snapshot = { revision: number; generation: number; state: FactState; sources: FactSource[] };
export class FactStoreError extends Error { constructor(message: string, public status = 400) { super(message); } }
const conflict = () => new FactStoreError('材料或确认版本已变化，当前草稿未保存。请重新加载后再核对。', 409);
const now = () => new Date().toISOString();
function serializeStoredFactState(state: FactState): string {
  // Coverage from current source blocks is a response diagnostic, never a new
  // stored extraction or a migration of a historical v2 record.
  return JSON.stringify({ ...state, materials: state.materials.map(material => {
    const stored = { ...material } as typeof material & { sourceCoverage?: unknown };
    delete stored.sourceCoverage;
    return stored;
  }) });
}
const accessCondition = `EXISTS (SELECT 1 FROM cases c JOIN case_material_generations g ON g.case_id=c.id AND g.user_id=c.user_id
  WHERE c.id=case_material_facts.case_id AND c.user_id=case_material_facts.user_id AND c.status!='archived' AND g.generation=?)`;

function sourcesFromRows(rows: SourceRow[]): FactSource[] {
  return rows.map((row) => {
    const source: FactSource = { id: row.id, name: row.name, sha256: row.content_hash ?? '', analysisRevision: row.revision ?? 0, ready: false, blocks: [] };
    if (!['uploaded', 'needs_review'].includes(row.status) || !row.object_key || !row.content_hash || row.analysis_hash !== row.content_hash || row.analysis_status !== 'ready' || !row.result_json) return source;
    try {
      // Revalidate stored OCR boundaries. Old field-review checkboxes never
      // become amount confirmations, and the client cannot provide blocks.
      const parsed = JSON.parse(row.result_json);
      if (parsed?.source?.sha256 !== row.content_hash || parsed?.source?.evidenceId !== row.id) return source;
      const result = validateMaterialResult(parsed, { evidenceId: row.id, name: row.name, sha256: row.content_hash, mimeType: row.mime_type });
      source.blocks = result.blocks;
      source.ready = true;
    } catch { /* A malformed old analysis must remain an unresolved source. */ }
    return source;
  });
}

async function snapshot(user: RequestUser, id: string): Promise<Snapshot> {
  // D1 batch is a single database transaction; source enumeration and its
  // generation must describe the same snapshot, including new upload intents.
  const result = await getDatabase().batch([
    getDatabase().prepare(`SELECT g.generation FROM cases c JOIN case_material_generations g ON g.case_id=c.id AND g.user_id=c.user_id WHERE c.id=? AND c.user_id=? AND c.status!='archived'`).bind(id, user.userId),
    getDatabase().prepare('SELECT * FROM case_material_facts WHERE case_id=? AND user_id=?').bind(id, user.userId),
    getDatabase().prepare(`SELECT e.id,e.name,e.content_hash,e.mime_type,e.status,e.object_key,a.content_hash AS analysis_hash,a.status AS analysis_status,a.revision,a.result_json
      FROM evidence_files e LEFT JOIN evidence_analyses a ON a.evidence_id=e.id AND a.user_id=e.user_id
      WHERE e.case_id=? AND e.user_id=? ORDER BY e.uploaded_at,e.id`).bind(id, user.userId),
  ]);
  const owner = result[0].results[0] as { generation: number } | undefined;
  if (!owner) throw new FactStoreError('未找到可处理的案件，请确认案件属于你且未归档。', 404);
  const row = result[1].results[0] as SessionRow | undefined;
  let state = emptyFactState(owner.generation);
  if (row) {
    try { state = JSON.parse(row.state_json) as FactState; }
    catch { throw new FactStoreError('事实会话无法读取，请保留当前页面并联系维护者。', 503); }
  }
  const sources = sourcesFromRows(result[2].results as unknown as SourceRow[]);
  return { revision: row?.revision ?? 0, generation: owner.generation, state: reviewFactsAgainstSources(state, sources), sources };
}

async function save(user: RequestUser, id: string, current: Snapshot, state: FactState): Promise<boolean> {
  const json = serializeStoredFactState(state);
  if (current.revision === 0) {
    const result = await getDatabase().prepare(`INSERT INTO case_material_facts(case_id,user_id,revision,state_json,updated_at)
      SELECT ?,?,1,?,? WHERE EXISTS (SELECT 1 FROM cases c JOIN case_material_generations g ON g.case_id=c.id AND g.user_id=c.user_id
        WHERE c.id=? AND c.user_id=? AND c.status!='archived' AND g.generation=?)
      ON CONFLICT(case_id) DO NOTHING`).bind(id, user.userId, json, now(), id, user.userId, current.generation).run();
    return Boolean(result.meta.changes);
  }
  const result = await getDatabase().prepare(`UPDATE case_material_facts SET state_json=?,revision=revision+1,updated_at=?
    WHERE case_id=? AND user_id=? AND revision=? AND ${accessCondition}`)
    .bind(json, now(), id, user.userId, current.revision, current.generation).run();
  return Boolean(result.meta.changes);
}

async function settings(): Promise<{ backend: string; configured: boolean }> {
  if (!materialServiceConfigured()) return { backend: '未配置', configured: false };
  try {
    const health = await callMaterialService('/health');
    const capabilities = health.capabilities as Record<string, unknown> | undefined;
    return { backend: typeof capabilities?.factBackend === 'string' ? capabilities.factBackend : '未配置', configured: capabilities?.factConfigured === true };
  } catch { return { backend: '服务暂不可用', configured: false }; }
}

async function response(current: Snapshot, stale = false): Promise<MaterialFactsResponse> {
  current = { ...current, state: reviewFactsAgainstSources(current.state, current.sources) };
  return { revision: current.revision, generation: current.generation, stale, state: current.state,
    ...buildFactView(current.state, current.sources), sources: current.sources.map((source) => ({ id: source.id, name: source.name, sha256: source.sha256, analysisRevision: source.analysisRevision, ready: source.ready })), ...await settings() };
}

async function synchronized(user: RequestUser, id: string): Promise<Snapshot> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await snapshot(user, id);
    const state = synchronizeFacts(current.state, current.generation, current.sources);
    if (current.revision && JSON.stringify(state) === JSON.stringify(current.state)) return current;
    if (await save(user, id, current, state)) {
      if (current.state.job && !state.job) await cancelJob(user, id, current.state.job.id);
      return { ...current, state, revision: current.revision + 1 };
    }
  }
  throw conflict();
}

async function cancelJob(user: RequestUser, caseId: string, jobId: string) {
  if (jobId.startsWith('starting_')) return;
  // The DB trigger already captured replaced jobs. Explicit enqueue also covers
  // a service-created job whose late ID lost the generation/revision CAS.
  await enqueueMaterialFactCleanup(user.userId, caseId, jobId);
  await retryMaterialFactCleanup(user.userId, caseId);
}

// Three serial slots can each use the inference's ten-minute deadline. A
// temporary transport outage has its own shorter, consecutive recovery window.
const jobLifetimeMs = 31 * 60_000;
const pollRecoveryMs = 60_000;
function timestamp(value: string | undefined): number | null {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) && parsed <= Date.now() ? parsed : null;
}

async function persistPoll(user: RequestUser, id: string, current: Snapshot, state: FactState): Promise<Snapshot> {
  const active = current.state.job!;
  const changed = JSON.stringify(state) !== JSON.stringify(current.state);
  if (!changed || !await save(user, id, current, state)) {
    const latest = await snapshot(user, id);
    if (latest.generation !== current.generation || latest.state.generation !== current.generation) throw conflict();
    if (!changed && latest.revision === current.revision) return latest;
    const audit = latest.state.history.at(-1);
    const completed = !latest.state.job && audit?.type === 'candidates_extracted'
      && audit.id === (current.state.history.at(-1)?.id ?? 0) + 1
      && audit.actor === user.userId && audit.evidenceId === active.evidenceId;
    const failed = latest.state.job?.id === active.id && latest.state.job.status === 'failed'
      && latest.state.job.generation === active.generation;
    // Two readers may also race to record/clear the same transport warning.
    // Compare the entire state except those two poll-only metadata fields;
    // this must never swallow a user action or replacement extraction.
    const withoutWarning = (value: FactState) => JSON.stringify({ ...value,
      job: value.job ? { ...value.job, error: null, pollFailureSince: null } : null });
    const recovering = latest.state.job?.status === 'running'
      && (withoutWarning(latest.state) === withoutWarning(current.state)
        || (state.job?.status === 'running' && withoutWarning(latest.state) === withoutWarning(state)));
    if (latest.revision === current.revision + 1 && (completed || failed || recovering)) return latest;
    throw conflict();
  }
  if (!state.job || state.job.status === 'failed') await cancelJob(user, id, active.id);
  return { ...current, state, revision: current.revision + 1 };
}

async function poll(user: RequestUser, id: string, current: Snapshot): Promise<Snapshot> {
  const active = current.state.job;
  if (!active || active.status !== 'running' || active.generation !== current.generation) return current;
  const failedOutput: { raw?: string; backend?: string; model?: string | null } = {};
  const failed = (message: string): FactState => ({ ...current.state, job: { ...active, ...failedOutput, status: 'failed', error: message.slice(0, 500) } });
  const beganAt = timestamp(active.startedAt);
  if (beganAt !== null && Date.now() - beganAt >= jobLifetimeMs) {
    return persistPoll(user, id, current, failed('候选提取超过最长等待时间，请重新提取。'));
  }
  // Keep compatibility with previously persisted claims. New claims use a real
  // caller-generated UUID, so a lost POST response cannot hide the remote job.
  if (active.id.startsWith('starting_')) {
    const legacyStart = Number(active.id.split('_')[1]);
    if (Number.isSafeInteger(legacyStart) && Date.now() - legacyStart < pollRecoveryMs) return current;
    return persistPoll(user, id, current, failed('候选提取任务未能完成提交，请重新提取。'));
  }
  if (active.submissionPending && beganAt !== null && Date.now() - beganAt < pollRecoveryMs) return current;
  let job: Record<string, unknown>;
  try {
    job = await callMaterialService(`/fact-jobs/${encodeURIComponent(active.id)}`);
    if (!job || typeof job !== 'object' || Array.isArray(job) || typeof job.status !== 'string' || !['running', 'failed', 'ready'].includes(job.status)) throw new Error('无法确认任务状态');
    if (job.status === 'ready') {
      const result = job.result as Record<string, unknown> | undefined;
      if (typeof result?.raw === 'string') failedOutput.raw = result.raw;
      if (typeof result?.backend === 'string') failedOutput.backend = result.backend.slice(0, 160);
      if (typeof result?.model === 'string' || result?.model === null) failedOutput.model = result.model;
      if (typeof result?.raw !== 'string' || typeof result.backend !== 'string' || !result.backend || result.backend.length > 160 || (result.model !== null && typeof result.model !== 'string')) throw new Error('无法确认任务结果');
    }
  } catch {
    const since = timestamp(active.pollFailureSince) ?? Date.now();
    if (Date.now() - since >= pollRecoveryMs) return persistPoll(user, id, current, failed('连续一分钟未能读取候选任务，已停止本次等待，请重新提取。'));
    return persistPoll(user, id, current, { ...current.state, job: { ...active, ...failedOutput, pollFailureSince: new Date(since).toISOString(), error: '候选任务状态暂时无法读取，正在重试；请勿重复提取。' } });
  }
  if (job.status === 'running') {
    const resumed = { ...active, error: null };
    delete resumed.pollFailureSince;
    return persistPoll(user, id, current, { ...current.state, job: resumed });
  }
  if (job.status === 'failed') {
    const failure = job.error as { message?: unknown } | undefined;
    return persistPoll(user, id, current, failed(typeof failure?.message === 'string' ? failure.message : '候选提取失败，请重试。'));
  }
  let state: FactState;
  try {
    const result = job.result as { raw: string; backend: string; model: string | null; finish_reason?: unknown };
    failedOutput.raw = result.raw; failedOutput.backend = result.backend; failedOutput.model = result.model;
    if (result.finish_reason !== undefined && result.finish_reason !== 'stop') throw new Error(`模型回答未完整结束（${String(result.finish_reason).slice(0, 80)}），本次原回答仅供复查，请重新提取。`);
    const source = current.sources.find((item) => item.id === active.evidenceId && item.ready);
    if (!source) throw conflict();
    state = ingestRuntimeCandidates(current.state, source, { raw: result.raw }, result.backend, user.userId, now(), result.model);
    state = reviewFactsAgainstSources({ ...state, job: null }, current.sources);
  } catch (error) { state = failed(error instanceof Error ? error.message : '候选提取结果无法解析，请重新提取。'); }
  return persistPoll(user, id, current, state);
}

export async function readMaterialFacts(user: RequestUser, id: string): Promise<MaterialFactsResponse> {
  const current = await synchronized(user, id);
  await retryMaterialFactCleanup(user.userId, id);
  return response(await poll(user, id, current));
}

export async function actOnMaterialFacts(user: RequestUser, id: string, revision: number, generation: number, action: FactAction): Promise<MaterialFactsResponse> {
  const current = await snapshot(user, id);
  await retryMaterialFactCleanup(user.userId, id);
  if (current.revision !== revision || current.generation !== generation || current.state.generation !== generation) throw conflict();
  if (!revision) throw conflict();
  const at = now();
  let state: FactState;
  try { state = action.action === 'calculate' ? structuredClone(current.state) : applyFactAction(current.state, action, current.sources, user.userId, at); }
  catch (error) { throw new FactStoreError(error instanceof Error ? error.message : '事实确认内容格式不正确。'); }
  if (action.action === 'extract') {
    const source = current.sources.find((item) => item.id === action.evidenceId && item.ready);
    if (!source) throw new FactStoreError('请先在材料清单完成该文件的原文识别。', 409);
    // Reject oversized material before claiming an extraction or losing prior confirmation.
    try { validateFactSource(source); }
    catch (error) { throw new FactStoreError(error instanceof Error ? error.message : '请拆分材料后再提取。', 400); }
    // Claim the extraction intent before any external request. A simultaneous
    // calculation must already see all previous authorizations invalidated.
    const jobId = crypto.randomUUID();
    state = { ...state, job: { id: jobId, evidenceId: source.id, generation, status: 'running', error: null, startedAt: at, submissionPending: true } };
    if (!await save(user, id, current, state)) throw conflict();
    const claimed: Snapshot = { ...current, state, revision: current.revision + 1 };
    if (current.state.job) await cancelJob(user, id, current.state.job.id);
    try {
      const job = await callMaterialService('/fact-jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source, jobId }) });
      if (job.jobId !== jobId) {
        // A mismatched/old sidecar must not silently defeat recoverability.
        if (typeof job.jobId === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(job.jobId)) await cancelJob(user, id, job.jobId);
        throw new Error('候选提取服务未确认本次任务编号。');
      }
      state = { ...state, job: { ...state.job!, submissionPending: false } };
    } catch (error) {
      if (error instanceof MaterialServiceHttpError && error.status >= 400 && error.status < 500) {
        // A definitive rejection did not create this task. Persist the failed
        // extraction intent, including its revoked confirmations, and stop
        // polling a UUID the service never accepted.
        state = { ...state, job: { ...state.job!, status: 'failed', submissionPending: false, error: error.message } };
      } else {
        // A timeout, damaged acknowledgement or 5xx can follow acceptance of
        // this UUID. Reconcile with GET; never resubmit or invent a result.
        state = { ...state, job: { ...state.job!, submissionPending: false, pollFailureSince: now(), error: '提交回执暂未收到，正在核对已提交任务；请勿重复提取。' } };
      }
    }
    if (!await save(user, id, claimed, state)) { await cancelJob(user, id, jobId); throw conflict(); }
    return response({ ...claimed, state, revision: claimed.revision + 1 });
  } else if (action.action === 'calculate') {
    let plan;
    try { plan = prepareCalculation(state, current.sources); }
    catch (error) { throw new FactStoreError(error instanceof Error ? error.message : '请先完成事实确认。'); }
    const receiptId = crypto.randomUUID();
    // Integer subtraction and its receipt happen only for the row that passes
    // owner + active + revision + generation CAS in this exact D1 statement.
    const saved = await getDatabase().prepare(`UPDATE case_material_facts SET state_json=json_set(?, '$.calculation', json_object(
      'due', ?, 'paid', ?, 'gap', (SELECT CASE WHEN gap_cents<0 THEN '-' ELSE '' END || CAST(abs(gap_cents)/100 AS TEXT) || '.' || printf('%02d',abs(gap_cents)%100)
        FROM (SELECT CAST(? AS INTEGER)-CAST(? AS INTEGER) AS gap_cents)),
      'at', ?, 'actor', ?, 'generation', ?, 'receiptId', ?)),revision=revision+1,updated_at=?
      WHERE case_id=? AND user_id=? AND revision=? AND ${accessCondition}`)
      .bind(serializeStoredFactState(state), state.confirmations.due!.amount, state.confirmations.paid!.amount, plan.dueCents, plan.paidCents,
        at, user.userId, generation, receiptId, at, id, user.userId, revision, generation).run();
    if (!saved.meta.changes) throw conflict();
    return response(await synchronized(user, id));
  } else {
    if (!await save(user, id, current, state)) throw conflict();
    if (current.state.job && !state.job) await cancelJob(user, id, current.state.job.id);
  }
  return response({ ...current, state, revision: current.revision + 1 });
}

/** Only user actions are accepted. State, actors, providers and model-written
 * confirmations are never deserialized from client input. */
export function parseFactRequest(body: unknown): { revision: number; generation: number; action: FactAction } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new FactStoreError('请求内容格式不正确。');
  const value = body as Record<string, unknown>;
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 1 || !Number.isSafeInteger(value.generation) || (value.generation as number) < 1) throw new FactStoreError('缺少有效版本，请重新加载。');
  const allowed: Record<string, string[]> = { confirm_scope: ['scope', 'note', 'verified'], confirm_amount: ['field', 'amount', 'note', 'reviewedCandidateIds', 'complete', 'verified'], revoke: ['field'], exclude_source: ['evidenceId', 'reason'], extract: ['evidenceId'], calculate: [] };
  if (typeof value.action !== 'string' || !Object.hasOwn(allowed, value.action)) throw new FactStoreError('不支持这个事实操作。');
  const keys = ['action', 'revision', 'generation', ...allowed[value.action]];
  if (Object.keys(value).some((key) => !keys.includes(key))) throw new FactStoreError('请求包含不允许的字段。');
  const { revision, generation, ...action } = value;
  return { revision: revision as number, generation: generation as number, action: action as FactAction };
}
