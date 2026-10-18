// Real disposable Miniflare D1 and the application routes/store; model-service
// responses alone are controlled synthetic fixtures. No external service/Worker.
import { readFileSync, readdirSync } from 'node:fs';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeMaterialFactsResponse as Facts } from './material-fact-runtime-types';
import type { FactCandidateV3, RawCandidateV3 } from './material-fact-types-v3';

const bindings = vi.hoisted(() => ({ DB: undefined as unknown as D1Database, service: vi.fn() }));
vi.mock('cloudflare:workers', () => ({ env: bindings }));
vi.mock('./material-service-client', () => ({ materialServiceConfigured: () => true, callMaterialService: bindings.service }));
import { GET, POST } from '../app/api/cases/[id]/facts/route';

let mf: Miniflare;
let answer: string;
const caseId = 'currency-date-case', sourceId = 'currency-date-source';
const context = { params: Promise.resolve({ id: caseId }) };
const headers = { 'oai-authenticated-user-id': 'synthetic-owner', 'oai-authenticated-user-email': 'owner@synthetic.test' };
const request = (method = 'GET', body?: unknown) => new Request(`http://127.0.0.1/api/cases/${caseId}/facts`, {
  method, headers, ...(body ? { body: JSON.stringify(body) } : {}),
});
const scope = { worker: '王甲', employer: '合成测试单位', start: '2024-07-01', end: '2024-07-31' };
const note = '合成独立验收：已逐项核对本人、本期完整税前金额，手工输入不来自模型换算。';
const rawMoney = (): RawCandidateV3 => ({ kind: 'money', value: '8000', quote: '8000', blockId: 'b1', subject: '王甲',
  scope: 'individual', meaning: 'due_total', completeness: 'complete', period: '2024年7月', rateUnit: null, assertion: 'narrated' });
async function fixture(text: string, candidate: RawCandidateV3) {
  answer = JSON.stringify({ schemaVersion: 3, candidates: [candidate] });
  await bindings.DB.prepare(`INSERT INTO evidence_files (id,user_id,case_id,name,category,size,mime_type,status,note,object_key,content_hash,uploaded_at)
    VALUES (?,'synthetic-owner',?,'synthetic.txt','工资支付',100,'text/plain','uploaded','','synthetic-object',?,'2026-10-18')`)
    .bind(sourceId, caseId, 'b'.repeat(64)).run();
  const result = { engine: { ocr: 'synthetic-independent', structuring: 'ocr_rules', model: null }, pageCount: 1,
    blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }], fields: [], warnings: [],
    source: { evidenceId: sourceId, name: 'synthetic.txt', sha256: 'b'.repeat(64), mimeType: 'text/plain' } };
  await bindings.DB.prepare(`INSERT INTO evidence_analyses (evidence_id,user_id,content_hash,document_kind,status,revision,run_id,result_json,started_at,updated_at)
    VALUES (?,'synthetic-owner',?,'other','ready',1,'synthetic-run',?,'2026-10-18','2026-10-18')`)
    .bind(sourceId, 'b'.repeat(64), JSON.stringify(result)).run();
}
async function read() {
  const response = await GET(request(), context);
  expect(response.status).toBe(200);
  return await response.json() as Facts;
}
async function act(current: Facts, action: Record<string, unknown>, status = 200) {
  const response = await POST(request('POST', { revision: current.revision, generation: current.generation, ...action }), context);
  expect(response.status).toBe(status);
  return await response.json() as Facts;
}
async function extract() {
  await act(await read(), { action: 'extract', evidenceId: sourceId }, 202);
  const current = await read();
  expect(current.candidates).toHaveLength(1);
  expect(current.state.materials[0].raw).toBe(answer);
  expect(current.state.materials[0].rejected).toEqual([]);
  return current;
}

