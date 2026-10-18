// Disposable D1 API integration; service replies and all document text here are
// synthetic fixtures. These checks do not measure real-model extraction quality.
import { readFileSync, readdirSync } from 'node:fs';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MaterialFactsResponse } from './material-fact-types';

const bindings = vi.hoisted(() => ({ DB: undefined as unknown as D1Database, service: vi.fn() }));
vi.mock('cloudflare:workers', () => ({ env: bindings }));
vi.mock('./material-service-client', () => ({ materialServiceConfigured: () => true, callMaterialService: bindings.service }));
import { GET, POST } from '../app/api/cases/[id]/facts/route';
import { PATCH as patchCase } from '../app/api/cases/route';

let mf: Miniflare;
const headers = (user = 'owner') => ({ 'oai-authenticated-user-id': user, 'oai-authenticated-user-email': `${user}@synthetic.test` });
const context = { params: Promise.resolve({ id: 'fact-case' }) };
const request = (method = 'GET', body?: unknown, user = 'owner') => new Request('http://127.0.0.1/api/cases/fact-case/facts', { method, headers: headers(user), ...(body ? { body: JSON.stringify(body) } : {}) });
const scope = { worker: '张三', employer: '合成测试单位', start: '2026-01-01', end: '2026-01-31' };
const note = '合成集成测试：已核对同一劳动者同一工资期间的完整金额，统一为税前口径。';
const raw = JSON.stringify({ schemaVersion: 3, candidates: [
  { kind: 'money', meaning: 'due_total', scope: 'individual', completeness: 'complete', rateUnit: null, value: '1000元', quote: '本期完整应付工资1000元', blockId: 'b1', subject: '张三', period: '2026年1月', assertion: 'narrated' },
  { kind: 'money', meaning: 'paid_total', scope: 'individual', completeness: 'complete', rateUnit: null, value: '200元', quote: '本期完整已付工资200元', blockId: 'b1', subject: '张三', period: '2026年1月', assertion: 'narrated' },
] });

async function addSource(id = 'source-1', ready = true) {
  await bindings.DB.prepare(`INSERT INTO evidence_files (id,user_id,case_id,name,category,size,mime_type,status,note,object_key,content_hash,uploaded_at)
    VALUES (?,'owner','fact-case','synthetic.txt','工资支付',100,'text/plain',?,'','synthetic-object',?,'2026-10-17')`).bind(id, ready ? 'uploaded' : 'uploading', 'a'.repeat(64)).run();
  if (!ready) return;
  const result = { engine: { ocr: 'controlled-test-fixture', structuring: 'ocr_rules', model: null }, pageCount: 1,
    blocks: [{ id: 'b1', page: 1, text: '张三在合成测试单位的2026年1月本期完整应付工资1000元，本期完整已付工资200元。', bbox: null, confidence: null }],
    fields: [], warnings: [], source: { evidenceId: id, name: 'synthetic.txt', sha256: 'a'.repeat(64), mimeType: 'text/plain' } };
  await bindings.DB.prepare(`INSERT INTO evidence_analyses (evidence_id,user_id,content_hash,document_kind,status,revision,run_id,result_json,started_at,updated_at)
    VALUES (?,'owner',?,'other','ready',1,'synthetic-run',?,'2026-10-17','2026-10-17')`).bind(id, 'a'.repeat(64), JSON.stringify(result)).run();
}
async function read(user = 'owner') {
  const response = await GET(request('GET', undefined, user), context);
  expect(response.status).toBe(200);
  return await response.json() as MaterialFactsResponse;
}
async function act(current: MaterialFactsResponse, action: Record<string, unknown>, user = 'owner') {
  return POST(request('POST', { revision: current.revision, generation: current.generation, ...action }, user), context);
}
async function extracted() {
  let current = await read();
  expect((await act(current, { action: 'extract', evidenceId: 'source-1' })).status).toBe(202);
  current = await read();
  expect(current.candidates).toHaveLength(2);
  return current;
}
async function confirmed(due = '1000', paid = '200') {
  let current = await extracted();
  let response = await act(current, { action: 'confirm_scope', scope, note, verified: true });
  expect(response.status).toBe(200); current = await response.json() as MaterialFactsResponse;
  for (const [field, amount] of [['due', due], ['paid', paid]]) {
    response = await act(current, { action: 'confirm_amount', field, amount, note, complete: true, verified: true, reviewedCandidateIds: current.candidates.map((candidate) => candidate.id) });
    expect(response.status).toBe(200); current = await response.json() as MaterialFactsResponse;
  }
  return current;
}