describe('PR40 independent D1 API: runtime currency/date source review survives reload and scope', () => {
  beforeEach(async () => {
    vi.stubEnv('NODE_ENV', 'production');
    bindings.service.mockReset().mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/health') return { capabilities: { factBackend: 'synthetic-independent', factConfigured: true } };
      if (init?.method === 'DELETE') return { ok: true };
      if (path === '/fact-jobs') return { jobId: JSON.parse(String(init?.body)).jobId };
      return { status: 'ready', result: { raw: answer, backend: 'synthetic-independent', model: null } };
    });
    mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default { fetch() { return new Response("synthetic independent D1"); } };',
      compatibilityDate: '2026-09-11', d1Databases: ['DB'] }));
    bindings.DB = await mf.getD1Database('DB') as unknown as D1Database;
    for (const name of readdirSync(new URL('../drizzle/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) {
      const statements = readFileSync(new URL(`../drizzle/${name}`, import.meta.url), 'utf8').split('--> statement-breakpoint');
      await bindings.DB.batch(statements.filter(statement => statement.trim()).map(statement => bindings.DB.prepare(statement)));
    }
    await bindings.DB.prepare(`INSERT INTO cases (id,user_id,type,company,status,next_action,created_at,updated_at)
      VALUES (?,'synthetic-owner','欠薪','合成测试单位','collecting','整理材料','2026-10-18','2026-10-18')`).bind(caseId).run();
  }, 30_000);
  afterEach(async () => { await mf?.dispose(); vi.unstubAllEnvs(); }, 20_000);

  it('never promotes unmarked money through ingest, reload or confirmed scope; independent manual amounts remain usable', async () => {
    await fixture('王甲2024年7月完整应付工资合计8000。', rawMoney());
    const extracted = await extract(), reloaded = await read();
    expect(reloaded.candidates).toEqual(extracted.candidates);
    let current = await act(reloaded, { action: 'confirm_scope', scope, note, verified: true });
    const afterScope = await read();
    // Collect before asserting so baseline failure also shows the real scope path.
    const observed = [extracted, reloaded, current, afterScope].map(stage => ({ amount: stage.candidates[0].amount,
      raw: stage.state.materials[0].raw, due: stage.fields.due, canCalculate: stage.canCalculate }));
    expect(afterScope.fields.due).toEqual(current.fields.due);
    expect(observed.every(stage => stage.raw === answer && !stage.canCalculate)).toBe(true);
    expect(current.state.confirmations).toEqual({ due: null, paid: null });

    for (const [field, amount] of [['due', '9000'], ['paid', '0']]) {
      current = await act(current, { action: 'confirm_amount', field, amount, note, complete: true, verified: true,
        reviewedCandidateIds: current.candidates.map(candidate => candidate.id) });
    }
    expect(current.canCalculate).toBe(true);
    current = await act(current, { action: 'calculate' });
    expect(current.state.calculation).toMatchObject({ due: '9000.00', paid: '0.00', gap: '9000.00' });
    const final = await read();
    expect(final.state.materials[0].raw).toBe(answer);
    expect((final.candidates[0] as FactCandidateV3).representation).toEqual(rawMoney());
    expect(final.state.confirmations.due).toMatchObject({ amount: '9000.00', mode: 'user_attested' });
    const stored = await bindings.DB.prepare('SELECT state_json FROM case_material_facts WHERE case_id=?').bind(caseId).first<{ state_json: string }>();
    expect(JSON.parse(stored!.state_json).materials[0].raw).toBe(answer);
    // Run the independent human-input path before the safety assertions so the
    // failing baseline still proves manual calculations/raw retention work.
    expect(observed.map(stage => stage.amount), JSON.stringify(observed)).toEqual([null, null, null, null]);
    expect(afterScope.fields.due).toMatchObject({ status: 'unknown', values: [] });
    expect(final.candidates[0].amount).toBeNull();
  });

  it('returns a persisted receipt date with a mislabel warning without rewriting the model role', async () => {
    const candidate: RawCandidateV3 = { ...rawMoney(), kind: 'date', value: '2024年7月', quote: '2024年7月',
      meaning: 'employment_period', period: null, completeness: 'not_applicable' };
    await fixture('王甲于2024年7月收到工资。', candidate);
    const extracted = await extract(), reloaded = await read();
    expect(reloaded.candidates).toEqual(extracted.candidates);
    const scoped = await act(reloaded, { action: 'confirm_scope', scope, note, verified: true });
    for (const current of [extracted, reloaded, scoped, await read()]) {
      expect(current.candidates[0]).toMatchObject({ representation: candidate,
        reviewIssues: expect.arrayContaining([expect.objectContaining({ code: 'source_relation_unresolved' })]) });
      expect(current.state.materials[0].raw).toBe(answer);
      expect(current.canCalculate).toBe(false);
      expect(current.fields.due.values).toEqual([]);
    }
  });
});