describe('material facts API and transactional persistence', () => {
  beforeEach(async () => {
    vi.stubEnv('NODE_ENV', 'production');
    bindings.service.mockReset().mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/health') return { capabilities: { factBackend: 'controlled-test-fixture', factConfigured: true } };
      if (init?.method === 'DELETE') return { ok: true };
      if (path === '/fact-jobs') return { jobId: 'fact-job' };
      return { status: 'ready', result: { raw, backend: 'controlled-test-fixture', model: null } };
    });
    mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default { fetch() { return new Response("disposable fact test"); } };', compatibilityDate: '2026-09-11', d1Databases: ['DB'] }));
    bindings.DB = await mf.getD1Database('DB') as unknown as D1Database;
    for (const name of readdirSync(new URL('../drizzle/', import.meta.url)).filter((name) => name.endsWith('.sql')).sort()) {
      const statements = readFileSync(new URL(`../drizzle/${name}`, import.meta.url), 'utf8').split('--> statement-breakpoint');
      await bindings.DB.batch(statements.filter((statement) => statement.trim()).map((statement) => bindings.DB.prepare(statement)));
    }
    await bindings.DB.prepare(`INSERT INTO cases (id,user_id,type,company,status,next_action,created_at,updated_at) VALUES ('fact-case','owner','欠薪','合成测试单位','collecting','整理材料','2026-10-17','2026-10-17')`).run();
    await addSource();
  }, 30_000);
  afterEach(async () => { await mf?.dispose(); vi.unstubAllEnvs(); }, 20_000);

  it('keeps extraction as candidates, binds actor to authentication, and persists raw provenance', async () => {
    const current = await extracted();
    expect(current.state.confirmations).toEqual({ due: null, paid: null });
    expect(current.canCalculate).toBe(false);
    expect(current.state.materials[0]).toMatchObject({ raw, model: null, backend: 'controlled-test-fixture' });
    expect(current.state.history.every((entry) => entry.actor === 'owner')).toBe(true);
    const foreign = await GET(request('GET', undefined, 'other'), context);
    expect(foreign.status).toBe(404);
    const forged = await act(current, { action: 'confirm_scope', scope, note, verified: true, actor: 'model' });
    expect(forged.status).toBe(400);
    expect((await act(current, { action: 'calculate' }, 'other')).status).toBe(404);
  });

  it('persists empty extraction diagnostics without authorizing totals', async () => {
    bindings.service.mockImplementation(async (path: string) => path === '/health' ? { capabilities: { factBackend: 'controlled-test-fixture', factConfigured: true } } : path === '/fact-jobs' ? { jobId: 'empty-job' } : { status:'ready',result:{raw:JSON.stringify({schemaVersion:3,candidates:[]}),backend:'controlled-test-fixture',model:null} });
    const before=await read();
    expect((await act(before,{action:'extract',evidenceId:'source-1'})).status).toBe(202);
    const current=await read();
    expect(current.candidates).toHaveLength(0);
    expect(current.state.materials[0]).toMatchObject({coverage:{status:'empty',heuristic:true,rawCount:0,acceptedCount:0}});
    expect(current.fields.due.status).toBe('unknown');
    expect(current.fields.paid.status).toBe('unknown');
    expect(current.canCalculate).toBe(false);
    expect((await read()).state.materials[0]).toEqual(current.state.materials[0]);
  });

  it('returns an actionable 400 for ready OCR over the extraction limit without claiming a job or clearing scope', async () => {
    const blocks = Array.from({ length: 9 }, (_, index) => ({ id: `long-${index}`, page: 1,
      text: '字'.repeat(index === 8 ? 1 : 3000), bbox: null, confidence: null }));
    await bindings.DB.prepare(`UPDATE evidence_analyses SET result_json=json_set(result_json,'$.blocks',json(?)) WHERE evidence_id='source-1'`)
      .bind(JSON.stringify(blocks)).run();
    let current = await read();
    expect(current.sources[0].ready).toBe(true);
    current = await (await act(current, { action: 'confirm_scope', scope, note, verified: true })).json() as MaterialFactsResponse;
    bindings.service.mockClear();
    const rejected = await act(current, { action: 'extract', evidenceId: 'source-1' });
    expect(rejected.status).toBe(400);
    const rejectionBody = await rejected.json() as { error: string };
    expect(rejectionBody.error).toMatch(/24000.*分份/);
    expect(bindings.service.mock.calls.some(([path]) => path === '/fact-jobs')).toBe(false);
    const after = await read();
    expect(after.revision).toBe(current.revision);
    expect(after.state).toEqual(current.state);
    expect(after.state.scope).toEqual(scope);
    expect(after.state.job).toBeNull();
  });

  it('keeps an exact observation after an approximate duplicate through the real polling store without rewriting historical results', async () => {
    const clauses = ['张三2026年1月完整应付工资约1000元', '张三2026年1月完整应付工资1000元'];
    await bindings.DB.prepare(`UPDATE evidence_analyses SET result_json=json_set(result_json,'$.blocks[0].text',?) WHERE evidence_id='source-1'`).bind(clauses.join('。') + '。').run();
    const template = JSON.parse(raw).candidates[0];
    const answer = JSON.stringify({ schemaVersion: 3, candidates: [
      { ...template, quote: clauses[0] }, { ...template, quote: '原文不存在' }, { ...template, quote: clauses[1] },
    ] });
    bindings.service.mockImplementation(async (path: string, init?: RequestInit) => path === '/health' ? { capabilities: { factConfigured: true } }
      : init?.method === 'DELETE' ? { ok: true } : path === '/fact-jobs' ? { jobId: 'modifier-job' }
        : { status: 'ready', result: { raw: answer, backend: 'controlled-test-fixture', model: null } });
    const before = await read();
    expect((await act(before, { action: 'extract', evidenceId: 'source-1' })).status).toBe(202);
    const current = await read(), material = current.state.materials[0];
    expect(material.raw).toBe(answer);
    expect(material.candidates.map(candidate => [candidate.id, candidate.amount])).toEqual([['source-1:1:0', null], ['source-1:1:2', '1000.00']]);
    expect(material.rejected).toEqual([{ index: 1, reason: '引用不存在，或引用不包含候选原文值' }]);
    expect(current.state.confirmations).toEqual({ due: null, paid: null });
    expect(current.canCalculate).toBe(false);
    expect((await read()).state.materials[0].candidates).toEqual(material.candidates);

    // Previously stored acceptance/rejection records retain their historical meaning.
    // A new extraction uses the runtime fix; GET does not silently reparse old raw.
    const row = await bindings.DB.prepare('SELECT state_json FROM case_material_facts WHERE case_id=?').bind('fact-case').first<{ state_json: string }>();
    const historical = JSON.parse(row!.state_json);
    historical.materials[0].candidates = historical.materials[0].candidates.slice(0, 1);
    historical.materials[0].rejected.push({ index: 2, reason: 'historical frozen duplicate rejection' });
    const historicalJson = JSON.stringify(historical);
    await bindings.DB.prepare('UPDATE case_material_facts SET state_json=? WHERE case_id=?').bind(historicalJson, 'fact-case').run();
    const reread = await read();
    expect(reread.state.materials[0].candidates).toHaveLength(1);
    expect(reread.state.materials[0].raw).toBe(answer);
    expect(reread.state.materials[0].rejected.at(-1)).toEqual({ index: 2, reason: 'historical frozen duplicate rejection' });
    expect((await bindings.DB.prepare('SELECT state_json FROM case_material_facts WHERE case_id=?').bind('fact-case').first<{ state_json: string }>())!.state_json).toBe(historicalJson);
  });

  it('returns current coverage for a nonempty historical v2 record without storing a derived display diagnostic', async () => {
    await extracted();
    const row = await bindings.DB.prepare('SELECT state_json FROM case_material_facts WHERE case_id=?').bind('fact-case').first<{ state_json: string }>();
    const legacy = JSON.parse(row!.state_json), material = legacy.materials[0];
    material.schemaVersion = 2;
    delete material.coverage;
    delete material.sourceCoverage;
    material.candidates = material.candidates.slice(0, 1);
    material.candidates[0].schemaVersion = 2;
    delete material.candidates[0].normalization;
    material.raw = JSON.stringify({ schemaVersion: 2, candidates: [material.candidates[0].representation] });
    const legacyJson = JSON.stringify(legacy);
    await bindings.DB.prepare('UPDATE case_material_facts SET state_json=? WHERE case_id=?').bind(legacyJson, 'fact-case').run();
    const readStored = async () => (await bindings.DB.prepare('SELECT state_json FROM case_material_facts WHERE case_id=?').bind('fact-case').first<{ state_json: string }>())!.state_json;
    let current = await read();
    expect(current.state.materials[0]).toMatchObject({ schemaVersion: 2, raw: material.raw, sourceCoverage: { status: 'possible_missing', acceptedCount: 1 } });
    expect(await readStored()).toBe(legacyJson);
    current = await (await act(current, { action: 'confirm_scope', scope, note, verified: true })).json() as MaterialFactsResponse;
    for (const field of ['due', 'paid']) current = await (await act(current, { action: 'confirm_amount', field, amount: field === 'due' ? '1000' : '200', note, complete: true, verified: true, reviewedCandidateIds: current.candidates.map(candidate => candidate.id) })).json() as MaterialFactsResponse;
    expect((await act(current, { action: 'calculate' })).status).toBe(200);
    const stored = JSON.parse(await readStored()).materials[0];
    expect(stored).toMatchObject({ schemaVersion: 2, raw: material.raw });
    expect(Object.hasOwn(stored, 'sourceCoverage')).toBe(false);
    expect(Object.hasOwn(stored, 'coverage')).toBe(false);
    expect((await read()).state.materials[0]).toMatchObject({ sourceCoverage: { status: 'possible_missing' } });
  });

  it('returns source attribution warnings for non-total and date candidates after persistence reload', async () => {
    const text = '张三2026年1月资料待核。李四2026年2月月薪1000元。李四2026年2月15日入职。';
    await bindings.DB.prepare(`UPDATE evidence_analyses SET result_json=json_set(result_json,'$.blocks[0].text',?) WHERE evidence_id='source-1'`).bind(text).run();
    const modelOutput = JSON.parse(raw), first = modelOutput.candidates[0];
    modelOutput.candidates = [
      { ...first, quote: '1000元', meaning: 'rate', completeness: 'not_applicable', rateUnit: 'month' },
      { ...first, kind: 'date', value: '2026年2月15日', quote: '2026年2月15日', meaning: 'employment_period', completeness: 'not_applicable', period: null },
    ];
    const answer = JSON.stringify(modelOutput);
    bindings.service.mockImplementation(async (path: string, init?: RequestInit) => path === '/health' ? { capabilities: { factConfigured: true } }
      : init?.method === 'DELETE' ? { ok: true } : path === '/fact-jobs' ? { jobId: 'roles-job' }
        : { status: 'ready', result: { raw: answer, backend: 'controlled-test-fixture', model: null } });
    const current = await extracted();
    for (const candidate of current.candidates) expect(candidate).toMatchObject({ reviewIssues: expect.arrayContaining([expect.objectContaining({ code: 'source_relation_unresolved' })]) });
    expect(current.state.materials[0].raw).toBe(answer);
    expect((await read()).candidates).toEqual(current.candidates);
    expect(current.canCalculate).toBe(false);
  });

  it('persists the original amount span and exact normalization separately', async () => {
    const parsed=JSON.parse(raw);parsed.candidates[0].value='本期完整应付工资1000元';
    bindings.service.mockImplementation(async (path: string) => path === '/health' ? { capabilities: { factBackend: 'controlled-test-fixture', factConfigured: true } } : path === '/fact-jobs' ? { jobId: 'amount-job' } : {status:'ready',result:{raw:JSON.stringify(parsed),backend:'controlled-test-fixture',model:null}});
    const current=await extracted();
    expect(current.candidates[0]).toMatchObject({value:'本期完整应付工资1000元',amount:'1000.00',normalization:{rawValue:'本期完整应付工资1000元',matchedText:'1000元',status:'exact',amount:'1000.00'}});
    expect((await read()).candidates[0]).toEqual(current.candidates[0]);
    expect(current.canCalculate).toBe(false);
  });

  it('binds cropped group quotes to the source before offering personal totals', async () => {
    await bindings.DB.prepare(`UPDATE evidence_analyses SET result_json=json_set(result_json,'$.blocks[0].text',?) WHERE evidence_id='source-1'`)
      .bind('张三班组10人在合成测试单位的2026年1月本期完整应付工资1000元，本期完整已付工资200元。').run();
    let current = await extracted();
    expect(current.candidates[0]).toMatchObject({ value: '1000元', quote: '本期完整应付工资1000元', reviewIssues: expect.arrayContaining([expect.objectContaining({ code: 'scope_text_mismatch' })]) });
    const response = await act(current, { action: 'confirm_scope', scope, note, verified: true });
    expect(response.status).toBe(200);
    current = await response.json() as MaterialFactsResponse;
    expect(current.fields.due).toMatchObject({ status: 'unknown', values: [] });
    expect(current.state.materials[0].raw).toBe(raw);
    expect(current.state.confirmations.due).toBeNull();
    expect(current.canCalculate).toBe(false);
    expect((await read()).candidates[0]).toEqual(current.candidates[0]);
  });

  it('keeps a source approximate amount non-exact when the model omits the qualifier', async () => {
    await bindings.DB.prepare(`UPDATE evidence_analyses SET result_json=json_set(result_json,'$.blocks[0].text',?) WHERE evidence_id='source-1'`)
      .bind('张三在合成测试单位的2026年1月本期完整应付工资约1000元，本期完整已付工资200元。').run();
    const modelOutput = JSON.parse(raw);
    modelOutput.candidates[0].quote = '1000元';
    const rawAnswer = JSON.stringify(modelOutput);
    bindings.service.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/health') return { capabilities: { factBackend: 'controlled-test-fixture', factConfigured: true } };
      if (init?.method === 'DELETE') return { ok: true };
      if (path === '/fact-jobs') return { jobId: 'approximate-job' };
      return { status: 'ready', result: { raw: rawAnswer, backend: 'controlled-test-fixture', model: null } };
    });
    let current = await extracted();
    expect(current.candidates[0]).toMatchObject({ value: '1000元', quote: '1000元', amount: null, normalization: { status: 'approximate', amount: null } });
    expect(current.candidates[1].amount).toBe('200.00');
    current = await (await act(current, { action: 'confirm_scope', scope, note, verified: true })).json() as MaterialFactsResponse;
    expect(current.fields.due.values).toEqual([]);
    expect(current.state.materials[0].raw).toBe(rawAnswer);
    expect((await read()).candidates[0]).toEqual(current.candidates[0]);
  });

  it.each([
    ['group header', '张三班组十名工人，2026年1月应付工资合计1000元。', '1000元'],
    ['other worker', '张三2026年1月工资待核。李四2026年2月完整应付工资1000元。', '1000元'],
    ['partial due', '张三2026年1月部分应付工资1000元。', '1000元'],
    ['postposed partial', '张三2026年1月应付工资合计1000元，加班工资另计。', '1000元'],
    ['foreign currency', '张三2026年1月完整应付工资1000美元。', '1000'],
  ])('persists and rechecks PR40 %s without exposing an available personal total', async (_name, text, value) => {
    await bindings.DB.prepare(`UPDATE evidence_analyses SET result_json=json_set(result_json,'$.blocks[0].text',?) WHERE evidence_id='source-1'`).bind(text).run();
    const modelOutput = JSON.parse(raw);
    modelOutput.candidates = [{ ...modelOutput.candidates[0], value, quote: value }];
    const rawAnswer = JSON.stringify(modelOutput);
    bindings.service.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/health') return { capabilities: { factBackend: 'controlled-test-fixture', factConfigured: true } };
      if (init?.method === 'DELETE') return { ok: true };
      if (path === '/fact-jobs') return { jobId: 'pr40-unsafe-job' };
      return { status: 'ready', result: { raw: rawAnswer, backend: 'controlled-test-fixture', model: null } };
    });
    expect((await act(await read(), { action: 'extract', evidenceId: 'source-1' })).status).toBe(202);
    let current = await read();
    expect(current.candidates).toHaveLength(1);
    current = await (await act(current, { action: 'confirm_scope', scope, note, verified: true })).json() as MaterialFactsResponse;
    expect(current.fields.due).toMatchObject({ status: 'unknown', values: [] });
    expect(current.canCalculate).toBe(false);
    expect(current.state.materials[0].raw).toBe(rawAnswer);
    expect(current.candidates[0]).toMatchObject({ value, quote: value, representation: modelOutput.candidates[0] });
    expect((await read()).candidates).toEqual(current.candidates);
    // Reload from D1, not the in-memory extraction batch; source review remains enforced.
    const row = await bindings.DB.prepare('SELECT state_json FROM case_material_facts WHERE case_id=?').bind('fact-case').first<{ state_json: string }>();
    expect(JSON.parse(row!.state_json).materials[0].raw).toBe(rawAnswer);
    const confirmation = await act(current, { action: 'confirm_amount', field: 'due', amount: '900', note, complete: true, verified: true, reviewedCandidateIds: current.candidates.map(candidate => candidate.id) });
    expect(confirmation.status).toBe(200);
    current = await confirmation.json() as MaterialFactsResponse;
    expect(current.fields.due.confirmation?.amount).toBe('900.00');
    expect(current.fields.due.values).toEqual([]);
    expect(current.state.materials[0].raw).toBe(rawAnswer);
  });

  it.each([['18000元', '8000元'], ['80000元', '0000元'], ['1000元/月', '1000元']])('does not suggest a total from a cropped monetary token: %s as %s', async (sourceAmount, croppedValue) => {
    await bindings.DB.prepare(`UPDATE evidence_analyses SET result_json=json_set(result_json,'$.blocks[0].text',?) WHERE evidence_id='source-1'`)
      .bind(`张三在合成测试单位的2026年1月本期完整应付工资${sourceAmount}，本期完整已付工资200元。`).run();
    const modelOutput = JSON.parse(raw);
    modelOutput.candidates[0].value = croppedValue;
    modelOutput.candidates[0].quote = croppedValue;
    bindings.service.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/health') return { capabilities: { factBackend: 'controlled-test-fixture', factConfigured: true } };
      if (init?.method === 'DELETE') return { ok: true };
      if (path === '/fact-jobs') return { jobId: 'cropped-money-job' };
      return { status: 'ready', result: { raw: JSON.stringify(modelOutput), backend: 'controlled-test-fixture', model: null } };
    });
    let current = await extracted();
    expect(current.candidates[0].amount).toBeNull();
    current = await (await act(current, { action: 'confirm_scope', scope, note, verified: true })).json() as MaterialFactsResponse;
    expect(current.fields.due.values).toEqual([]);
    expect(current.state.confirmations.due).toBeNull();
    expect(current.canCalculate).toBe(false);
  });

  it('persists failed cleanup after completing a fact job and retries on the next owned read', async () => {
    let offline = true;
    bindings.service.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/health') return { capabilities: { factBackend: 'controlled-test-fixture', factConfigured: true } };
      if (init?.method === 'DELETE') { if (offline) throw new Error('synthetic cleanup timeout'); return { ok: true }; }
      if (path === '/fact-jobs') return { jobId: 'cleanup-job' };
      return { status: 'ready', result: { raw, backend: 'controlled-test-fixture', model: null } };
    });
    const current = await extracted();
    expect(current.state.job).toBeNull();
    expect(current.state.materials[0].raw).toBe(raw);
    // Follow actual owned requests: retry must not need the old fact-state ID.
    const attempts = () => bindings.service.mock.calls.filter(([path, init]) => path === '/fact-jobs/cleanup-job' && init?.method === 'DELETE').length;
    expect(attempts()).toBe(1);
    offline = false;
    expect((await read()).candidates).toEqual(current.candidates);
    expect(attempts()).toBe(2);
    await read();
    expect(attempts()).toBe(2);
  });

  it('requires explicit totals and commits integer arithmetic plus receipt in D1', async () => {
    let current = await confirmed('1000.01', '200.02');
    expect(current.canCalculate).toBe(true);
    const response = await act(current, { action: 'calculate' });
    expect(response.status).toBe(200);
    current = await response.json() as MaterialFactsResponse;
    expect(current.state.calculation).toMatchObject({ due: '1000.01', paid: '200.02', gap: '799.99', actor: 'owner', generation: current.generation });
    expect(current.state.calculation!.receiptId).toBeTruthy();
    const persisted = await bindings.DB.prepare('SELECT state_json FROM case_material_facts WHERE case_id=?').bind('fact-case').first<{ state_json: string }>();
    expect(JSON.parse(persisted!.state_json).calculation).toEqual(current.state.calculation);
  });

  it('does not produce a calculation receipt when the final SQL loses generation CAS', async () => {
    const current = await confirmed();
    const original = bindings.DB;
    let interleaved = false;
    bindings.DB = {
      batch: original.batch.bind(original),
      prepare(sql: string) {
        const statement = original.prepare(sql);
        if (!sql.includes('state_json=json_set')) return statement;
        return { bind(...values: unknown[]) {
          const bound = statement.bind(...values);
          return { async run() { interleaved = true; await addSource('during-calculation', false); return bound.run(); } };
        } } as unknown as D1PreparedStatement;
      },
    } as unknown as D1Database;
    const response = await act(current, { action: 'calculate' });
    expect(interleaved).toBe(true);
    expect(response.status).toBe(409);
    const persisted = await original.prepare('SELECT state_json FROM case_material_facts WHERE case_id=?').bind('fact-case').first<{ state_json: string }>();
    expect(JSON.parse(persisted!.state_json).calculation).toBeNull();
    expect(persisted!.state_json).not.toContain('receiptId');
  });

  it('preserves exact cents for a negative sub-yuan difference', async () => {
    const current = await confirmed('0', '0.01');
    const response = await act(current, { action: 'calculate' });
    expect(response.status).toBe(200);
    expect((await response.json() as MaterialFactsResponse).state.calculation!.gap).toBe('-0.01');
  });

  it('accepts explicit zero and rejects blank totals without modifying confirmation', async () => {
    const current = await confirmed('1000', '0');
    expect(current.state.confirmations.paid!.cents).toBe(0);
    const response = await act(current, { action: 'confirm_amount', field: 'paid', amount: '', note, complete: true, verified: true, reviewedCandidateIds: current.candidates.map((candidate) => candidate.id) });
    expect(response.status).toBe(400);
    expect((await read()).state.confirmations.paid!.cents).toBe(0);
  });

  it('invalidates confirmations from the first upload intent and blocks omitted new sources', async () => {
    const current = await confirmed();
    await addSource('new-upload', false);
    expect((await act(current, { action: 'calculate' })).status).toBe(409);
    const latest = await read();
    expect(latest.generation).toBeGreaterThan(current.generation);
    expect(latest.state.scope).toBeNull();
    expect(latest.state.confirmations).toEqual({ due: null, paid: null });
    expect(latest.canCalculate).toBe(false);
    expect(latest.sources.map((source) => source.id)).toContain('new-upload');
  });

  it('clears derived private text at deletion and rejects late stale actions', async () => {
    const current = await extracted();
    await bindings.DB.prepare("UPDATE evidence_files SET status='deleting' WHERE id='source-1'").run();
    expect(await bindings.DB.prepare('SELECT state_json FROM case_material_facts').first()).toBeNull();
    await bindings.DB.prepare("DELETE FROM evidence_analyses WHERE evidence_id='source-1'").run();
    await bindings.DB.prepare("DELETE FROM evidence_files WHERE id='source-1'").run();
    expect((await act(current, { action: 'confirm_scope', scope, note, verified: true })).status).toBe(409);
    const latest = await read();
    expect(latest.candidates).toEqual([]);
    expect(JSON.stringify(latest.state)).not.toContain('本期完整应付工资');
  });

  it('makes archive/restore and company changes invalidate earlier authorizations', async () => {
    const current = await confirmed();
    await bindings.DB.prepare("UPDATE cases SET status='archived' WHERE id='fact-case'").run();
    expect((await GET(request(), context)).status).toBe(404);
    await bindings.DB.prepare("UPDATE cases SET status='collecting' WHERE id='fact-case'").run();
    expect((await act(current, { action: 'calculate' })).status).toBe(409);
    const restored = await read();
    expect(restored.state.confirmations.due).toBeNull();
    await bindings.DB.prepare("UPDATE cases SET company='另一合成单位' WHERE id='fact-case'").run();
    expect((await read()).generation).toBeGreaterThan(restored.generation);
  });

  it('captures and cancels a fact job on case invalidation, but preserves a job on no-op changes', async () => {
    bindings.service.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/health') return { capabilities: { factBackend: 'controlled-test-fixture', factConfigured: true } };
      if (init?.method === 'DELETE') return { ok: true };
      if (path === '/fact-jobs') return { jobId: 'fact-job' };
      return { status: 'running' };
    });
    let current = await read();
    expect((await act(current, { action: 'extract', evidenceId: 'source-1' })).status).toBe(202);
    const patch = (body: object) => patchCase(new Request('http://127.0.0.1/api/cases', { method: 'PATCH', headers: headers(), body: JSON.stringify({ id: 'fact-case', ...body }) }));
    bindings.service.mockClear();
    expect((await patch({ company: '合成测试单位' })).status).toBe(200);
    expect(bindings.service.mock.calls.some(([path, init]) => path === '/fact-jobs/fact-job' && init?.method === 'DELETE')).toBe(false);
    expect((await patch({ status: 'archived' })).status).toBe(200);
    expect(bindings.service).toHaveBeenCalledWith('/fact-jobs/fact-job', { method: 'DELETE' });
    expect(await bindings.DB.prepare('SELECT state_json FROM case_material_facts').first()).toBeNull();
    expect((await patch({ status: 'collecting' })).status).toBe(200);
    current = await read();
    expect((await act(current, { action: 'extract', evidenceId: 'source-1' })).status).toBe(202);
    bindings.service.mockClear();
    expect((await patch({ company: '新合成测试单位' })).status).toBe(200);
    expect(bindings.service).toHaveBeenCalledWith('/fact-jobs/fact-job', { method: 'DELETE' });
  });

  it('rejects stale concurrent revisions without a second write', async () => {
    const current = await extracted();
    const both = await Promise.all([act(current, { action: 'confirm_scope', scope, note, verified: true }), act(current, { action: 'exclude_source', evidenceId: 'source-1', reason: note })]);
    expect(both.map((response) => response.status).sort()).toEqual([200, 409]);
  });

  it('cancels a job started while another upload changes the generation', async () => {
    const current = await read();
    let release!: (value: unknown) => void;
    let entered!: () => void;
    const called = new Promise<void>((resolve) => { entered = resolve; });
    bindings.service.mockImplementation(async (path: string) => {
      if (path === '/fact-jobs') { entered(); return new Promise((resolve) => { release = resolve; }); }
      return { ok: true };
    });
    const pending = act(current, { action: 'extract', evidenceId: 'source-1' });
    await called;
    await addSource('racing-upload', false);
    release({ jobId: 'late-fact-job' });
    expect((await pending).status).toBe(409);
    expect(bindings.service).toHaveBeenCalledWith('/fact-jobs/late-fact-job', { method: 'DELETE' });
    expect((await read()).state.job).toBeNull();
  });

  it('keeps a late unattached job retryable when its first cancellation fails', async () => {
    const current = await read();
    let release!: (value: unknown) => void;
    let entered!: () => void;
    let offline = true;
    const called = new Promise<void>((resolve) => { entered = resolve; });
    bindings.service.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/fact-jobs') { entered(); return new Promise((resolve) => { release = resolve; }); }
      if (init?.method === 'DELETE') { if (offline) throw new Error('synthetic late cancel timeout'); return { ok: true }; }
      return { capabilities: { factBackend: 'controlled-test-fixture', factConfigured: true } };
    });
    const pending = act(current, { action: 'extract', evidenceId: 'source-1' });
    await called;
    await addSource('late-id-racing-upload', false);
    release({ jobId: 'late-unattached-job' });
    expect((await pending).status).toBe(409);
    const attempts = () => bindings.service.mock.calls.filter(([path, init]) => path === '/fact-jobs/late-unattached-job' && init?.method === 'DELETE').length;
    expect(attempts()).toBe(1);
    offline = false;
    const latest = await read();
    expect(attempts()).toBe(2);
    expect(latest.state.job).toBeNull();
    expect(latest.state.materials.flatMap(item => item.candidates)).toEqual([]);
    await read();
    expect(attempts()).toBe(2);
  });

  it('claims re-extraction before a delayed service call and blocks concurrent calculation', async () => {
    const current = await confirmed();
    let release!: (value: unknown) => void;
    let entered!: () => void;
    const called = new Promise<void>((resolve) => { entered = resolve; });
    bindings.service.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/fact-jobs') { entered(); return new Promise((resolve) => { release = resolve; }); }
      if (path === '/health') return { capabilities: { factBackend: 'controlled-test-fixture', factConfigured: true } };
      if (init?.method === 'DELETE') return { ok: true };
      throw new Error('starting job must not be remotely polled');
    });
    const pending = act(current, { action: 'extract', evidenceId: 'source-1' });
    await called;
    expect((await act(current, { action: 'calculate' })).status).toBe(409);
    const claimed = await read();
    expect(claimed.state.job!.id).toMatch(/^starting_/);
    expect(claimed.state.job!.status).toBe('running');
    expect(claimed.state.scope).toBeNull();
    expect(claimed.state.confirmations).toEqual({ due: null, paid: null });
    expect(claimed.canCalculate).toBe(false);
    expect((await act(claimed, { action: 'calculate' })).status).toBe(400);
    expect(bindings.service.mock.calls.some(([path]) => String(path).startsWith('/fact-jobs/starting_'))).toBe(false);
    release({ jobId: 'claimed-fact-job' });
    const finished = await pending;
    expect(finished.status).toBe(202);
    expect((await finished.json() as MaterialFactsResponse).state.job!.id).toBe('claimed-fact-job');
  });

  it('expires an interrupted starting claim without querying a fabricated remote job', async () => {
    const current = await read();
    const state = { ...current.state, job: { id: `starting_${Date.now() - 61_000}_synthetic`, evidenceId: 'source-1', generation: current.generation, status: 'running', error: null } };
    await bindings.DB.prepare('UPDATE case_material_facts SET state_json=? WHERE case_id=?').bind(JSON.stringify(state), 'fact-case').run();
    const latest = await read();
    expect(latest.state.job!.status).toBe('failed');
    expect(latest.state.job!.error).toContain('未能完成提交');
    expect(bindings.service.mock.calls.some(([path]) => String(path).startsWith('/fact-jobs/starting_'))).toBe(false);
  });

  it('retains a failed job as retryable state without fabricating candidates', async () => {
    const current = await read();
    expect((await act(current, { action: 'extract', evidenceId: 'source-1' })).status).toBe(202);
    bindings.service.mockImplementation(async (path: string) => {
      if (path === '/health') return { capabilities: { factBackend: 'controlled-test-fixture', factConfigured: true } };
      throw new Error('synthetic offline extraction');
    });
    const latest = await read();
    expect(latest.state.job).toMatchObject({ status: 'failed', error: 'synthetic offline extraction' });
    expect(latest.candidates).toEqual([]);
    expect(latest.state.confirmations).toEqual({ due: null, paid: null });
  });

  it('invalidates earlier confirmations even when a re-extraction cannot start', async () => {
    const current = await confirmed();
    bindings.service.mockImplementation(async (path: string) => {
      if (path === '/health') return { capabilities: { factBackend: 'controlled-test-fixture', factConfigured: true } };
      throw new Error('synthetic submission unavailable');
    });
    const response = await act(current, { action: 'extract', evidenceId: 'source-1' });
    expect(response.status).toBe(200);
    const latest = await response.json() as MaterialFactsResponse;
    expect(latest.state.job).toMatchObject({ status: 'failed', error: 'synthetic submission unavailable' });
    expect(latest.state.scope).toBeNull();
    expect(latest.state.confirmations).toEqual({ due: null, paid: null });
    expect(latest.state.materials).toEqual([]);
    expect(latest.canCalculate).toBe(false);
  });

  it('keeps malformed original model output for review while the source stays unresolved', async () => {
    const current = await read();
    expect((await act(current, { action: 'extract', evidenceId: 'source-1' })).status).toBe(202);
    bindings.service.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/health') return { capabilities: { factBackend: 'controlled-test-fixture', factConfigured: true } };
      if (init?.method === 'DELETE') return { ok: true };
      return { status: 'ready', result: { raw: 'synthetic invalid JSON response', backend: 'controlled-test-fixture', model: 'synthetic-model' } };
    });
    const latest = await read();
    expect(latest.state.job).toMatchObject({ status: 'failed', raw: 'synthetic invalid JSON response', backend: 'controlled-test-fixture', model: 'synthetic-model' });
    expect(latest.state.materials).toEqual([]);
    expect(latest.canCalculate).toBe(false);
  });

  it('preserves incomplete model output without accepting even syntactically valid candidates', async () => {
    const current = await read();
    expect((await act(current, { action: 'extract', evidenceId: 'source-1' })).status).toBe(202);
    bindings.service.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/health') return { capabilities: { factBackend: 'controlled-test-fixture', factConfigured: true } };
      if (init?.method === 'DELETE') return { ok: true };
      return { status: 'ready', result: { raw, backend: 'controlled-test-fixture', model: 'synthetic-model', finish_reason: 'length' } };
    });
    const latest = await read();
    expect(latest.state.job).toMatchObject({ status: 'failed', raw });
    expect(latest.state.job!.error).toContain('length');
    expect(latest.candidates).toEqual([]);
    expect(latest.state.materials).toEqual([]);
  });

  it('blocks dispatch for malformed stored original blocks and rejects client-owned state', async () => {
    await bindings.DB.prepare("UPDATE evidence_analyses SET result_json='{}' WHERE evidence_id='source-1'").run();
    const current = await read();
    expect(current.sources[0].ready).toBe(false);
    expect((await act(current, { action: 'extract', evidenceId: 'source-1' })).status).toBe(400);
    expect(bindings.service.mock.calls.some(([path]) => path === '/fact-jobs')).toBe(false);
    expect((await act(current, { action: 'calculate', state: { confirmed: true } })).status).toBe(400);
  });
});
