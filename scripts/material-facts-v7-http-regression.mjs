// Synthetic Issue #42 acceptance through real production Worker HTTP and
// disposable D1/R2. No live URL, model process, credential file or holdout is read.
// Run after npm run build: node scripts/material-facts-v7-http-regression.mjs [REPORT.json]
// ANXIN_MATERIAL_V7_BUILD_ROOT may point to an integrated checkout's local build.
// Each default report is unique; an explicit existing report is never overwritten.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawnOwnedChild, signalOwnedChild, stopChild } from './owned-http-process-group.mjs';
import { mkdtemp, mkdir, open, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

if (process.argv.length > 3 || process.argv[2]?.includes('://')) throw new Error('Usage: node scripts/material-facts-v7-http-regression.mjs [REPORT.json]; no live URL accepted.');
const root = resolve(process.env.ANXIN_MATERIAL_V7_BUILD_ROOT || process.cwd());
const runId = `${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}-${randomBytes(4).toString('hex')}`;
const output = resolve(process.argv[2] || process.env.ANXIN_MATERIAL_V7_HTTP_REPORT || `output/materials/http-facts-v7-${runId}.json`);
await mkdir(dirname(output), { recursive: true });
const reportFile = await open(output, 'wx', 0o600);
const owner = 'material-facts-v7-synthetic-owner';
const token = randomBytes(32).toString('hex');
const observations = [], calls = [], outputs = [], cleanupFailures = [], durableSnapshots = [], retiredServiceJobs = [];
const scenariosByEvidence = new Map(), jobs = new Map();
const shutdown = new AbortController();
const wrangler = resolve(root, 'node_modules/wrangler/bin/wrangler.js');
// The service is explicitly rules-only. Ambient backend/model settings must not
// turn this regression into actual local or remote model inference.
const workerEnv = { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false' };
let temp, worker, migrationChild, service, proxy, db, configPath, base, phase = 'setup', failure, interruption;
const sanitize = value => String(value).replaceAll(token, '[redacted]');
const errorRecord = error => ({ name: sanitize(error?.name || 'Error'), message: sanitize(error?.message || String(error)) });
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function bounded(promise, milliseconds, message) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
function loopback(value) {
  const url = new URL(value);
  assert(url.protocol === 'http:' && url.hostname === '127.0.0.1' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash, 'Only runner-created loopback servers are allowed.');
  return url;
}
const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(`http://127.0.0.1:${server.address().port}`); });
});
const headers = () => ({ 'oai-authenticated-user-id': owner, 'oai-authenticated-user-email': `${owner}@synthetic.test` });
async function jsonRequest(url, init = {}) {
  assert.equal(new URL(url).hostname, '127.0.0.1');
  const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(25_000)]) });
  return { status: response.status, body: await response.json() };
}
const request = (path, method = 'GET', body) => jsonRequest(`${base}${path}`, {
  method, headers: headers(), ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
});
const stored = caseId => {
  const row = db.prepare('SELECT revision,state_json FROM case_material_facts WHERE case_id=? AND user_id=?').get(caseId, owner);
  assert(row, 'Synthetic case fact row must be persisted.');
  return { revision: row.revision, state: JSON.parse(row.state_json) };
};
const money = (value, quote, attributes = {}) => ({ kind: 'money', value, quote, subject: '测试王甲', scope: 'individual', meaning: 'due_total', completeness: 'complete', period: '2026年1月', rateUnit: null, assertion: 'narrated', ...attributes });
const envelope = candidates => JSON.stringify({ schemaVersion: 3, candidates });
function boundCandidate(source, entry) {
  const matches = source.blocks.filter(block => block.text.includes(entry.quote));
  assert.equal(matches.length, 1, 'Synthetic candidate quote must identify one source block.');
  return { kind: entry.kind, value: entry.value, quote: entry.quote, blockId: matches[0].id, subject: entry.subject, scope: entry.scope, meaning: entry.meaning, completeness: entry.completeness, period: entry.period, rateUnit: entry.rateUnit, assertion: entry.assertion };
}
function unconfirmed(response) {
  assert.equal(response.canCalculate, false);
  assert.equal(response.state.scope, null);
  assert.deepEqual(response.state.confirmations, { due: null, paid: null });
  assert.equal(response.state.calculation, null);
  assert.deepEqual(response.fields.due.values, []);
  assert.deepEqual(response.fields.paid.values, []);
}
function rawAndLocations(item, response) {
  const material = response.state.materials.find(material => material.evidenceId === item.evidenceId);
  assert(material, 'Accepted synthetic extraction must have a material record.');
  const injected = outputs.findLast(result => result.evidenceId === item.evidenceId);
  assert(injected, 'A real queue GET must have received the synthetic fixture.');
  assert.equal(material.raw, injected.raw);
  assert.equal(material.backend, 'synthetic-http-fixture');
  assert.equal(material.model, null);
  for (const candidate of material.candidates) {
    const block = item.analysis.result.blocks.find(block => block.id === candidate.blockId);
    assert(block);
    assert.equal(Array.from(block.text).slice(candidate.start, candidate.end).join(''), candidate.quote);
    assert.equal(candidate.sourceSha256, item.analysis.result.source.sha256);
    assert.equal(candidate.normalization.rawValue, candidate.value);
    assert(candidate.quote.includes(candidate.value));
    const original = injected.candidates.find(entry => entry.quote === candidate.quote && entry.value === candidate.value && entry.meaning === candidate.representation.meaning);
    assert.deepEqual(candidate.representation, original, 'Derived money must never rewrite original model attributes.');
  }
  return material;
}
async function retireConsumedServiceJob(kind, jobId, evidenceId) {
  assert(['jobs', 'fact-jobs'].includes(kind));
  assert(scenariosByEvidence.has(evidenceId), 'Only this run\'s synthetic evidence may be retired.');
  assert.match(jobId, /^[0-9a-f-]{36}$/u);
  const url = `http://127.0.0.1:${proxy.address().port}/${kind}/${jobId}`;
  // The bounded service retains 32 jobs. Retire only completed backend copies
  // after the Worker has persisted them; keep its D1/R2, raw and audit history.
  const result = await jsonRequest(url, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  assert.equal(result.status, 200); assert.equal(result.body.ok, true);
  retiredServiceJobs.push({ kind, jobId, evidenceId, persistedBeforeRetirement: true });
}
async function fixture(name, specifications) {
  const created = await request('/api/cases', 'POST', { company: `合成V7回归-${name}`, type: '欠薪争议', description: '仅用于软件HTTP回归，非真实案件、非模型或业务验收。' });
  assert.equal(created.status, 201); const caseId = created.body.case.id;
  const items = [];
  // Upload every source before extraction so a later source upload cannot hide
  // whether a failed extraction preserves an already stored material/history.
  for (const spec of specifications) {
    const bytes = Buffer.from(spec.exactSource ? spec.text : `合成软件测试材料（非真实案件）。😀𠮷 ${spec.text}`, 'utf8');
    const form = new FormData(); form.set('caseId', caseId); form.set('operationId', randomUUID());
    form.set('file', new File([bytes], `synthetic-v7-${name}-${items.length}.txt`, { type: 'text/plain' }));
    const uploaded = await request('/api/evidence', 'POST', form); assert.equal(uploaded.status, 201);
    const evidenceId = uploaded.body.evidence.id;
    scenariosByEvidence.set(evidenceId, spec);
    const began = await request(`/api/evidence/${evidenceId}/analysis`, 'POST', { documentKind: 'other' });
    // The real route may finish TXT extraction during POST and return ready/200.
    // Keep status/state agreement strict; all source bytes are checked below.
    assert(['running', 'ready'].includes(began.body.analysis?.status), 'TXT analysis POST must be running or ready.');
    assert.equal(began.status, began.body.analysis.status === 'running' ? 202 : 200);
    let analysis;
    for (let attempt = 0; ; attempt++) {
      const read = await request(`/api/evidence/${evidenceId}/analysis`); assert.equal(read.status, 200); analysis = read.body.analysis;
      if (analysis.status === 'ready') break;
      assert.equal(analysis.status, 'running', JSON.stringify(analysis)); assert(attempt < 100, 'Synthetic TXT analysis timed out.'); await wait(50);
    }
    assert.equal(analysis.result.source.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(analysis.result.blocks.map(block => block.text).join('\n'), bytes.toString('utf8'));
    const downloaded = await fetch(`${base}/api/evidence/${evidenceId}/download`, { headers: headers(), signal: AbortSignal.timeout(10_000) });
    assert.equal(downloaded.status, 200); assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), bytes);
    const query = db.prepare('SELECT * FROM evidence_analyses WHERE evidence_id=? AND user_id=?');
    const persisted = query.get(evidenceId, owner);
    assert.equal(persisted.status, 'ready');
    await retireConsumedServiceJob('jobs', persisted.job_id, evidenceId);
    assert.deepEqual(query.get(evidenceId, owner), persisted);
    items.push({ caseId, evidenceId, path: `/api/cases/${caseId}/facts`, analysis });
  }
  return items;
}
async function extract(item) {
  const current = await request(item.path); assert.equal(current.status, 200);
  const began = await request(item.path, 'POST', { action: 'extract', evidenceId: item.evidenceId, revision: current.body.revision, generation: current.body.generation });
  assert.equal(began.status, 202, JSON.stringify(began.body));
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await request(item.path); assert.equal(result.status, 200);
    if (result.body.state.job?.status !== 'running') {
      const persisted = stored(item.caseId); assert.equal(persisted.revision, result.body.revision);
      assert.deepEqual(persisted.state.history, result.body.state.history);
      unconfirmed(result.body);
      const injected = outputs.findLast(output => output.evidenceId === item.evidenceId);
      assert(injected, 'Terminal synthetic extraction must have an owned service job.');
      await retireConsumedServiceJob('fact-jobs', injected.jobId, item.evidenceId);
      assert.deepEqual(stored(item.caseId), persisted);
      return result.body;
    }
    await wait(50);
  }
  throw new Error('Synthetic fact extraction did not reach a terminal state.');
}
async function scenario(name, operation) {
  phase = name; shutdown.signal.throwIfAborted();
  try { const detail = await operation(); observations.push({ name, status: 'PASS', ...detail }); }
  catch (error) { observations.push({ name, status: 'FAIL', failure: errorRecord(error) }); }
}
async function startWorker() {
  shutdown.signal.throwIfAborted(); const probe = createServer(); base = await listen(probe);
  const port = new URL(base).port; await new Promise(resolve => probe.close(resolve)); loopback(base);
  worker = spawnOwnedChild(process.execPath, [wrangler, 'dev', '--local', '--config', configPath, '--persist-to', join(temp, 'state'), '--ip', '127.0.0.1', '--port', port, '--inspector-port', '0'], { cwd: root, env: workerEnv });
  let startError; worker.once('error', error => { startError = error; });
  for (let attempt = 0; attempt < 100; attempt++) {
    shutdown.signal.throwIfAborted(); if (startError) throw startError;
    if (worker.exitCode !== null || worker.signalCode !== null) throw new Error('Isolated Worker stopped before readiness.');
    try { const response = await fetch(`${base}/api/bootstrap`, { redirect: 'error', signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(1000)]) }); await response.arrayBuffer(); if (response.status === 401) return; } catch { /* Bounded startup of the runner-owned Worker. */ }
    await wait(200);
  }
  throw new Error('Isolated Worker readiness timed out.');
}
async function cleanup(name, operation) { try { await operation(); } catch (error) { cleanupFailures.push({ operation: name, ...errorRecord(error) }); } }
// Keep these CLI handlers through report publication and exit. A repeated
// signal cannot restore default termination or signal the owned group twice.
const interrupt = signal => {
  if (shutdown.signal.aborted) return;
  const error = new Error(`Synthetic HTTP regression interrupted by ${signal}.`);
  interruption = { phase, signal, ...errorRecord(error) };
  process.exitCode = 1;
  shutdown.abort(error);
  for (const child of [worker, migrationChild]) {
    try { signalOwnedChild(child, 'SIGTERM'); }
    catch (error) { cleanupFailures.push({ operation: 'interrupt_owned_processes', ...errorRecord(error) }); }
  }
};
process.on('SIGINT', () => interrupt('SIGINT')); process.on('SIGTERM', () => interrupt('SIGTERM'));

try {
  const originalPath = resolve(root, 'dist/server/wrangler.json');
  const config = JSON.parse(await readFile(originalPath, 'utf8'));
  const { createMaterialService } = await import(pathToFileURL(resolve(root, 'scripts/material-service.mjs')));
  temp = await mkdtemp(join(tmpdir(), 'anxin-facts-v7-http-'));
  service = await createMaterialService({ token, model: null, facts: { backend: 'rules' } }); loopback(service.url);
  // Preserve the actual authenticated service, TXT OCR path and bounded fact
  // queue. Replace only a genuinely ready fact result, never a Worker route or
  // persisted state. This is explicit synthetic output injection, not inference.
  proxy = createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) { req.resume(); res.writeHead(401); res.end('{}'); return; }
    const target = new URL(req.url, service.url);
    if (target.origin !== new URL(service.url).origin || !req.url.startsWith('/') || req.url.startsWith('//')) { req.resume(); res.writeHead(400); res.end('{}'); return; }
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk); const bytes = Buffer.concat(chunks);
      const isPost = req.method === 'POST' && target.pathname === '/fact-jobs';
      const isGet = req.method === 'GET' && /^\/fact-jobs\//u.test(target.pathname);
      const payload = isPost ? JSON.parse(bytes.toString('utf8')) : null;
      const upstream = await fetch(target, { method: req.method, headers: { Authorization: `Bearer ${token}`, ...(req.headers['content-type'] ? { 'Content-Type': req.headers['content-type'] } : {}) }, redirect: 'error', signal: AbortSignal.timeout(20_000), ...(bytes.length ? { body: bytes } : {}) });
      let body = Buffer.from(await upstream.arrayBuffer());
      if (isPost || isGet || req.method === 'DELETE') calls.push({ method: req.method, path: target.pathname, upstreamStatus: upstream.status, authenticated: true });
      if (isPost && upstream.status === 202) {
        const spec = scenariosByEvidence.get(payload.source.id); assert(spec, 'Unexpected fact source; no inference fixture was registered.');
        const candidates = (spec.candidates || []).map(entry => boundCandidate(payload.source, entry));
        const fixture = { evidenceId: payload.source.id, jobId: JSON.parse(body).jobId, raw: spec.raw ?? envelope(candidates), candidates, finish_reason: spec.finish_reason ?? 'stop' };
        jobs.set(fixture.jobId, fixture); outputs.push(fixture);
      }
      if (isGet && upstream.status === 200) {
        const result = JSON.parse(body), fixture = jobs.get(target.pathname.split('/').at(-1));
        if (result.status === 'ready') {
          assert(fixture, 'A ready fact queue result must have a registered synthetic output.');
          body = Buffer.from(JSON.stringify({ status: 'ready', result: { raw: fixture.raw, backend: 'synthetic-http-fixture', model: null, finish_reason: fixture.finish_reason } }));
        }
      }
      res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/json' }); res.end(body);
    } catch (error) {
      failure ??= { phase: 'synthetic_result_proxy', ...errorRecord(error) };
      if (!res.destroyed && !res.headersSent) { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end('{}'); } else res.destroy();
    }
  });
  const proxyUrl = await listen(proxy); loopback(proxyUrl);
  config.main = resolve(dirname(originalPath), config.main);
  if (config.assets?.directory) config.assets.directory = resolve(dirname(originalPath), config.assets.directory);
  for (const item of config.d1_databases ?? []) item.migrations_dir = resolve(root, 'drizzle');
  config.vars = { ...config.vars, ANXIN_MATERIAL_SERVICE_URL: proxyUrl, ANXIN_MATERIAL_SERVICE_TOKEN: token };
  configPath = join(temp, 'wrangler.json'); await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  migrationChild = spawnOwnedChild(process.execPath, [wrangler, 'd1', 'migrations', 'apply', 'DB', '--local', '--config', configPath, '--persist-to', join(temp, 'state')], { cwd: root, env: workerEnv });
  let migrationFailure;
  try { await bounded(new Promise((resolve, reject) => { migrationChild.once('error', reject); migrationChild.once('exit', code => code === 0 ? resolve() : reject(new Error(`Isolated D1 migrations exited ${code}.`))); }), 60_000, 'Isolated migrations timed out.'); }
  catch (error) { migrationFailure = error; throw error; }
  finally {
    try { await stopChild(migrationChild, 'Migration'); migrationChild = undefined; }
    catch (error) { cleanupFailures.push({ operation: 'stop_migration', ...errorRecord(error) }); if (!migrationFailure) throw error; }
  }
  for (const path of (await readdir(join(temp, 'state'), { recursive: true })).filter(path => path.endsWith('.sqlite'))) {
    const candidate = new DatabaseSync(join(temp, 'state', path));
    if (candidate.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cases'").get()) { db = candidate; break; }
    candidate.close();
  }
  assert(db, 'Disposable on-disk D1 must exist.'); db.exec('PRAGMA busy_timeout=5000'); await startWorker();

  await scenario('lowercase_chinese_rmb_preserves_original_and_codepoint_locations', async () => {
    const quote = '测试王甲2026年1月完整应付工资四万元';
    const [item] = await fixture('lowercase-rmb', [{ text: `${quote}。`, candidates: [money('四万元', quote)] }]);
    const response = await extract(item); assert.equal(response.state.job, null);
    const material = rawAndLocations(item, response); assert.equal(material.candidates.length, 1);
    const candidate = material.candidates[0]; assert.equal(candidate.amount, '40000.00');
    assert.equal(candidate.normalization.status, 'exact'); assert.equal(candidate.value, '四万元'); assert.equal(candidate.quote, quote);
    assert.equal(Array.from(candidate.value).slice(candidate.normalization.span.start, candidate.normalization.span.end).join(''), candidate.normalization.matchedText);
    // The astral prefix makes UTF-16 indexing observably different from codepoints.
    const block = item.analysis.result.blocks.find(block => block.id === candidate.blockId);
    assert.notEqual(candidate.start, block.text.indexOf(quote));
    const calculated = await request(item.path, 'POST', { action: 'calculate', revision: response.revision, generation: response.generation }); assert.equal(calculated.status, 400);
    const reread = await request(item.path); assert.equal(reread.status, 200); unconfirmed(reread.body);
    durableSnapshots.push({ name: 'lowercase-rmb', item, state: stored(item.caseId) });
    return { amount: candidate.amount, rawValue: candidate.value, quote: candidate.quote, start: candidate.start, end: candidate.end, automaticCalculation: false };
  });
  await scenario('wage_description_without_money_is_rejected_and_raw_remains_visible', async () => {
    const quote = '测试王甲2026年1月工资按月发放';
    const [item] = await fixture('not-money', [{ text: `${quote}。`, candidates: [money('工资按月发放', quote)] }]);
    const response = await extract(item); assert.equal(response.state.job, null);
    const material = rawAndLocations(item, response); assert.equal(material.candidates.length, 0); assert.equal(material.rejected.length, 1);
    assert.equal(material.rejected[0].index, 0); assert.match(material.rejected[0].reason, /没有金额表达/u);
    assert.equal(material.coverage.acceptedCount, 0); assert.equal(material.coverage.rejectedCount, 1);
    assert.equal(JSON.parse(material.raw).candidates[0].value, '工资按月发放');
    durableSnapshots.push({ name: 'not-money', item, state: stored(item.caseId) });
    return { accepted: 0, rejected: 1, rawRetained: true };
  });
  await scenario('same_amount_and_attributes_at_two_payment_events_are_both_retained', async () => {
    const first = '2026年2月1日单位向测试王甲支付2026年1月工资1000元';
    const second = '2026年2月2日单位向测试王甲支付2026年1月工资1000元';
    const attributes = { meaning: 'payment', completeness: 'partial' };
    const [item] = await fixture('two-payments', [{ text: `${first}。${second}。`, candidates: [money('1000元', first, attributes), money('1000元', second, attributes)] }]);
    const response = await extract(item); const material = rawAndLocations(item, response);
    assert.equal(material.candidates.length, 2); assert.equal(material.rejected.length, 0);
    assert.deepEqual(material.candidates.map(candidate => candidate.amount), ['1000.00', '1000.00']);
    const attributesOnly = entry => { const { quote, blockId, ...rest } = entry.representation; void quote; void blockId; return rest; };
    assert.deepEqual(attributesOnly(material.candidates[0]), attributesOnly(material.candidates[1]));
    assert.notEqual(material.candidates[0].id, material.candidates[1].id);
    assert.notEqual(material.candidates[0].start, material.candidates[1].start);
    durableSnapshots.push({ name: 'two-payments', item, state: stored(item.caseId) });
    return { acceptedPayments: 2, distinctSourcePositions: true, automaticSummation: false };
  });
  await scenario('ambiguous_equal_payment_quotes_preserve_both_observations_for_review', async () => {
    const attributes = { meaning: 'payment', completeness: 'partial', period: null };
    const [item] = await fixture('ambiguous-payments', [{ text: '测试王甲第一次收到四万元。测试王甲第二次收到四万元。',
      candidates: [money('四万元', '四万元', attributes), money('四万元', '四万元', attributes)] }]);
    const material = rawAndLocations(item, await extract(item));
    assert.equal(material.candidates.length, 2); assert.equal(material.rejected.length, 0);
    assert.notEqual(material.candidates[0].id, material.candidates[1].id);
    assert(material.candidates.every(candidate => candidate.reviewIssues.length > 0));
    durableSnapshots.push({ name: 'ambiguous-payments', item, state: stored(item.caseId) });
    return { acceptedForReview: 2, uniqueEventClaim: false, rawRetained: true, automaticSummation: false };
  });
  for (const reverse of [false, true]) await scenario(`narrative_and_minimal_amount_both_survive_${reverse ? 'minimal' : 'narrative'}_first`, async () => {
    const quote = '测试王甲声称公司应支付四万元工资';
    const attributes = { period: null, meaning: 'arrears', completeness: 'not_applicable', assertion: 'claimed' };
    const entries = [money(quote, quote, attributes), money('四万元', quote, attributes)];
    if (reverse) entries.reverse();
    const [item] = await fixture(`narrative-order-${reverse}`, [{ text: `${quote}。`, candidates: entries }]);
    const material = rawAndLocations(item, await extract(item));
    assert.equal(material.candidates.length, 2); assert.equal(material.rejected.length, 0);
    assert.deepEqual(material.candidates.map(candidate => candidate.value), entries.map(entry => entry.value));
    durableSnapshots.push({ name: `narrative-order-${reverse}`, item, state: stored(item.caseId) });
    return { acceptedForReview: 2, minimalValuePreserved: true, order: reverse ? 'minimal-first' : 'narrative-first' };
  });
  await scenario('relative_month_description_is_rejected_but_unknown_amount_is_retained', async () => {
    const attributes = { period: null, meaning: 'other_money', completeness: 'not_applicable' };
    const [item] = await fixture('relative-month-no-money', [{ text: '测试王甲这个月工资。测试王甲当月工资未明确。', candidates: [
      money('这个月工资', '测试王甲这个月工资', attributes), money('当月工资未明确', '测试王甲当月工资未明确', attributes),
    ] }]);
    const material = rawAndLocations(item, await extract(item));
    assert.equal(material.candidates.length, 1); assert.equal(material.rejected.length, 1);
    assert.equal(material.rejected[0].index, 0); assert.match(material.rejected[0].reason, /没有金额表达/u);
    assert.equal(material.candidates[0].value, '当月工资未明确'); assert.equal(material.candidates[0].amount, null);
    assert.equal(JSON.parse(material.raw).candidates.length, 2);
    durableSnapshots.push({ name: 'relative-month-no-money', item, state: stored(item.caseId) });
    return { acceptedUnknownForReview: 1, rejectedDescription: 1, amount: null, rawRetained: true };
  });
  await scenario('relative_day_descriptions_reject_without_erasing_unknown_money_or_raw', async () => {
    const words = ['今日', '当日', '昨日', '当天'];
    const attributes = { period: null, meaning: 'other_money', completeness: 'not_applicable' };
    const candidates = words.map(word => money(`${word}工资`, `测试王甲${word}工资`, attributes));
    candidates.push(money('今日工资未明确', '测试王甲今日工资未明确', attributes));
    const [item] = await fixture('relative-day-no-money', [{ text: candidates.map(entry => entry.quote + '。').join(''), candidates }]);
    const material = rawAndLocations(item, await extract(item));
    assert.equal(material.candidates.length, 1); assert.equal(material.rejected.length, 4);
    assert(material.rejected.every(entry => /没有金额表达/u.test(entry.reason)));
    assert.equal(material.candidates[0].value, '今日工资未明确'); assert.equal(material.candidates[0].amount, null);
    assert.equal(JSON.parse(material.raw).candidates.length, 5);
    durableSnapshots.push({ name: 'relative-day-no-money', item, state: stored(item.caseId) });
    return { rejectedDescriptions: 4, acceptedUnknownForReview: 1, rawRetained: true };
  });
  for (const day of ['今日', '当日', '昨日', '明日', '本日']) await scenario(`relative_day_total_${day}_retains_amount_for_review`, async () => {
    const quote = `测试王甲${day}工资合计四万元`;
    const [item] = await fixture(`relative-day-total-${day}`, [{ text: `${quote}。`, candidates: [money('四万元', quote, { period: null })] }]);
    const response = await extract(item); const material = rawAndLocations(item, response); unconfirmed(response);
    assert.equal(material.candidates.length, 1); assert.equal(material.rejected.length, 0);
    const candidate = material.candidates[0]; assert.equal(candidate.amount, '40000.00');
    assert(!candidate.reviewIssues.some(issue => issue.code === 'rate_unit_mismatch'));
    durableSnapshots.push({ name: `relative-day-total-${day}`, item, state: stored(item.caseId) });
    return { amount: candidate.amount, noAutomaticConfirmation: true, rawRetained: true };
  });
  const guards = [
    { name: 'range', text: '测试王甲2026年1月完整应付工资四万至五万元。', value: '四万至五万元', status: 'range' },
    { name: 'foreign-currency', text: '测试王甲2026年1月完整应付工资美元四万元。', value: '四万元', quote: '四万元', status: 'unsupported' },
    { name: 'internal-token-crop', text: '测试王甲2026年1月完整应付工资十四万元。', value: '四万元', quote: '四万元', status: 'unsupported' },
    { name: 'cropped-approximation', text: '测试王甲2026年1月完整应付工资约四万元。', value: '四万元', quote: '四万元', status: 'approximate' },
    { name: 'explicit-relative-day-standard-is-rate', text: '测试王甲2026年1月约定今日日工资标准为四万元。', value: '四万元', quote: '四万元', status: 'rate_unit_mismatch' },
    { name: 'rate-as-total', text: '测试王甲2026年1月工资四万元/月。', value: '四万元', quote: '四万元', status: 'rate_unit_mismatch' },
    { name: 'currency-wage-attribution', text: '测试王甲2026年1月工资以港币支付四万元。', value: '四万元', quote: '四万元', status: 'unsupported' },
    { name: 'currency-wage-postposed-attribution', text: '测试王甲2026年1月应付工资四万元以港币支付。', value: '四万元', quote: '四万元', status: 'unsupported' },
    { name: 'wage-noun-multiplier', text: '测试王甲2026年1月应付四万元基本工资的2倍。', value: '四万元', quote: '四万元', status: 'unsupported' },
    { name: 'wage-noun-operator', text: '测试王甲2026年1月应付四万元工资×2。', value: '四万元', quote: '四万元', status: 'unsupported' },
    { name: 'wage-noun-bare-multiplier', text: '测试王甲2026年1月应付四万元工资2倍。', value: '四万元', quote: '四万元', status: 'unsupported' },
    { name: 'calendar-wage-standard-as-total', text: '测试王甲2026年1月工资标准为四万元。', value: '四万元', quote: '四万元', status: 'rate_unit_mismatch' },
    { name: 'monthly-base-wage-as-total', text: '测试王甲2026年1月约定每月基本工资四万元。', value: '四万元', quote: '四万元', status: 'rate_unit_mismatch' },
    { name: 'monthly-standard-colon-as-total', text: '测试王甲2026年1月约定月薪标准：四万元。', value: '四万元', quote: '四万元', status: 'rate_unit_mismatch' },
    { name: 'full-multiplier', text: '测试王甲2026年1月应付工资四万元的2倍。', value: '四万元的2倍', status: 'unsupported' },
    { name: 'cropped-unicode-multiplier', text: '测试王甲2026年1月应付工资四万元的２\u200b倍。', value: '四万元', quote: '四万元', status: 'unsupported' },
    { name: 'cropped-arithmetic-division', text: '测试王甲2026年1月应付工资40000元/2。', value: '40000元', quote: '40000元', status: 'unsupported' },
    { name: 'cropped-multiline-multiplier', text: '测试王甲2026年1月应付工资四万元的\n2倍。', value: '四万元', quote: '四万元', status: 'unsupported' },
    { name: 'cropped-arithmetic-addition', text: '测试王甲2026年1月应付工资40000元加上2000元。', value: '40000元', quote: '40000元', status: 'unsupported' },
  ];
  for (const guard of guards) await scenario(`${guard.name}_never_becomes_usable_exact_money`, async () => {
    const [item] = await fixture(guard.name, [{ text: guard.text, candidates: [money(guard.value, guard.quote || guard.text.slice(0, -1))] }]);
    const response = await extract(item); const material = rawAndLocations(item, response); assert.equal(material.candidates.length, 1);
    const candidate = material.candidates[0]; assert.equal(candidate.amount, null); assert.equal(candidate.normalization.amount, null); assert.equal(candidate.normalization.status, guard.status);
    assert.notEqual(candidate.amount, '0.00');
    durableSnapshots.push({ name: guard.name, item, state: stored(item.caseId) });
    return { acceptedForReview: 1, normalization: candidate.normalization.status, amount: null, rawRetained: true };
  });
  await scenario('separate_event_multiplier_does_not_erase_a_literal_wage', async () => {
    const quote = '测试王甲2026年1月完整应付工资四万元';
    const [item] = await fixture('unrelated-multiplier', [{ text: `${quote}。测试李乙的奖金为基数的2倍。`, candidates: [money('四万元', quote)] }]);
    const material = rawAndLocations(item, await extract(item));
    assert.equal(material.candidates.length, 1); assert.equal(material.candidates[0].amount, '40000.00');
    durableSnapshots.push({ name: 'unrelated-multiplier', item, state: stored(item.caseId) });
    return { amount: '40000.00', rawRetained: true, automaticCalculation: false };
  });
  await scenario('historical_exact_operand_is_downgraded_on_read_without_rewriting_raw_or_storage', async () => {
    const [item] = await fixture('historical-arithmetic', [{ text: '测试王甲2026年1月应付工资40000元的2倍。', candidates: [money('40000元', '40000元')] }]);
    const response = await extract(item); const material = rawAndLocations(item, response);
    assert.equal(material.candidates[0].amount, null);
    // Explicitly emulate a pre-fix stored derived value; the original model
    // output and source are never changed. This is synthetic migration coverage.
    const legacy = stored(item.caseId);
    const candidate = legacy.state.materials[0].candidates[0];
    candidate.amount = '40000.00'; candidate.normalization.amount = '40000.00'; candidate.normalization.status = 'exact';
    db.prepare('UPDATE case_material_facts SET state_json=? WHERE case_id=? AND user_id=?').run(JSON.stringify(legacy.state), item.caseId, owner);
    const before = stored(item.caseId); const read = await request(item.path);
    assert.equal(read.status, 200); unconfirmed(read.body);
    const checked = rawAndLocations(item, read.body).candidates[0];
    assert.equal(checked.amount, null); assert.equal(checked.normalization.amount, null); assert.equal(checked.normalization.status, 'unsupported');
    assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({ name: 'historical-arithmetic', item, state: before });
    return { historicalOperandDowngraded: true, rawAndStoredStateUnchanged: true, automaticCalculation: false };
  });
  for (const spec of [
    { name: 'currency-bare-count', text: '测试王甲2026年1月工资以港币计四万元', value: '四万元', amount: null },
    { name: 'currency-calculation', text: '测试王甲2026年1月工资以美元计算四万元', value: '四万元', amount: null },
    { name: 'named-factor', text: '测试王甲2026年1月工资四万元乘以出勤系数', value: '四万元', amount: null },
    { name: 'named-factor-full', text: '测试王甲2026年1月工资四万元乘以出勤系数', value: '四万元乘以出勤系数', amount: null },
    { name: 'range-first', text: '测试王甲2026年1月工资在3万元和4万元之间', value: '3万元', amount: null },
    { name: 'range-second', text: '测试王甲2026年1月工资介于3万元与4万元', value: '4万元', amount: null },
    { name: 'range-layout', text: '测试王甲2026年1月工资在3万元\n和4万元之间', value: '3万元', amount: null },
    { name: 'arabic-jiao', text: '测试王甲2026年1月完整应付工资5元5角', value: '5元5角', amount: '5.50' },
    { name: 'arabic-fen', text: '测试王甲2026年1月完整应付工资5元5角2分', value: '5元5角2分', amount: '5.52' },
    { name: 'arabic-cropped-fen', text: '测试王甲2026年1月完整应付工资5元5角2分', value: '5元5角', amount: null },
  ]) await scenario(`round11_${spec.name}_source_and_raw`, async () => {
    const [item] = await fixture(spec.name, [{ text: spec.text, candidates: [money(spec.value, spec.value)] }]);
    const material = rawAndLocations(item, await extract(item));
    assert.equal(material.candidates.length, 1); assert.equal(material.candidates[0].amount, spec.amount);
    if (spec.amount === null) assert.notEqual(material.candidates[0].normalization.status, 'exact');
    durableSnapshots.push({ name: spec.name, item, state: stored(item.caseId) });
    return { amount: spec.amount, rawRetained: true, automaticCalculation: false };
  });
  await scenario('round11_historical_exact_range_is_downgraded_without_storage_rewrite', async () => {
    const [item] = await fixture('historical-range', [{ text: '测试王甲2026年1月工资在3万元和4万元之间', candidates: [money('3万元', '3万元')] }]);
    await extract(item);
    const legacy = stored(item.caseId), candidate = legacy.state.materials[0].candidates[0];
    candidate.amount = '30000.00';
    candidate.normalization = { rawValue: '3万元', amount: '30000.00', status: 'exact', matchedText: '3万元', span: { start: 0, end: 3 }, reason: 'Synthetic pre-fix exact endpoint' };
    db.prepare('UPDATE case_material_facts SET state_json=? WHERE case_id=? AND user_id=?').run(JSON.stringify(legacy.state), item.caseId, owner);
    const before = stored(item.caseId), read = await request(item.path);
    assert.equal(read.status, 200); unconfirmed(read.body);
    const checked = rawAndLocations(item, read.body).candidates[0];
    assert.equal(checked.amount, null); assert.equal(checked.normalization.status, 'range');
    assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({ name: 'historical-range', item, state: before });
    return { rangeEndpointDowngraded: true, storedRawAndHistoryUnchanged: true };
  });
  for (const spec of [
    { name: 'modified-factor', text: '测试王甲2026年1月工资四万元乘以实际出勤系数', value: '四万元', amount: null },
    { name: 'duration-fen-full', text: '测试王甲收到工资1000元5分钟后离开', value: '1000元5分钟后离开', amount: null },
    { name: 'duration-fen-crop', text: '测试王甲收到工资1000元5分钟后离开', value: '1000元5分', amount: null },
    { name: 'fraction-as-fen', text: '测试王甲应付工资1000元5分之一', value: '1000元5分', amount: null },
    { name: 'traditional-approximation', text: '测试王甲工资約四千圓', value: '四千圓', amount: null },
    { name: 'duration-fen-layout', text: '测试王甲收到工资1000元5分\n钟后离开', value: '1000元5分', amount: null },
    { name: 'real-cents', text: '测试王甲2026年1月完整应付工资1000元5分', value: '1000元5分', amount: '1000.05' },
    { name: 'until-date', text: '测试王甲拖欠工资3万元至2024年5月仍未支付', value: '3万元', amount: '30000.00' },
    { name: 'within-months', text: '测试王甲拖欠工资3万元至4个月内付清', value: '3万元', amount: '30000.00' },
    { name: 'traditional-yuan', text: '测试王甲2026年1月完整应付工资人民幣四千圓', value: '人民幣四千圓', amount: '4000.00' },
    { name: 'traditional-cropped-cents', text: '测试王甲工资4000圓5角', value: '4000', amount: null },
    { name: 'traditional-cropped-rate', text: '测试王甲工资4000圓/月', value: '4000', amount: null },
  ]) await scenario(`round12_${spec.name}_source_and_raw`, async () => {
    const [item] = await fixture(spec.name, [{ text: spec.text, candidates: [money(spec.value, spec.value, { period: spec.text.includes('2026年1月') ? '2026年1月' : null })] }]);
    const material = rawAndLocations(item, await extract(item));
    assert.equal(material.candidates.length, 1); assert.equal(material.candidates[0].amount, spec.amount);
    if (spec.amount === null) assert.notEqual(material.candidates[0].normalization.status, 'exact');
    durableSnapshots.push({ name: spec.name, item, state: stored(item.caseId) });
    return { amount: spec.amount, rawRetained: true, automaticCalculation: false };
  });
  await scenario('round12_wage_standard_without_an_amount_is_rejected_but_raw_retained', async () => {
    const [item] = await fixture('no-amount-standard', [{ text: '测试王甲工资标准', candidates: [money('工资标准', '工资标准', { period: null })] }]);
    const material = rawAndLocations(item, await extract(item));
    assert.equal(material.candidates.length, 0);
    assert.equal(material.rejected.length, 1);
    durableSnapshots.push({ name: 'no-amount-standard', item, state: stored(item.caseId) });
    return { rejectedNonMoney: true, rawRetained: true };
  });
  await scenario('round12_historical_clock_as_cents_is_downgraded_without_storage_rewrite', async () => {
    const [item] = await fixture('historical-clock-cents', [{ text: '测试王甲收到工资1000元5分钟后离开', candidates: [money('1000元5分', '1000元5分', { period: null })] }]);
    await extract(item);
    const legacy = stored(item.caseId), candidate = legacy.state.materials[0].candidates[0];
    candidate.amount = '1000.05';
    candidate.normalization = { rawValue: '1000元5分', amount: '1000.05', status: 'exact', matchedText: '1000元5分', span: { start: 0, end: 7 }, reason: 'Synthetic pre-fix clock interpreted as cents' };
    db.prepare('UPDATE case_material_facts SET state_json=? WHERE case_id=? AND user_id=?').run(JSON.stringify(legacy.state), item.caseId, owner);
    const before = stored(item.caseId), read = await request(item.path);
    assert.equal(read.status, 200); unconfirmed(read.body);
    const checked = rawAndLocations(item, read.body).candidates[0];
    assert.equal(checked.amount, null); assert.notEqual(checked.normalization.status, 'exact');
    assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({ name: 'historical-clock-cents', item, state: before });
    return { clockAsCentsDowngraded: true, storedRawAndHistoryUnchanged: true };
  });
  // ROUND13 additions: keep the original 64 scenarios and their assertions unchanged.
  for (const spec of [
    { name: 'mixed-jiao', value: '5元五角', amount: '5.50' },
    { name: 'mixed-zero-fen', value: '5元零五分', amount: '5.05' },
  ]) await scenario(`round13_${spec.name}_retains_raw_and_derives_exact_money`, async () => {
    const [item] = await fixture(spec.name, [{ text: `测试王甲2026年1月完整应付工资${spec.value}。`, candidates: [money(spec.value, spec.value)] }]);
    const material = rawAndLocations(item, await extract(item));
    assert.equal(material.candidates.length, 1); assert.equal(material.rejected.length, 0);
    const candidate = material.candidates[0];
    assert.equal(candidate.amount, spec.amount); assert.equal(candidate.normalization.amount, spec.amount);
    assert.equal(candidate.normalization.status, 'exact'); assert.equal(candidate.value, spec.value); assert.equal(candidate.quote, spec.value);
    assert.equal(Array.from(candidate.value).slice(candidate.normalization.span.start, candidate.normalization.span.end).join(''), candidate.normalization.matchedText);
    assert.equal(JSON.parse(material.raw).candidates[0].value, spec.value);
    durableSnapshots.push({ name: spec.name, item, state: stored(item.caseId) });
    return { amount: spec.amount, rawValue: spec.value, rawAndCodepointsPreserved: true, automaticCalculation: false };
  });
  for (const value of ['5元五角', '5元零五分']) await scenario(`round13_cropped_${value}_never_becomes_exact_five_yuan`, async () => {
    const name = `cropped-mixed-${value}`;
    const [item] = await fixture(name, [{ text: `测试王甲2026年1月完整应付工资${value}。`, candidates: [money('5元', '5元')] }]);
    const material = rawAndLocations(item, await extract(item));
    assert.equal(material.candidates.length, 1); assert.equal(material.rejected.length, 0);
    assert.equal(material.candidates[0].amount, null); assert.equal(material.candidates[0].normalization.amount, null);
    assert.notEqual(material.candidates[0].normalization.status, 'exact');
    assert.equal(JSON.parse(material.raw).candidates[0].value, '5元');
    durableSnapshots.push({ name, item, state: stored(item.caseId) });
    return { croppedValue: '5元', sourceValue: value, amount: null, rawRetained: true, automaticCalculation: false };
  });
  for (const value of ['5分鐘', '5分米', '5角度']) await scenario(`round13_isolated_${value}_is_rejected_and_raw_history_remain`, async () => {
    const name = `isolated-unit-${value}`;
    const attributes = { meaning: 'other_money', completeness: 'not_applicable', period: null };
    const [item] = await fixture(name, [{ text: `测试王甲记录${value}。`, candidates: [money(value, value, attributes)] }]);
    const material = rawAndLocations(item, await extract(item));
    assert.equal(material.candidates.length, 0); assert.equal(material.rejected.length, 1);
    assert.equal(material.rejected[0].index, 0); assert.match(material.rejected[0].reason, /没有金额表达/u);
    assert.equal(material.coverage.acceptedCount, 0); assert.equal(material.coverage.rejectedCount, 1);
    assert.equal(JSON.parse(material.raw).candidates[0].value, value);
    const before = stored(item.caseId), read = await request(item.path);
    assert.equal(read.status, 200); unconfirmed(read.body);
    const reread = rawAndLocations(item, read.body);
    assert.deepEqual(reread.candidates, []); assert.deepEqual(reread.rejected, material.rejected);
    assert.deepEqual(read.body.state.history, before.state.history); assert.deepEqual(stored(item.caseId), before);
    durableSnapshots.push({ name, item, state: before });
    return { accepted: 0, rejected: 1, rawValue: value, rawAndStoredHistoryUnchanged: true };
  });
  await scenario('round13_equal_mixed_payment_amounts_at_two_events_are_both_retained', async () => {
    const first = '2026年2月1日单位向测试王甲支付2026年1月工资5元五角';
    const second = '2026年2月2日单位向测试王甲支付2026年1月工资5元五角';
    const attributes = { meaning: 'payment', completeness: 'partial' };
    const [item] = await fixture('two-mixed-payments', [{ text: `${first}。${second}。`, candidates: [money('5元五角', first, attributes), money('5元五角', second, attributes)] }]);
    const material = rawAndLocations(item, await extract(item));
    assert.equal(material.candidates.length, 2); assert.equal(material.rejected.length, 0);
    assert.deepEqual(material.candidates.map(candidate => candidate.amount), ['5.50', '5.50']);
    assert(material.candidates.every(candidate => candidate.normalization.status === 'exact'));
    const attributesOnly = entry => { const { quote, blockId, ...rest } = entry.representation; void quote; void blockId; return rest; };
    assert.deepEqual(attributesOnly(material.candidates[0]), attributesOnly(material.candidates[1]));
    assert.notEqual(material.candidates[0].id, material.candidates[1].id);
    assert.notEqual(material.candidates[0].start, material.candidates[1].start);
    assert.equal(JSON.parse(material.raw).candidates.length, 2);
    durableSnapshots.push({ name: 'two-mixed-payments', item, state: stored(item.caseId) });
    return { acceptedPayments: 2, distinctSourcePositions: true, rawRetained: true, automaticSummation: false };
  });
  await scenario('round13_historical_unsupported_mixed_money_is_not_upgraded_or_rewritten', async () => {
    const values = ['5元五角', '5元零五分'];
    const items = await fixture('historical-mixed-unsupported', values.map(value => ({ text: `测试王甲2026年1月完整应付工资${value}。`, candidates: [money(value, value)] })));
    for (const item of items) await extract(item);
    // Emulate an older unsupported derived result in this run's disposable D1.
    // Keep original model output, source, positions, revision and audit untouched.
    const legacy = stored(items[0].caseId);
    for (const [index, item] of items.entries()) {
      const material = legacy.state.materials.find(material => material.evidenceId === item.evidenceId);
      assert.equal(material.candidates.length, 1);
      const candidate = material.candidates[0]; candidate.amount = null;
      candidate.normalization = { rawValue: values[index], amount: null, status: 'unsupported', matchedText: null, span: null, reason: 'Synthetic pre-fix unsupported mixed-unit amount' };
    }
    db.prepare('UPDATE case_material_facts SET state_json=? WHERE case_id=? AND user_id=?').run(JSON.stringify(legacy.state), items[0].caseId, owner);
    const before = stored(items[0].caseId), read = await request(items[0].path);
    assert.equal(read.status, 200); unconfirmed(read.body);
    for (const [index, item] of items.entries()) {
      const material = rawAndLocations(item, read.body); assert.equal(material.candidates.length, 1);
      const candidate = material.candidates[0];
      assert.equal(candidate.amount, null); assert.equal(candidate.normalization.amount, null); assert.equal(candidate.normalization.status, 'unsupported');
      assert.equal(candidate.value, values[index]); assert.equal(JSON.parse(material.raw).candidates[0].value, values[index]);
    }
    assert.deepEqual(stored(items[0].caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({ name: 'historical-mixed-unsupported', item: items[0], state: before });
    return { historicalUnsupportedAmounts: 2, amount: null, rawAndStoredHistoryUnchanged: true, automaticUpgrade: false };
  });
  await scenario('round13_financial_word_fenhong_is_retained_as_unknown_money_for_review', async () => {
    const value = '三万分红';
    const attributes = { meaning: 'other_money', completeness: 'not_applicable', period: null };
    const [item] = await fixture('financial-word-fenhong', [{ text: `测试王甲记录${value}。`, candidates: [money(value, value, attributes)] }]);
    const material = rawAndLocations(item, await extract(item));
    assert.equal(material.candidates.length, 1); assert.equal(material.rejected.length, 0);
    assert.equal(material.candidates[0].amount, null); assert.equal(material.candidates[0].normalization.amount, null);
    assert.notEqual(material.candidates[0].normalization.status, 'exact');
    assert.equal(material.candidates[0].value, value); assert.equal(JSON.parse(material.raw).candidates[0].value, value);
    durableSnapshots.push({ name: 'financial-word-fenhong', item, state: stored(item.caseId) });
    return { acceptedUnknownForReview: 1, amount: null, rawRetained: true, automaticCalculation: false };
  });
  // End ROUND13 additions.
  // ROUND15 additions: retain all 74 prior scenarios and lifecycle assertions.
  // The candidates deliberately crop to an exact-looking operand; source context
  // must keep bounds, qualified ranges and explicit proportions non-exact.
  for (const spec of [
    { name: 'bound-buman', text: '测试王甲2026年1月完整应付工资不满四万元。', value: '四万元', amount: null },
    { name: 'bound-weiman', text: '测试王甲2026年1月完整应付工资未满四万元。', value: '四万元', amount: null },
    { name: 'bound-diyu', text: '测试王甲2026年1月完整应付工资低于四万元。', value: '四万元', amount: null },
    { name: 'bound-gaoyu', text: '测试王甲2026年1月完整应付工资高于四万元。', value: '四万元', amount: null },
    { name: 'bound-duoda', text: '测试王甲2026年1月完整应付工资多达四万元。', value: '四万元', amount: null },
    { name: 'range-left-yu', text: '测试王甲2026年1月工资三万余元至四万元。', value: '四万元', amount: null },
    { name: 'range-right-zuoyou', text: '测试王甲2026年1月工资三万元至四万元左右。', value: '三万元', amount: null },
    { name: 'range-left-yue', text: '测试王甲2026年1月工资约三万元至四万元。', value: '四万元', amount: null },
    { name: 'attached-three-cheng', text: '测试王甲2026年1月工资四万元的三成。', value: '四万元', amount: null },
    { name: 'attached-eight-zhe', text: '测试王甲2026年1月工资四万元打八折。', value: '四万元', amount: null },
    { name: 'independent-proportion-control', text: '测试王甲2026年1月完整应付工资四万元。测试王乙奖金按业绩三成计算。', value: '四万元', amount: '40000.00' },
    { name: 'until-calendar-date-control', text: '测试王甲2026年1月完整应付工资四万元至2026年5月支付。', value: '四万元', amount: '40000.00' },
  ]) await scenario(`round15_${spec.name}_source_guard_and_raw_history`, async () => {
    const [item] = await fixture(`round15-${spec.name}`, [{ text: spec.text, candidates: [money(spec.value, spec.value)] }]);
    const material = rawAndLocations(item, await extract(item));
    assert.equal(material.candidates.length, 1); assert.equal(material.rejected.length, 0);
    const candidate = material.candidates[0];
    assert.equal(candidate.amount, spec.amount); assert.equal(candidate.normalization.amount, spec.amount);
    if (spec.amount === null) assert.notEqual(candidate.normalization.status, 'exact');
    else assert.equal(candidate.normalization.status, 'exact');
    assert.equal(candidate.value, spec.value); assert.equal(candidate.quote, spec.value);
    assert.equal(JSON.parse(material.raw).candidates[0].value, spec.value);
    const before = stored(item.caseId), read = await request(item.path);
    assert.equal(read.status, 200); unconfirmed(read.body);
    const checked = rawAndLocations(item, read.body).candidates[0];
    assert.equal(checked.amount, spec.amount); assert.equal(checked.normalization.amount, spec.amount);
    assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({ name: `round15-${spec.name}`, item, state: before });
    return { amount: spec.amount, originalValue: spec.value, rawAndStoredHistoryUnchanged: true, automaticCalculation: false };
  });
  // End ROUND15 additions.
  // ROUND16 additions: retain the original 86 scenarios and lifecycle code.
  // The real TXT service creates one block per non-empty line. These fixtures
  // assert that layout explicitly, then preserve the original queue raw and D1.
  for (const spec of [
    { name: 'unfinished-bare-four-layout', continuation: '4。', amount: null },
    { name: 'unfinished-approx-four-adjacent-block', continuation: '约4。', amount: null },
    { name: 'explicit-four-months-control', continuation: '4个月内付清。', amount: '30000.00' },
    { name: 'new-subject-sentence-control', continuation: '测试王乙2026年1月工资4万元。', amount: '30000.00', sentenceEnd: true },
  ]) await scenario(`round16_${spec.name}_source_guard_raw_and_history`, async () => {
    const text = `测试王甲2026年1月完整应付工资3万元${spec.sentenceEnd ? '。' : '至'}\n${spec.continuation}`;
    const [item] = await fixture(`round16-${spec.name}`, [{ text, candidates: [money('3万元', '3万元')] }]);
    const blocks = item.analysis.result.blocks;
    assert.equal(blocks.length, 2, 'The actual TXT path must expose two adjacent source blocks.');
    assert(blocks[0].text.endsWith(`3万元${spec.sentenceEnd ? '。' : '至'}`));
    assert.equal(blocks[1].text, spec.continuation);
    const material = rawAndLocations(item, await extract(item));
    assert.equal(material.candidates.length, 1); assert.equal(material.rejected.length, 0);
    const candidate = material.candidates[0];
    assert.equal(candidate.amount, spec.amount); assert.equal(candidate.normalization.amount, spec.amount);
    assert.equal(candidate.normalization.status, spec.amount === null ? 'uncertain' : 'exact');
    assert.equal(candidate.value, '3万元'); assert.equal(candidate.quote, '3万元');
    assert.equal(JSON.parse(material.raw).candidates[0].value, '3万元');
    if (spec.amount === null) {
      // Emulate only an obsolete derived amount in this disposable D1 row.
      // The original model raw, representation, quote and audit are unchanged.
      const legacy = stored(item.caseId), old = legacy.state.materials[0].candidates[0];
      old.amount = '30000.00';
      old.normalization = { rawValue: '3万元', amount: '30000.00', status: 'exact', matchedText: '3万元', span: { start: 0, end: 3 }, reason: 'Synthetic pre-fix exact incomplete-range endpoint' };
      db.prepare('UPDATE case_material_facts SET state_json=? WHERE case_id=? AND user_id=?').run(JSON.stringify(legacy.state), item.caseId, owner);
    }
    const before = stored(item.caseId), read = await request(item.path);
    assert.equal(read.status, 200); unconfirmed(read.body);
    const checked = rawAndLocations(item, read.body).candidates[0];
    assert.equal(checked.amount, spec.amount); assert.equal(checked.normalization.amount, spec.amount);
    assert.equal(checked.normalization.status, spec.amount === null ? 'uncertain' : 'exact');
    assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({ name: `round16-${spec.name}`, item, state: before });
    return { amount: spec.amount, sourceBlocks: blocks.length, originalValue: '3万元', historicalExactDowngraded: spec.amount === null,
      rawAndStoredHistoryUnchanged: true, automaticCalculation: false };
  });
  // End ROUND16 additions.

  // ROUND17 additions: finite currency, lexical units, subject and occurrence boundaries.
  for (const spec of [
    { name: 'foreign-conversion-prefix', text: '测试王甲2026年1月工资以港币折合四万元。', value: '四万元', status: 'unsupported', amount: null, oldAmount: '40000.00' },
    { name: 'foreign-conversion-suffix', text: '测试王甲2026年1月工资四万元折合港币。', value: '四万元', status: 'unsupported', amount: null, oldAmount: '40000.00' },
    { name: 'tuple-cropped-unit', text: '测试王甲2026年1月记录三元组。', value: '三元', status: 'unsupported', amount: null, oldAmount: '3.00' },
    { name: 'tuple-rmb-prefix', text: '测试王甲2026年1月记录人民币三元组。', value: '人民币三元', status: 'unsupported', amount: null, oldAmount: '3.00' },
    { name: 'tuple-layout', text: '测试王甲2026年1月记录三元\n组。', value: '三元', status: 'unsupported', amount: null, oldAmount: '3.00', blocks: 2 },
    { name: 'name-numeral-total', text: '王一月工资四万元。', value: '四万元', status: 'rate_unit_mismatch', amount: null, oldAmount: '40000.00', attributes: { subject: '王一', period: null } },
    { name: 'name-numeral-month-rate', text: '王一月工资四万元。', value: '四万元', status: 'exact', amount: '40000.00', attributes: { subject: '王一', period: null, meaning: 'rate', completeness: 'not_applicable', rateUnit: 'month' } },
    { name: 'name-with-real-calendar', text: '王一一月工资四万元。', value: '四万元', status: 'exact', amount: '40000.00', attributes: { subject: '王一', period: '一月' } },
    { name: 'assembly-fee-unit-control', text: '测试王甲2026年1月工资5元组装费。', value: '5元', status: 'exact', amount: '5.00' },
  ]) await scenario(`round17_${spec.name}_read_boundary`, async () => {
    const [item] = await fixture(`round17-${spec.name}`, [{ text: spec.text, candidates: [money(spec.value, spec.value, spec.attributes)] }]);
    if (spec.blocks) assert.equal(item.analysis.result.blocks.length, spec.blocks);
    const material = rawAndLocations(item, await extract(item));
    assert.equal(material.candidates.length, 1); assert.equal(material.rejected.length, 0);
    assert.equal(material.candidates[0].amount, spec.amount); assert.equal(material.candidates[0].normalization.status, spec.status);
    if (spec.amount === null) {
      const legacy = stored(item.caseId), old = legacy.state.materials[0].candidates[0];
      old.amount = spec.oldAmount;
      old.normalization = { rawValue: spec.value, amount: spec.oldAmount, status: 'exact', matchedText: spec.value, span: { start: 0, end: Array.from(spec.value).length }, reason: 'Synthetic pre-fix round17 exact amount' };
      db.prepare('UPDATE case_material_facts SET state_json=? WHERE case_id=? AND user_id=?').run(JSON.stringify(legacy.state), item.caseId, owner);
    }
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    const checked = rawAndLocations(item, read.body).candidates[0];
    assert.equal(checked.amount, spec.amount); assert.equal(checked.normalization.status, spec.status);
    assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({ name: `round17-${spec.name}`, item, state: before });
    return { amount: spec.amount, rawAndStoredHistoryUnchanged: true, historicalExactDowngraded: spec.amount === null };
  });
  await scenario('round17_amount_free_arrears_reject_but_unknown_stays_reviewable', async () => {
    const words = ['拖欠工资', '欠付工资', '未付工资', '本期应付工资', '拖欠工资未知'];
    const candidates = words.map(value => money(value, value, { meaning: 'arrears', completeness: 'not_applicable', period: null }));
    const [item] = await fixture('round17-noamount', [{ text: words.map(word => '测试王甲' + word + '。').join(''), candidates }]);
    const material = rawAndLocations(item, await extract(item));
    assert.equal(material.candidates.length, 1); assert.equal(material.rejected.length, 4);
    assert.equal(material.candidates[0].value, '拖欠工资未知'); assert.equal(material.candidates[0].amount, null);
    assert(material.rejected.every(entry => /没有金额表达/u.test(entry.reason)));
    assert.equal(JSON.parse(material.raw).candidates.length, 5);
    durableSnapshots.push({ name: 'round17-noamount', item, state: stored(item.caseId) });
    return { acceptedUnknownForReview: 1, rejectedDescriptions: 4, rawRetained: true };
  });
  for (const reverse of [false, true]) await scenario(`round17_traditional_rmb_single_occurrence_${reverse ? 'short' : 'long'}_first`, async () => {
    const entries = [money('人民幣四万元', '人民幣四万元'), money('四万元', '四万元')];
    if (reverse) entries.reverse();
    const [item] = await fixture(`round17-traditional-${reverse}`, [{ text: '测试王甲2026年1月完整应付工资人民幣四万元。', candidates: entries }]);
    const material = rawAndLocations(item, await extract(item));
    assert.equal(material.candidates.length, 1); assert.equal(material.rejected.length, 1);
    assert.equal(JSON.parse(material.raw).candidates.length, 2); assert.equal(material.candidates[0].amount, '40000.00');
    durableSnapshots.push({ name: `round17-traditional-${reverse}`, item, state: stored(item.caseId) });
    return { acceptedOccurrence: 1, rawPredictions: 2, order: reverse ? 'short-first' : 'long-first' };
  });
  // End ROUND17 additions.
  // ROUND18 additions: traditional wages, mixed subunits and unsupported suffix rates.
  for (const spec of [
    { name: 'traditional-foreign-prefix', text: '测试王甲2026年1月港幣工資40000圓。', value: '40000圓', status: 'unsupported', amount: null, oldAmount: '40000.00' },
    { name: 'traditional-foreign-suffix', text: '测试王甲2026年1月工資40000圓薪資為港幣。', value: '40000圓', status: 'unsupported', amount: null, oldAmount: '40000.00' },
    ...['月工資', '日薪標準', '小時工資'].map(label => ({ name: `traditional-rate-${label}`, text: `测试王甲${label}40000圓。`, value: '40000圓', status: 'rate_unit_mismatch', amount: null, oldAmount: '40000.00', attributes: { period: null } })),
    { name: 'traditional-correct-monthly-rate', text: '测试王甲每月工資40000圓。', value: '40000圓', status: 'exact', amount: '40000.00', attributes: { period: null, meaning: 'rate', completeness: 'not_applicable', rateUnit: 'month' } },
    { name: 'traditional-real-period', text: '测试王甲2026年1月工資40000圓。', value: '40000圓', status: 'exact', amount: '40000.00' },
    ...[['五元5角', '5.50'], ['五元5角2分', '5.52'], ['五元五角2分', '5.52']].map(([value, amount]) => ({ name: `mixed-subunits-${value}`, text: `测试王甲2026年1月完整应付工资${value}。`, value, status: 'exact', amount })),
    ...['年', '周', '季度', '次', 'hr'].map(unit => ({ name: `unsupported-rate-${unit}`, text: `测试王甲2026年1月工资40000元/${unit}。`, value: '40000元', status: 'unsupported', amount: null, oldAmount: '40000.00' })),
    { name: 'supported-suffix-monthly-rate', text: '测试王甲工资40000元/月。', value: '40000元', status: 'exact', amount: '40000.00', attributes: { period: null, meaning: 'rate', completeness: 'not_applicable', rateUnit: 'month' } },
  ]) await scenario(`round18_${spec.name}_read_boundary`, async () => {
    const [item] = await fixture(`round18-${spec.name}`, [{ text: spec.text, candidates: [money(spec.value, spec.value, spec.attributes)] }]);
    if (spec.blocks) assert.equal(item.analysis.result.blocks.length, spec.blocks);
    const material = rawAndLocations(item, await extract(item));
    assert.equal(material.candidates.length, 1); assert.equal(material.rejected.length, 0);
    assert.equal(material.candidates[0].amount, spec.amount); assert.equal(material.candidates[0].normalization.status, spec.status);
    if (spec.amount === null) {
      const legacy = stored(item.caseId), old = legacy.state.materials[0].candidates[0];
      old.amount = spec.oldAmount;
      old.normalization = { rawValue: spec.value, amount: spec.oldAmount, status: 'exact', matchedText: spec.value, span: { start: 0, end: Array.from(spec.value).length }, reason: 'Synthetic pre-fix round18 exact amount' };
      db.prepare('UPDATE case_material_facts SET state_json=? WHERE case_id=? AND user_id=?').run(JSON.stringify(legacy.state), item.caseId, owner);
    }
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    const checked = rawAndLocations(item, read.body).candidates[0];
    assert.equal(checked.amount, spec.amount); assert.equal(checked.normalization.status, spec.status);
    assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({ name: `round18-${spec.name}`, item, state: before });
    return { amount: spec.amount, rawAndStoredHistoryUnchanged: true, historicalExactDowngraded: spec.amount === null };
  });
  // End ROUND18 additions.
  // ROUND19: rate roles, time separators and no-money ratios share the real HTTP boundary.
  for (const spec of [
    ...['按月', '按日计', '按小时', '按件'].map(label => ({ name: `postposed-${label}`, text: `测试王甲工资${label}40000元。`, value: '40000元', amount: null, status: 'rate_unit_mismatch', attributes: { period: null }, oldAmount: '40000.00' })),
    ...['-', '－'].map(separator => ({ name: `date-${separator}`, text: `测试王甲欠薪4000元${separator}2024年5月仍未支付。`, value: '4000元', amount: '4000.00', status: 'exact', attributes: { meaning: 'arrears', completeness: 'not_applicable', period: null } })),
    ...['-200元', '-2000'].map(tail => ({ name: `arithmetic-${tail}`, text: `测试王甲工资4000元${tail}。`, value: '4000元', amount: null, status: tail.endsWith('元') ? 'range' : 'uncertain', oldAmount: '4000.00', attributes: { period: null } })),
    { name: 'money-percentage-formula', text: '测试王甲工资四万元的50%。', value: '四万元', amount: null, status: 'unsupported', oldAmount: '40000.00', attributes: { period: null } },
    { name: 'correct-postposed-rate', text: '测试王甲工資按小時計40000元。', value: '40000元', amount: '40000.00', status: 'exact', attributes: { meaning: 'rate', completeness: 'not_applicable', period: null, rateUnit: 'hour' } },
  ]) await scenario(`round19_${spec.name}`, async () => {
    const [item] = await fixture(`round19-${spec.name}`, [{ text: spec.text, candidates: [money(spec.value, spec.value, spec.attributes)] }]);
    const material = rawAndLocations(item, await extract(item));
    assert.equal(material.candidates.length, 1); assert.equal(material.rejected.length, 0);
    assert.equal(material.candidates[0].amount, spec.amount); assert.equal(material.candidates[0].normalization.status, spec.status);
    if (spec.amount === null) {
      const legacy = stored(item.caseId), old = legacy.state.materials[0].candidates[0];
      old.amount = spec.oldAmount;
      old.normalization = { rawValue: spec.value, amount: spec.oldAmount, status: 'exact', matchedText: spec.value, span: { start: 0, end: Array.from(spec.value).length }, reason: 'Synthetic pre-fix round19 exact amount' };
      db.prepare('UPDATE case_material_facts SET state_json=? WHERE case_id=? AND user_id=?').run(JSON.stringify(legacy.state), item.caseId, owner);
    }
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    const checked = rawAndLocations(item, read.body).candidates[0];
    assert.equal(checked.amount, spec.amount); assert.equal(checked.normalization.status, spec.status);
    assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({ name: `round19-${spec.name}`, item, state: before });
    return { amount: spec.amount, rawAndStoredHistoryUnchanged: true, historicalExactDowngraded: spec.amount === null };
  });
  for (const value of ['50%', '百分之五十', '出勤率50%']) await scenario(`round19_pure_ratio_${value}`, async () => {
    const [item] = await fixture(`round19-ratio-${value}`, [{ text: `测试王甲材料记载${value}。`, candidates: [money(value, value, { period: null })] }]);
    const material = rawAndLocations(item, await extract(item));
    assert.equal(material.candidates.length, 0); assert.equal(material.rejected.length, 1);
    assert.match(JSON.stringify(material.rejected), /not_monetary|货币|金额/u);
    assert.equal(JSON.parse(material.raw).candidates[0].value, value);
    const before = stored(item.caseId), read = await request(item.path); unconfirmed(read.body);
    assert.deepEqual(rawAndLocations(item, read.body).rejected, material.rejected);
    assert.deepEqual(stored(item.caseId), before);
    durableSnapshots.push({ name: `round19-ratio-${value}`, item, state: before });
    return { accepted: 0, rejected: 1, rawAndStoredHistoryUnchanged: true };
  });
  // End ROUND19 additions.
  // ROUND20: keep prior scenarios intact; inspect original qualifiers and subject spans.
  for (const spec of [
    ...['不到', '不止', '开外'].map(suffix => ({ name: `postposed-bound-${suffix}`, text: `测试王甲工资四万元${suffix}。`, value: '四万元', amount: null, status: 'approximate', oldAmount: '40000.00' })),
    ...['提成比例', '社保缴费比例', '奖金系数'].map(operand => ({ name: `named-operand-${operand}`, text: `测试王甲工资四万元乘以${operand}。`, value: '四万元', amount: null, status: 'unsupported', oldAmount: '40000.00' })),
    { name: 'traditional-wan', text: '测试王甲工资人民幣四萬圓。', value: '人民幣四萬圓', amount: '40000.00', status: 'exact' },
    { name: 'traditional-wan-cents', text: '测试王甲工资四萬圓五角。', value: '四萬圓五角', amount: '40000.50', status: 'exact' },
    { name: 'traditional-wan-bound', text: '测试王甲工资四萬圓不到。', value: '四萬圓', amount: null, status: 'approximate', oldAmount: '40000.00' },
    ...[['二元论', '二元', '2.00'], ['三元催化器', '三元', '3.00']].map(([word, value, oldAmount]) => ({ name: `ordinary-compound-${word}`, text: `测试王甲材料记载${word}。`, value, amount: null, status: 'unsupported', oldAmount })),
    ...['王美元', '李港元'].flatMap(subject => [false, true].map(full => ({ name: `subject-currency-${subject}-${full}`, text: `${subject}工资四万元。`, value: '四万元', quote: full ? `${subject}工资四万元。` : '四万元', amount: '40000.00', status: 'exact', attributes: { subject } }))),
    ...['王美元', '李港元'].map(subject => ({ name: `subject-with-real-foreign-${subject}`, text: `${subject}工资以港币支付四万元。`, value: '四万元', amount: null, status: 'unsupported', oldAmount: '40000.00', attributes: { subject } })),
  ]) await scenario(`round20_${spec.name}`, async () => {
    const [item] = await fixture(`round20-${spec.name}`, [{ text: spec.text, candidates: [money(spec.value, spec.quote || spec.value, { period: null, ...spec.attributes })] }]);
    const material = rawAndLocations(item, await extract(item));
    assert.equal(material.candidates.length, 1); assert.equal(material.rejected.length, 0);
    assert.equal(material.candidates[0].amount, spec.amount); assert.equal(material.candidates[0].normalization.status, spec.status);
    if (spec.amount === null) {
      const legacy = stored(item.caseId), old = legacy.state.materials[0].candidates[0];
      old.amount = spec.oldAmount;
      old.normalization = { rawValue: spec.value, amount: spec.oldAmount, status: 'exact', matchedText: spec.value, span: { start: 0, end: Array.from(spec.value).length }, reason: 'Synthetic pre-fix round20 exact amount' };
      db.prepare('UPDATE case_material_facts SET state_json=? WHERE case_id=? AND user_id=?').run(JSON.stringify(legacy.state), item.caseId, owner);
    }
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    const checked = rawAndLocations(item, read.body).candidates[0];
    assert.equal(checked.amount, spec.amount); assert.equal(checked.normalization.status, spec.status);
    assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({ name: `round20-${spec.name}`, item, state: before });
    return { amount: spec.amount, rawAndStoredHistoryUnchanged: true, historicalExactDowngraded: spec.amount === null };
  });
  // End ROUND20 additions.
  // ROUND21: keep prior scenarios intact; inspect original qualifiers and subject spans.
  for (const spec of [
    ...['起诉至法院', '多次催讨'].map(prose => ({ name: `bound-prose-${prose}`, text: `测试王甲欠薪四万元${prose}。`, value: '四万元', amount: '40000.00', status: 'exact' })),
    ...['每周', '每季度'].map(rate => ({ name: `unsupported-preposed-rate-${rate}`, text: `测试王甲${rate}工资四万元。`, value: '四万元', amount: null, status: 'unsupported', oldAmount: '40000.00' })),
    ...['年终奖', '年假补偿'].map(noun => ({ name: `yuan-payment-noun-${noun}`, text: `测试王甲收到4000元${noun}。`, value: '4000元', amount: '4000.00', status: 'exact' })),
  ]) await scenario(`round21_${spec.name}`, async () => {
    const [item] = await fixture(`round21-${spec.name}`, [{ text: spec.text, candidates: [money(spec.value, spec.quote || spec.value, { period: null, ...spec.attributes })] }]);
    const material = rawAndLocations(item, await extract(item));
    assert.equal(material.candidates.length, 1); assert.equal(material.rejected.length, 0);
    assert.equal(material.candidates[0].amount, spec.amount); assert.equal(material.candidates[0].normalization.status, spec.status);
    if (spec.amount === null) {
      const legacy = stored(item.caseId), old = legacy.state.materials[0].candidates[0];
      old.amount = spec.oldAmount;
      old.normalization = { rawValue: spec.value, amount: spec.oldAmount, status: 'exact', matchedText: spec.value, span: { start: 0, end: Array.from(spec.value).length }, reason: 'Synthetic pre-fix round21 exact amount' };
      db.prepare('UPDATE case_material_facts SET state_json=? WHERE case_id=? AND user_id=?').run(JSON.stringify(legacy.state), item.caseId, owner);
    }
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    const checked = rawAndLocations(item, read.body).candidates[0];
    assert.equal(checked.amount, spec.amount); assert.equal(checked.normalization.status, spec.status);
    assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({ name: `round21-${spec.name}`, item, state: before });
    return { amount: spec.amount, rawAndStoredHistoryUnchanged: true, historicalExactDowngraded: spec.amount === null };
  });
  // End ROUND21 additions.
  // ROUND22: traditional numeral aliases and explicit weekday wage periods.
  for (const spec of [
    ...[['人民幣兩萬圓', '20000.00'], ['人民幣四億圓', '400000000.00'], ['4億圓', '400000000.00']].map(([value, amount]) => ({ name: `traditional-alias-${value}`, text: `测试王甲工资${value}。`, value, amount })),
    ...['周日', '星期日', '礼拜日'].map(day => ({ name: `weekday-${day}`, text: `测试王甲${day}工资400元。`, value: '400元', amount: '400.00' })),
  ]) await scenario(`round22_${spec.name}`, async () => {
    const [item] = await fixture(`round22-${spec.name}`, [{ text: spec.text, candidates: [money(spec.value, spec.value, { period: null })] }]);
    const material = rawAndLocations(item, await extract(item));
    assert.equal(material.candidates.length, 1); assert.equal(material.rejected.length, 0);
    assert.equal(material.candidates[0].amount, spec.amount); assert.equal(material.candidates[0].normalization.status, 'exact');
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert.equal(rawAndLocations(item, read.body).candidates[0].amount, spec.amount);
    assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({ name: `round22-${spec.name}`, item, state: before });
    return { amount: spec.amount, rawAndStoredHistoryUnchanged: true };
  });
  // End ROUND22 additions.
  // ROUND23: retain cropped bounds, reject amount-free labels, parse explicit RMB.
  for (const spec of [
    ...['最多四万元', '最少四万元', '四万元内', '四万元之内'].map(expression => ({ name: `compact-bound-${expression}`, text: `测试王甲工资${expression}。`, value: '四万元', amount: null, status: 'approximate', oldAmount: '40000.00' })),
    ...['八折', '拖欠工資'].map(value => ({ name: `amount-free-${value}`, text: `测试王甲材料记载${value}。`, value, rejected: true })),
    ...[['40000人民幣', '40000.00'], ['40000RMB', '40000.00'], ['人民幣5角', '0.50'], ['人民币5角2分', '0.52']].map(([value, amount]) => ({ name: `explicit-rmb-${value}`, text: `测试王甲收到${value}。`, value, amount, status: 'exact' })),
  ]) await scenario(`round23_${spec.name}`, async () => {
    const [item] = await fixture(`round23-${spec.name}`, [{ text: spec.text, candidates: [money(spec.value, spec.value, { period: null })] }]);
    const material = rawAndLocations(item, await extract(item));
    assert.equal(material.candidates.length, spec.rejected ? 0 : 1); assert.equal(material.rejected.length, spec.rejected ? 1 : 0);
    if (!spec.rejected) {
      assert.equal(material.candidates[0].amount, spec.amount); assert.equal(material.candidates[0].normalization.status, spec.status);
      if (spec.amount === null) {
        const legacy = stored(item.caseId), old = legacy.state.materials[0].candidates[0];
        old.amount = spec.oldAmount;
        old.normalization = { rawValue: spec.value, amount: spec.oldAmount, status: 'exact', matchedText: spec.value, span: { start: 0, end: Array.from(spec.value).length }, reason: 'Synthetic pre-fix round23 exact amount' };
        db.prepare('UPDATE case_material_facts SET state_json=? WHERE case_id=? AND user_id=?').run(JSON.stringify(legacy.state), item.caseId, owner);
      }
    }
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    const checked = rawAndLocations(item, read.body);
    assert.equal(checked.candidates.length, spec.rejected ? 0 : 1);
    if (!spec.rejected) { assert.equal(checked.candidates[0].amount, spec.amount); assert.equal(checked.candidates[0].normalization.status, spec.status); }
    assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({ name: `round23-${spec.name}`, item, state: before });
    return { amount: spec.amount ?? null, rejected: !!spec.rejected, rawAndStoredHistoryUnchanged: true, historicalExactDowngraded: !spec.rejected && spec.amount === null };
  });
  // End ROUND23 additions.
  // ROUND24: uncertainty after cropped values and finite supported source forms.
  for (const spec of [
    ...['？', '待核实', '待定', '未知'].map(marker => ({ name: `postposed-${marker}`, text: `。测试王甲2026年1月全部应付工资合计4000元${marker}`, value: '4000元', amount: null, status: 'uncertain', oldAmount: '4000.00' })),
    ...[['應付', 'due_total'], ['已付', 'paid_total']].map(([role, meaning]) => ({ name: `traditional-role-${role}`, text: `。测试王甲2026年1月全部${role}工資合計四萬圓。`, value: '四萬圓', amount: '40000.00', status: 'exact', attributed: true, attributes: { meaning } })),
    ...['美元折合人民币', '美元折算为人民币'].map(conversion => ({ name: `explicit-conversion-${conversion}`, text: `。测试王甲工资${conversion}4000元。`, value: '4000元', amount: '4000.00', status: 'exact', attributes: { period: null } })),
    ...['每月15日', '每月三十一日'].map(value => ({ name: `recurring-payment-${value}`, text: `。测试王甲工资收到日${value}。`, value, date: true, attributed: true })),
  ]) await scenario(`round24_${spec.name}`, async () => {
    const candidate = spec.date ? { kind: 'date', value: spec.value, quote: spec.value, subject: '测试王甲', scope: 'individual', meaning: 'payment_date', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated' } : money(spec.value, spec.value, spec.attributes);
    const [item] = await fixture(`round24-${spec.name}`, [{ text: spec.text, exactSource: !!spec.attributed, candidates: [candidate] }]);
    const material = rawAndLocations(item, await extract(item));
    assert.equal(material.candidates.length, 1); assert.equal(material.rejected.length, 0);
    const fact = material.candidates[0];
    if (!spec.date) { assert.equal(fact.amount, spec.amount); assert.equal(fact.normalization.status, spec.status); }
    if (spec.attributed) assert(!fact.reviewIssues.some(issue => issue.code === 'source_relation_unresolved'), JSON.stringify({fact, blocks: item.analysis.result.blocks}));
    if (spec.oldAmount) {
      const legacy = stored(item.caseId), old = legacy.state.materials[0].candidates[0];
      old.amount = spec.oldAmount;
      old.normalization = { rawValue: spec.value, amount: spec.oldAmount, status: 'exact', matchedText: spec.value, span: { start: 0, end: Array.from(spec.value).length }, reason: 'Synthetic pre-fix round24 exact amount' };
      db.prepare('UPDATE case_material_facts SET state_json=? WHERE case_id=? AND user_id=?').run(JSON.stringify(legacy.state), item.caseId, owner);
    }
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    const checked = rawAndLocations(item, read.body).candidates[0];
    if (!spec.date) { assert.equal(checked.amount, spec.amount); assert.equal(checked.normalization.status, spec.status); }
    if (spec.attributed) assert(!checked.reviewIssues.some(issue => issue.code === 'source_relation_unresolved'));
    assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({ name: `round24-${spec.name}`, item, state: before });
    return { amount: checked.amount, date: !!spec.date, attributed: !!spec.attributed, rawAndStoredHistoryUnchanged: true, historicalExactDowngraded: !!spec.oldAmount };
  });
  // End ROUND24 additions.
  await scenario('round24_named_rate_operand_stays_unavailable', async () => {
    const [item] = await fixture('round24-named-rate', [{ text: '测试王甲工资四万元乘以出勤率。', candidates: [money('四万元', '四万元', { period: null })] }]);
    const material = rawAndLocations(item, await extract(item));assert.equal(material.candidates.length, 1);assert.equal(material.candidates[0].amount, null);assert.equal(material.candidates[0].normalization.status, 'unsupported');
    const legacy = stored(item.caseId), old = legacy.state.materials[0].candidates[0];
    old.amount = '40000.00'; old.normalization = { rawValue: '四万元', amount: '40000.00', status: 'exact', matchedText: '四万元', span: {start: 0, end: 3}, reason: 'Synthetic old formula operand' };
    db.prepare('UPDATE case_material_facts SET state_json=? WHERE case_id=? AND user_id=?').run(JSON.stringify(legacy.state), item.caseId, owner);
    const before = stored(item.caseId), read = await request(item.path);assert.equal(read.status, 200);unconfirmed(read.body);assert.equal(rawAndLocations(item, read.body).candidates[0].amount, null);assert.deepEqual(stored(item.caseId), before);assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({name: 'round24-named-rate', item, state: before});return {amount: null, rawAndStoredHistoryUnchanged: true, historicalExactDowngraded: true};
  });
  await scenario('round24_same_occurrence_traditional_wrapper_is_one_candidate', async () => {
    const quote = '测试王甲收到四萬圓工資';
    const [item] = await fixture('round24-traditional-duplicate', [{ text: quote + '。', candidates: ['四萬圓', '四萬圓工資'].map(value => money(value, quote, {meaning: 'payment', completeness: 'unknown', period: null})) }]);
    const material = rawAndLocations(item, await extract(item));assert.equal(material.candidates.length, 1);assert.equal(JSON.parse(material.raw).candidates.length, 2);assert.equal(material.candidates[0].amount, '40000.00');
    const before = stored(item.caseId), read = await request(item.path);assert.equal(read.status, 200);unconfirmed(read.body);assert.equal(rawAndLocations(item, read.body).candidates.length, 1);assert.deepEqual(stored(item.caseId), before);assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({name: 'round24-traditional-duplicate', item, state: before});return {accepted: 1, rawCandidates: 2, rawAndStoredHistoryUnchanged: true};
  });
  // ROUND25: finite whole-amount terminators and postposed RMB wrappers.
  for (const suffix of ['整', '正']) await scenario(`round25_cropped_whole_terminator_${suffix}`, async () => {
    const quote = `测试王甲2026年1月全部应付工资合计4000元${suffix}`;
    const [item] = await fixture(`round25-whole-${suffix}`, [{ text: quote + '。', candidates: [money('4000元', '4000元')] }]);
    const material = rawAndLocations(item, await extract(item));
    assert.equal(material.candidates.length, 1); assert.equal(material.candidates[0].amount, '4000.00'); assert.equal(material.candidates[0].normalization.status, 'exact');
    const legacy = stored(item.caseId), old = legacy.state.materials[0].candidates[0];
    old.amount = null; old.normalization = { rawValue: old.value, amount: null, status: 'unsupported', matchedText: null, span: null, reason: 'Synthetic historical unsupported whole terminator' };
    db.prepare('UPDATE case_material_facts SET state_json=? WHERE case_id=? AND user_id=?').run(JSON.stringify(legacy.state), item.caseId, owner);
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    const checked = rawAndLocations(item, read.body).candidates[0]; assert.equal(checked.amount, null); assert.equal(checked.normalization.status, 'unsupported');
    assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({ name: `round25-whole-${suffix}`, item, state: before });
    return { freshAmount: '4000.00', historicalUnsupportedNotUpgraded: true, rawAndStoredHistoryUnchanged: true };
  });
  for (const reverse of [false, true]) await scenario(`round25_postposed_rmb_wrapper_${reverse}`, async () => {
    const quote = '测试王甲收到4000元人民币'; const values = ['4000元', '4000元人民币']; if (reverse) values.reverse();
    const [item] = await fixture(`round25-rmb-${reverse}`, [{ text: quote + '。', candidates: values.map(value => money(value, quote, { meaning: 'payment', completeness: 'unknown', period: null })) }]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1); assert.equal(JSON.parse(material.raw).candidates.length, 2); assert.equal(material.candidates[0].amount, '4000.00');
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert.equal(rawAndLocations(item, read.body).candidates.length, 1); assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({ name: `round25-rmb-${reverse}`, item, state: before });
    return { accepted: 1, rawCandidates: 2, rawAndStoredHistoryUnchanged: true };
  });
  for (const [name, text, blockCount] of [
    ['question-after-whole', '测试王甲工资4000元整？', 1],
    ['subunit-after-whole-next-block', '测试王甲工资4000元整\n5角。', 2],
    ['rmb-subunit-after-whole-next-block', '测试王甲工资4000元\n整人民币5角。', 2],
  ]) await scenario(`round25_${name}_remains_unavailable`, async () => {
    const [item] = await fixture(`round25-${name}`, [{ text, candidates: [money('4000元', '4000元', { period: null })] }]);
    assert.equal(item.analysis.result.blocks.length, blockCount);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1); assert.equal(material.candidates[0].amount, null);
    const legacy = stored(item.caseId), old = legacy.state.materials[0].candidates[0]; old.amount = '4000.00';
    old.normalization = { rawValue: old.value, amount: '4000.00', status: 'exact', matchedText: '4000元', span: { start: 0, end: 5 }, reason: 'Synthetic unsafe whole-amount continuation' };
    db.prepare('UPDATE case_material_facts SET state_json=? WHERE case_id=? AND user_id=?').run(JSON.stringify(legacy.state), item.caseId, owner);
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert.equal(rawAndLocations(item, read.body).candidates[0].amount, null); assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({ name: `round25-${name}`, item, state: before });
    return { amount: null, historicalExactDowngraded: true, rawAndStoredHistoryUnchanged: true };
  });
  await scenario('round25_full_whole_amount_ascii_period', async () => {
    const text = '测试王甲2026年1月全部应付工资合计4000元整.';
    const [item] = await fixture('round25-ascii-period', [{ text, candidates: [money('4000元整', '4000元整')] }]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1); assert.equal(material.candidates[0].amount, '4000.00');
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert.equal(rawAndLocations(item, read.body).candidates[0].amount, '4000.00'); assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({ name: 'round25-ascii-period', item, state: before });
    return { amount: '4000.00', rawAndStoredHistoryUnchanged: true };
  });
  // End ROUND25 additions.
  // ROUND26: finite symbolic bounds, amount-label uncertainty, postposed rates and amount-free labels.
  const round26Unavailable = [
    ...['≤', '≥', '<', '>', '≦', '≧'].map((symbol, index) => ({ name: `symbol-bound-${index}`, text: `测试王甲2026年1月工资${symbol}4000元。`, value: index % 2 ? '4000元' : `${symbol}4000元` })),
    { name: 'amount-label-uncertainty', text: '测试王甲2026年1月工资4000元（金额待核实）。', value: '4000元' },
    { name: 'amount-label-layout-uncertainty', text: '测试王甲2026年1月工资4000元\n数额未知。', value: '4000元' },
    { name: 'postposed-month-total', text: '测试王甲工资4000元按月计。', value: '4000元', attributes: { period: null } },
    { name: 'postposed-piece-total', text: '测试王甲工资4000元按件计酬。', value: '4000元', attributes: { period: null } },
  ];
  for (const spec of round26Unavailable) await scenario(`round26_${spec.name}_fresh_and_history`, async () => {
    const [item] = await fixture(`round26-${spec.name}`, [{ text: spec.text, candidates: [money(spec.value, spec.value, spec.attributes)] }]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1); assert.equal(material.candidates[0].amount, null); assert.notEqual(material.candidates[0].normalization.status, 'exact');
    const legacy = stored(item.caseId), old = legacy.state.materials[0].candidates[0]; old.amount = '4000.00';
    old.normalization = { rawValue: old.value, amount: '4000.00', status: 'exact', matchedText: old.value, span: { start: 0, end: Array.from(old.value).length }, reason: 'Synthetic pre-fix bound/uncertainty/rate exact' };
    db.prepare('UPDATE case_material_facts SET state_json=? WHERE case_id=? AND user_id=?').run(JSON.stringify(legacy.state), item.caseId, owner);
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert.equal(rawAndLocations(item, read.body).candidates[0].amount, null); assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({ name: `round26-${spec.name}`, item, state: before });
    return { amount: null, historicalExactDowngraded: true, rawAndStoredHistoryUnchanged: true };
  });
  for (const [unit, rateUnit] of [['月', 'month'], ['小时', 'hour']]) await scenario(`round26_postposed_supported_${rateUnit}_rate`, async () => {
    const text = `测试王甲工资4000元按${unit}计`;
    const [item] = await fixture(`round26-rate-${rateUnit}`, [{ text: text + '。', exactSource: true, candidates: [money('4000元', text, { meaning: 'rate', rateUnit, completeness: 'not_applicable', period: null })] }]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1);
    assert.equal(material.candidates[0].amount, '4000.00'); assert.equal(material.candidates[0].representation.rateUnit, rateUnit);
    assert(!material.candidates[0].reviewIssues.some(issue => issue.code === 'source_relation_unresolved'));
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert.equal(rawAndLocations(item, read.body).candidates[0].amount, '4000.00'); assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({ name: `round26-rate-${rateUnit}`, item, state: before });
    return { amount: '4000.00', rateUnit, sourceRelationSupported: true, rawAndStoredHistoryUnchanged: true };
  });
  for (const [name, values] of [
    ['traditional-empty-labels', ['實付工資', '工資合計', '薪酬總額']],
    ['denomination-only', ['人民币', '人民幣', 'RMB', 'CNY', '元', '圆', '￥']],
  ]) await scenario(`round26_${name}_rejected_with_raw_retained`, async () => {
    const [item] = await fixture(`round26-${name}`, [{ text: values.join('；') + '。', candidates: values.map(value => money(value, value, { meaning: 'other_money', completeness: 'not_applicable', period: null, subject: null })) }]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 0); assert.equal(material.rejected.length, values.length); assert.equal(JSON.parse(material.raw).candidates.length, values.length); assert(material.rejected.every(entry => /没有金额表达/u.test(entry.reason)));
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert.equal(rawAndLocations(item, read.body).candidates.length, 0); assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({ name: `round26-${name}`, item, state: before });
    return { accepted: 0, rejected: values.length, rawCandidates: values.length, rawAndStoredHistoryUnchanged: true };
  });
  // End ROUND26 additions.
  // ROUND27: unsupported rate denominators and named arithmetic must not expose operands;
  // finite financial glyphs/date cues and unrelated qualifiers keep exact supported values.
  for (const [name, text] of [
    ['unsupported-week', '测试王甲工资4000元按周计。'],
    ['unsupported-quarter', '测试王甲工资4000元按季度计。'],
    ['unsupported-year', '测试王甲工资4000元按年计。'],
    ['named-bonus', '测试王甲工资4000元+奖金。'],
    ['named-overtime', '测试王甲工资4000元加上加班费。'],
    ['named-commission', '测试王甲工资4000元乘以提成。'],
    ['prefix-bonus', '测试王甲工资奖金+4000元。'],
    ['prefix-commission', '测试王甲工资提成乘以4000元。'],
    ['prefix-overtime', '测试王甲工资加班费加上4000元。'],
  ]) await scenario(`round27_${name}_fresh_and_history`, async () => {
    const [item] = await fixture(`round27-${name}`, [{ text, exactSource: true, candidates: [money('4000元', '4000元', { period: null })] }]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1); assert.equal(material.candidates[0].amount, null); assert.notEqual(material.candidates[0].normalization.status, 'exact');
    const legacy = stored(item.caseId), old = legacy.state.materials[0].candidates[0]; old.amount = '4000.00';
    old.normalization = { rawValue: old.value, amount: '4000.00', status: 'exact', matchedText: old.value, span: { start: 0, end: Array.from(old.value).length }, reason: 'Synthetic pre-fix unsupported rate or named arithmetic operand' };
    db.prepare('UPDATE case_material_facts SET state_json=? WHERE case_id=? AND user_id=?').run(JSON.stringify(legacy.state), item.caseId, owner);
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert.equal(rawAndLocations(item, read.body).candidates[0].amount, null); assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({ name: `round27-${name}`, item, state: before });
    return { amount: null, historicalExactDowngraded: true, rawAndStoredHistoryUnchanged: true };
  });
  for (const [glyph, amount] of [['貳', '20000.00'], ['參', '30000.00'], ['陸', '60000.00']]) await scenario(`round27_financial_${glyph}_fresh_and_history`, async () => {
    const value = `人民幣${glyph}萬圓`, text = `测试王甲2026年1月完整应付工资${value}。`;
    const [item] = await fixture(`round27-financial-${glyph}`, [{ text, exactSource: true, candidates: [money(value, value)] }]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1); assert.equal(material.candidates[0].amount, amount); assert.equal(material.candidates[0].normalization.status, 'exact');
    const legacy = stored(item.caseId), old = legacy.state.materials[0].candidates[0]; old.amount = null;
    old.normalization = { rawValue: old.value, amount: null, status: 'unsupported', matchedText: null, span: null, reason: 'Synthetic historical unsupported traditional financial literal' };
    db.prepare('UPDATE case_material_facts SET state_json=? WHERE case_id=? AND user_id=?').run(JSON.stringify(legacy.state), item.caseId, owner);
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert.equal(rawAndLocations(item, read.body).candidates[0].amount, null); assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({ name: `round27-financial-${glyph}`, item, state: before });
    return { freshAmount: amount, historicalUnsupportedNotUpgraded: true, rawAndStoredHistoryUnchanged: true };
  });
  for (const [name, text, meaning] of [
    ['employment', '测试王甲於2026年1月入職。', 'employment_period'],
    ['wage-period', '测试王甲工資歸屬期間2026年1月。', 'wage_period'],
    ['contract', '测试王甲於2026年1月簽訂勞動合同。', 'contract_signing'],
  ]) await scenario(`round27_traditional_date_${name}`, async () => {
    const value = '2026年1月', candidate = { kind: 'date', value, quote: value, subject: '测试王甲', scope: 'individual', meaning, completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated' };
    const [item] = await fixture(`round27-date-${name}`, [{ text, exactSource: true, candidates: [candidate] }]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1); assert(!material.candidates[0].reviewIssues.some(issue => issue.code === 'source_relation_unresolved'));
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert(!rawAndLocations(item, read.body).candidates[0].reviewIssues.some(issue => issue.code === 'source_relation_unresolved')); assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({ name: `round27-date-${name}`, item, state: before });
    return { date: value, meaning, sourceRelationSupported: true, rawAndStoredHistoryUnchanged: true };
  });
  for (const [name, value] of [
    ['duration-before', '工作至少3个月，工资4000元'],
    ['duration-after', '工资4000元，工龄至少3个月'],
    ['unrelated-noun', '最高人民法院判工资4000元'],
  ]) await scenario(`round27_qualifier_${name}`, async () => {
    const text = `测试王甲记录：${value}。`;
    const [item] = await fixture(`round27-qualifier-${name}`, [{ text, exactSource: true, candidates: [money(value, value, { period: null })] }]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1); assert.equal(material.candidates[0].amount, '4000.00'); assert.equal(material.candidates[0].normalization.status, 'exact');
    assert(material.candidates[0].reviewIssues.some(issue => issue.code === 'source_relation_unresolved'), 'A numerically exact arbitrary narrative is still not a supported total relationship.');
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert.equal(rawAndLocations(item, read.body).candidates[0].amount, '4000.00'); assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({ name: `round27-qualifier-${name}`, item, state: before });
    return { amount: '4000.00', unrelatedQualifierNotBorrowed: true, relationshipStillUnresolved: true, rawAndStoredHistoryUnchanged: true };
  });
  // End ROUND27 additions.
  // ROUND28: finite literal and source-boundary support must preserve ordinary names,
  // explicit calendar payment dates and prose while keeping actual groups unresolved.
  for (const [value, amount] of [['5角人民币', '0.50'], ['5角2分RMB', '0.52'], ['2分CNY', '0.02']]) await scenario(`round28_postposed_subunit_${value}`, async () => {
    const text = `测试王甲2026年1月完整应付工资${value}。`;
    const [item] = await fixture(`round28-subunit-${value}`, [{ text, exactSource: true, candidates: [money(value, value)] }]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1); assert.equal(material.candidates[0].amount, amount); assert.equal(material.candidates[0].normalization.status, 'exact');
    const legacy = stored(item.caseId), old = legacy.state.materials[0].candidates[0]; old.amount = null;
    old.normalization = { rawValue: old.value, amount: null, status: 'unsupported', matchedText: null, span: null, reason: 'Synthetic historical unsupported postposed RMB subunit literal' };
    db.prepare('UPDATE case_material_facts SET state_json=? WHERE case_id=? AND user_id=?').run(JSON.stringify(legacy.state), item.caseId, owner);
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert.equal(rawAndLocations(item, read.body).candidates[0].amount, null); assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({ name: `round28-subunit-${value}`, item, state: before });
    return { freshAmount: amount, historicalUnsupportedNotUpgraded: true, rawAndStoredHistoryUnchanged: true };
  });
  for (const value of ['出勤率為百分之八十', '支付比例為80%', '百分比為80%']) await scenario(`round28_traditional_ratio_${value}`, async () => {
    const [item] = await fixture(`round28-ratio-${value}`, [{ text: value + '。', exactSource: true, candidates: [money(value, value, { meaning: 'other_money', completeness: 'not_applicable', period: null, subject: null })] }]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 0); assert.equal(material.rejected.length, 1); assert.equal(JSON.parse(material.raw).candidates.length, 1); assert.match(material.rejected[0].reason, /没有金额表达/u);
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert.equal(rawAndLocations(item, read.body).candidates.length, 0); assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({ name: `round28-ratio-${value}`, item, state: before });
    return { accepted: 0, rejected: 1, rawCandidates: 1, rawAndStoredHistoryUnchanged: true };
  });
  for (const [name, text, value, meaning] of [
    ['traditional-after', '测试王甲於2026年1月後入職。', '2026年1月後', 'employment_period'],
    ['traditional-from', '测试王甲從2026年1月起任職。', '從2026年1月起', 'employment_period'],
    ['postposed-receipt', '测试王甲于2026年1月15日收到工资。', '2026年1月15日', 'payment_date'],
    ['payment-deadline', '测试王甲工资应于2026年1月15日前支付。', '2026年1月15日前', 'payment_date'],
  ]) await scenario(`round28_date_${name}`, async () => {
    const candidate = { kind: 'date', value, quote: value, subject: '测试王甲', scope: 'individual', meaning, completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated' };
    const [item] = await fixture(`round28-date-${name}`, [{ text, exactSource: true, candidates: [candidate] }]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1); assert(!material.candidates[0].reviewIssues.some(issue => issue.code === 'source_relation_unresolved'));
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert(!rawAndLocations(item, read.body).candidates[0].reviewIssues.some(issue => issue.code === 'source_relation_unresolved')); assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({ name: `round28-date-${name}`, item, state: before });
    return { date: value, meaning, sourceRelationSupported: true, rawAndStoredHistoryUnchanged: true };
  });
  for (const subject of ['王月', '王日', '王时']) await scenario(`round28_subject_suffix_${subject}`, async () => {
    const text = `${subject}工资4000元。`;
    const [item] = await fixture(`round28-name-unit-${subject}`, [{ text, exactSource: true, candidates: [money('4000元', '4000元', { subject, period: null })] }]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1); assert.equal(material.candidates[0].amount, '4000.00'); assert(!material.candidates[0].reviewIssues.some(issue => issue.code === 'rate_unit_mismatch'));
    assert(material.candidates[0].reviewIssues.some(issue => issue.code === 'source_relation_unresolved'), 'A bare wage amount still lacks a complete total relationship.');
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert.equal(rawAndLocations(item, read.body).candidates[0].amount, '4000.00'); assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({ name: `round28-name-unit-${subject}`, item, state: before });
    return { amount: '4000.00', subjectSuffixNotRate: true, incompleteTotalStillUnresolved: true, rawAndStoredHistoryUnchanged: true };
  });
  for (const subject of ['王和平', '何和', '周及', '甲和乙']) await scenario(`round28_subject_conjunction_${subject}`, async () => {
    // ROUND37: a three-character spelling alone cannot prove a single owner.
    const text = `${subject}2026年1月全部应付工资合计4000元。`, coordinated = ['甲和乙', '王和平'].includes(subject);
    const [item] = await fixture(`round28-name-conjunction-${subject}`, [{ text, exactSource: true, candidates: [money('4000元', '4000元', { subject })] }]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1);
    assert.equal(material.candidates[0].reviewIssues.some(issue => issue.code === 'source_relation_unresolved'), coordinated);
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert.equal(rawAndLocations(item, read.body).candidates[0].reviewIssues.some(issue => issue.code === 'source_relation_unresolved'), coordinated); assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({ name: `round28-name-conjunction-${subject}`, item, state: before });
    return { subject, coordinatedGroupStillUnresolved: coordinated, sourceRelationSupported: !coordinated, rawAndStoredHistoryUnchanged: true };
  });
  for (const continuation of ['以下列方式支付', '以上海银行卡支付', '以内地银行支付']) await scenario(`round28_payment_prose_${continuation}`, async () => {
    const text = `测试王甲工资4000元${continuation}。`;
    const [item] = await fixture(`round28-prose-${continuation}`, [{ text, exactSource: true, candidates: [money('4000元', '4000元', { period: null })] }]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1); assert.equal(material.candidates[0].amount, '4000.00'); assert.equal(material.candidates[0].normalization.status, 'exact');
    assert(material.candidates[0].reviewIssues.some(issue => issue.code === 'source_relation_unresolved'));
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert.equal(rawAndLocations(item, read.body).candidates[0].amount, '4000.00'); assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({ name: `round28-prose-${continuation}`, item, state: before });
    return { amount: '4000.00', ordinaryProseNotAmountBound: true, totalRelationshipStillUnresolved: true, rawAndStoredHistoryUnchanged: true };
  });
  // End ROUND28 additions.
  // New postposed subunit support must not expose a cropped tail across TXT blocks.
  for (const denomination of ['RMB', '人民币']) await scenario(`round28_cross_block_subunit_tail_${denomination}`, async () => {
    const value = `2分${denomination}`, text = `测试王甲工资5角\n${value}。`;
    const [item] = await fixture(`round28-subunit-tail-${denomination}`, [{ text, exactSource: true, candidates: [money(value, value, { period: null })] }]);
    assert.equal(item.analysis.result.blocks.length, 2);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1); assert.equal(material.candidates[0].amount, null); assert.notEqual(material.candidates[0].normalization.status, 'exact');
    const legacy = stored(item.caseId), old = legacy.state.materials[0].candidates[0]; old.amount = '0.02';
    old.normalization = { rawValue: old.value, amount: '0.02', status: 'exact', matchedText: old.value, span: { start: 0, end: Array.from(old.value).length }, reason: 'Synthetic exact tail cut from a cross-block 0.52 RMB amount' };
    db.prepare('UPDATE case_material_facts SET state_json=? WHERE case_id=? AND user_id=?').run(JSON.stringify(legacy.state), item.caseId, owner);
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert.equal(rawAndLocations(item, read.body).candidates[0].amount, null); assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({ name: `round28-subunit-tail-${denomination}`, item, state: before });
    return { amount: null, sourceBlocks: 2, historicalExactTailDowngraded: true, rawAndStoredHistoryUnchanged: true };
  });
  await scenario('round28_subunit_after_separate_worker_sentence', async () => {
    const value = '2分RMB', text = `测试王甲工资5角。\n王乙2026年1月全部应付工资合计${value}。`;
    const [item] = await fixture('round28-subunit-separate-worker', [{ text, exactSource: true, candidates: [money(value, value, { subject: '王乙' })] }]);
    assert.equal(item.analysis.result.blocks.length, 2);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1); assert.equal(material.candidates[0].amount, '0.02'); assert.equal(material.candidates[0].normalization.status, 'exact');
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert.equal(rawAndLocations(item, read.body).candidates[0].amount, '0.02'); assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({ name: 'round28-subunit-separate-worker', item, state: before });
    return { amount: '0.02', sourceBlocks: 2, otherWorkerAmountNotJoined: true, rawAndStoredHistoryUnchanged: true };
  });
  for (const subject of ['王等', '甲等', '他们']) await scenario(`round28_collective_subject_${subject}`, async () => {
    const text = `${subject}2026年1月全部应付工资合计4000元。`;
    const [item] = await fixture(`round28-collective-${subject}`, [{ text, exactSource: true, candidates: [money('4000元', '4000元', { subject })] }]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1);
    assert(material.candidates[0].reviewIssues.some(issue => issue.code === 'source_relation_unresolved'));
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert(rawAndLocations(item, read.body).candidates[0].reviewIssues.some(issue => issue.code === 'source_relation_unresolved')); assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({ name: `round28-collective-${subject}`, item, state: before });
    return { collectiveSubjectUnresolved: true, rawAndStoredHistoryUnchanged: true };
  });
  // ROUND29: detect finite traditional qualifiers without changing raw output,
  // and distinguish explicit RMB prefixes/payment schedules from unsafe amounts.
  for (const value of ['RMB 4000', 'CNY4000', '人民幣4000']) await scenario(`round29_rmb_prefix_${value}`, async () => {
    const text = `测试王甲2026年1月全部应付工资合计${value}。`;
    const [item] = await fixture(`round29-prefix-${value}`, [{ text, exactSource: true, candidates: [money(value, value)] }]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1); assert.equal(material.candidates[0].amount, '4000.00');
    const legacy = stored(item.caseId), old = legacy.state.materials[0].candidates[0]; old.amount = null;
    old.normalization = { rawValue: old.value, amount: null, status: 'unsupported', matchedText: null, span: null, reason: 'Synthetic historical unsupported preposed RMB literal' };
    db.prepare('UPDATE case_material_facts SET state_json=? WHERE case_id=? AND user_id=?').run(JSON.stringify(legacy.state), item.caseId, owner);
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert.equal(rawAndLocations(item, read.body).candidates[0].amount, null); assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({ name: `round29-prefix-${value}`, item, state: before });
    return { freshAmount: '4000.00', historicalUnsupportedNotUpgraded: true, rawAndStoredHistoryUnchanged: true };
  });
  for (const schedule of ['每月15日支付', '每月十五日支付', '按月15日支付']) await scenario(`round29_payment_schedule_${schedule}`, async () => {
    const text = `测试王甲工资4000元${schedule}。`;
    const [item] = await fixture(`round29-schedule-${schedule}`, [{ text, exactSource: true, candidates: [money('4000元', '4000元', { meaning: 'other_money', completeness: 'not_applicable', period: null })] }]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1); assert.equal(material.candidates[0].amount, '4000.00'); assert(!material.candidates[0].reviewIssues.some(issue => issue.code === 'rate_unit_mismatch'));
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert.equal(rawAndLocations(item, read.body).candidates[0].amount, '4000.00'); assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({ name: `round29-schedule-${schedule}`, item, state: before });
    return { amount: '4000.00', calendarScheduleNotRate: true, rawAndStoredHistoryUnchanged: true };
  });
  const round29Unavailable = [
    ...['乘以出勤係數', '×出勤係數', '乘以出勤系数'].map(tail => ({ name: `coefficient-${tail}`, phrase: `四万元${tail}`, value: '四万元' })),
    ...['超過', '不超過', '不得超過', '將近'].map(prefix => ({ name: `bound-${prefix}`, phrase: `${prefix}4000元`, value: '4000元' })),
    ...['不詳', '無法確定', '待確認', '未載明', '暫定'].flatMap(tail => [false, true].map(full => ({ name: `uncertain-${tail}-${full ? 'full' : 'cropped'}`, phrase: `4000元${tail}`, value: full ? `4000元${tail}` : '4000元' }))),
  ];
  for (const itemCase of round29Unavailable) await scenario(`round29_${itemCase.name}`, async () => {
    const text = `测试王甲工资${itemCase.phrase}。`;
    const [item] = await fixture(`round29-${itemCase.name}`, [{ text, exactSource: true, candidates: [money(itemCase.value, itemCase.value, { meaning: 'other_money', completeness: 'not_applicable', period: null })] }]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1); assert.equal(material.candidates[0].amount, null); assert.notEqual(material.candidates[0].normalization.status, 'exact');
    const legacy = stored(item.caseId), old = legacy.state.materials[0].candidates[0]; old.amount = itemCase.value.startsWith('四万元') ? '40000.00' : '4000.00';
    old.normalization = { rawValue: old.value, amount: old.amount, status: 'exact', matchedText: old.value, span: { start: 0, end: Array.from(old.value).length }, reason: 'Synthetic historical exact amount missing a source qualifier' };
    db.prepare('UPDATE case_material_facts SET state_json=? WHERE case_id=? AND user_id=?').run(JSON.stringify(legacy.state), item.caseId, owner);
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert.equal(rawAndLocations(item, read.body).candidates[0].amount, null); assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({ name: `round29-${itemCase.name}`, item, state: before });
    return { amount: null, historicalExactDowngraded: true, rawAndStoredHistoryUnchanged: true };
  });
  for (const [name, secondLine, expected] of [['valid', '15日支付。', '4000.00'], ['invalid-day', '32日支付。', null], ['another-worker', '王乙15日支付。', null]]) await scenario(`round29_split_schedule_${name}`, async () => {
    const text = `测试王甲工资4000元每月\n${secondLine}`;
    const [item] = await fixture(`round29-split-${name}`, [{ text, exactSource: true, candidates: [money('4000元', '4000元', { meaning: 'other_money', completeness: 'not_applicable', period: null })] }]);
    assert.equal(item.analysis.result.blocks.length, 2);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1); assert.equal(material.candidates[0].amount, expected);
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert.equal(rawAndLocations(item, read.body).candidates[0].amount, expected); assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({ name: `round29-split-${name}`, item, state: before });
    return { amount: expected, sourceBlocks: 2, rawAndStoredHistoryUnchanged: true };
  });
  // ROUND30: keep all prior cases and verify bounded fullwidth/prose support,
  // explicit proportion operands and signed suffixes in fresh and historical reads.
  const round30Cases = [
    ...['４０００元', '人民币４０００元', '￥４０００元'].map(value => ({ name: `fullwidth-${value}`, phrase: value, value, amount: '4000.00', historyNull: true })),
    ...['一次性支付', '一并支付', '三日内支付'].map(tail => ({ name: `prose-${tail}`, phrase: `4000元${tail}`, value: '4000元', amount: '4000.00' })),
    ...['半成', '半折', '对折'].flatMap(tail => [false, true].map(full => ({ name: `proportion-${tail}-${full}`, phrase: `四万元乘以${tail}`, value: full ? `四万元乘以${tail}` : '四万元', amount: null, seed: '40000.00' }))),
    ...['（负数）', '为负数', '负值'].flatMap(tail => [false, true].map(full => ({ name: `signed-${tail}-${full}`, phrase: `4000元${tail}`, value: full ? `4000元${tail}` : '4000元', amount: null, seed: '4000.00' }))),
    ...['半成计算', '半折计发', '对折支付'].flatMap(tail => [false, true].map(full => ({ name: `proportion-tail-${tail}-${full}`, phrase: `四万元乘以${tail}`, value: full ? `四万元乘以${tail}` : '四万元', amount: null, seed: '40000.00' }))),
    ...['为负数记录', '负值金额'].flatMap(tail => [false, true].map(full => ({ name: `signed-tail-${tail}-${full}`, phrase: `4000元${tail}`, value: full ? `4000元${tail}` : '4000元', amount: null, seed: '4000.00' }))),
    ...[false, true].map(full => ({ name: `payment-question-${full}`, phrase: '4000元三日内支付?', value: full ? '4000元三日内支付?' : '4000元', amount: null, seed: '4000.00' })),
    { name: 'fullwidth-foreign', phrase: '４０００港元', value: '４０００', amount: null, seed: '4000.00' },
    { name: 'fullwidth-range', phrase: '４０００元至５０００元', value: '４０００元', amount: null, seed: '4000.00' },
    { name: 'fullwidth-rate', phrase: '４０００元每天', value: '４０００元', amount: null, seed: '4000.00' },
    { name: 'real-number-tail', phrase: '4000元五角', value: '4000元', amount: null, seed: '4000.00' },
    { name: 'signed-next-sentence', phrase: '4000元。王乙余额为负数', value: '4000元', amount: '4000.00' },
    { name: 'fullwidth-decimal', phrase: '４０００．５０元', value: '４０００．５０元', amount: '4000.50', historyNull: true },
  ];
  for (const entry of round30Cases) await scenario(`round30_${entry.name}`, async () => {
    const text = `测试王甲工资${entry.phrase}。`;
    const [item] = await fixture(`round30-${entry.name}`, [{ text, exactSource: true, candidates: [money(entry.value, entry.value, { meaning: 'other_money', completeness: 'not_applicable', period: null })] }]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1); assert.equal(material.candidates[0].amount, entry.amount);
    if (entry.amount === null) assert.notEqual(material.candidates[0].normalization.status, 'exact');
    else assert.equal(material.candidates[0].normalization.status, 'exact');
    if (entry.historyNull || entry.amount === null) {
      const legacy = stored(item.caseId), old = legacy.state.materials[0].candidates[0]; old.amount = entry.historyNull ? null : entry.seed;
      old.normalization = { rawValue: old.value, amount: old.amount, status: entry.historyNull ? 'unsupported' : 'exact', matchedText: old.value, span: { start: 0, end: Array.from(old.value).length }, reason: 'Synthetic historical ROUND30 amount for downgrade or non-upgrade verification' };
      db.prepare('UPDATE case_material_facts SET state_json=? WHERE case_id=? AND user_id=?').run(JSON.stringify(legacy.state), item.caseId, owner);
    }
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert.equal(rawAndLocations(item, read.body).candidates[0].amount, entry.historyNull ? null : entry.amount); assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({ name: `round30-${entry.name}`, item, state: before });
    return { freshAmount: entry.amount, historicalExactDowngraded: entry.amount === null, historicalUnsupportedNotUpgraded: Boolean(entry.historyNull), rawAndStoredHistoryUnchanged: true };
  });
  // ROUND31: traditional/date spelling preserves raw evidence and confirmation.
  for (const [name, text, value, meaning, supported] of [
    ['monthly-number', '测试王甲每月15号收到工资。', '每月15号', 'payment_date', true],
    ['monthly-traditional', '测试王甲每月十五號收到工資。', '每月十五號', 'payment_date', true],
    ['actual-receipt', '测试王甲於2026年1月實際收到工資。', '2026年1月', 'payment_date', true],
    ['employment-end', '测试王甲於2026年1月解除勞動關係。', '2026年1月', 'employment_period', true],
    ['denied-receipt', '测试王甲於2026年1月未實際收到工資。', '2026年1月', 'payment_date', false],
    ['other-worker', '测试王甲记载测试王乙每月15号收到工资。', '每月15号', 'payment_date', false],
  ]) await scenario(`round31_date_${name}`, async () => {
    const candidate = { kind: 'date', value, quote: value, subject: '测试王甲', scope: 'individual', meaning, completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated' };
    const [item] = await fixture(`round31-date-${name}`, [{ text, exactSource: true, candidates: [candidate] }]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1);
    assert.equal(material.candidates[0].reviewIssues.some(issue => issue.code === 'source_relation_unresolved'), !supported);
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert.equal(rawAndLocations(item, read.body).candidates[0].reviewIssues.some(issue => issue.code === 'source_relation_unresolved'), !supported);
    assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({ name: `round31-date-${name}`, item, state: before });
    return { value, supported, rawAndStoredHistoryUnchanged: true };
  });
  for (const [name, value, meaning, rateUnit, amount, sourceValue = value] of [
    ['hour-long', '4000元/小時', 'rate', 'hour', '4000.00'],
    ['hour-every', '4000元每小時', 'rate', 'hour', '4000.00'],
    ['hour-short', '4000元/時', 'rate', 'hour', '4000.00'],
    ['hour-as-total', '4000元/小時', 'due_total', null, null],
    ['hour-pending-cropped', '4000元', 'rate', 'hour', null, '4000元/小時待定'],
    ['hour-pending-full', '4000元/小時待定', 'rate', 'hour', null],
  ]) await scenario(`round31_rate_${name}`, async () => {
    const text = `测试王甲工资${sourceValue}。`;
    const [item] = await fixture(`round31-rate-${name}`, [{ text, exactSource: true, candidates: [money(value, value, { meaning, completeness: meaning === 'rate' ? 'not_applicable' : 'complete', period: null, rateUnit })] }]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1); assert.equal(material.candidates[0].amount, amount);
    if (amount !== null) {
      const legacy = stored(item.caseId), old = legacy.state.materials[0].candidates[0]; old.amount = null;
      old.normalization = { rawValue: value, amount: null, status: 'unsupported', matchedText: null, span: null, reason: 'Synthetic historical unsupported traditional hourly suffix' };
      db.prepare('UPDATE case_material_facts SET state_json=? WHERE case_id=? AND user_id=?').run(JSON.stringify(legacy.state), item.caseId, owner);
    }
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert.equal(rawAndLocations(item, read.body).candidates[0].amount, null, 'Read-time review must not upgrade a stored null amount.');
    assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({ name: `round31-rate-${name}`, item, state: before });
    return { freshAmount: amount, historicalUnsupportedNotUpgraded: amount !== null, rawAndStoredHistoryUnchanged: true };
  });
  // End ROUND31 additions.
  // ROUND32: estimates remain unavailable, complete angle nouns stay in raw
  // rejection records, and recurring payment layouts retain same-worker scope.
  const round32Bounds = [
    ...['约有','大约有','将近有'].flatMap(prefix => [false,true].map(full => ({name: `${prefix}-${full}`, text: `测试王甲工资${prefix}4000元。`, value: full ? `${prefix}4000元` : '4000元', amount: null}))),
    {name: 'layout', text: '测试王甲工资约有\n4000元。', value: '4000元', amount: null},
    {name: 'another-clause', text: '测试王乙约有三人同行。测试王甲工资4000元。', value: '4000元', amount: '4000.00'},
  ];
  for (const entry of round32Bounds) await scenario(`round32_bound_${entry.name}`, async () => {
    const [item] = await fixture(`round32-bound-${entry.name}`, [{ text: entry.text, exactSource: true, candidates: [money(entry.value, entry.value, {meaning: 'other_money', completeness: 'not_applicable', period: null})] }]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1); assert.equal(material.candidates[0].amount, entry.amount);
    if (entry.amount === null) {
      assert.notEqual(material.candidates[0].normalization.status, 'exact');
      const legacy = stored(item.caseId), old = legacy.state.materials[0].candidates[0]; old.amount = '4000.00';
      old.normalization = {rawValue: old.value, amount: old.amount, status: 'exact', matchedText: old.value, span: {start: 0, end: Array.from(old.value).length}, reason: 'Synthetic historical exact estimate for ROUND32 downgrade check'};
      db.prepare('UPDATE case_material_facts SET state_json=? WHERE case_id=? AND user_id=?').run(JSON.stringify(legacy.state), item.caseId, owner);
    }
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert.equal(rawAndLocations(item, read.body).candidates[0].amount, entry.amount); assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({name: `round32-bound-${entry.name}`, item, state: before});
    return {amount: entry.amount, historicalExactDowngraded: entry.amount === null, rawAndStoredHistoryUnchanged: true};
  });
  for (const [name, text, supported] of [
    ['wage-first', '测试王甲工资每月15日发放。', true],
    ['date-first', '测试王甲每月15日支付工资。', true],
    ['other-worker', '测试王甲记载测试王乙工资每月15日发放。', false],
    ['denied', '测试王甲工资每月15日未发放。', false],
  ]) await scenario(`round32_date_${name}`, async () => {
    const value = '每月15日';
    const candidate = {kind: 'date', value, quote: value, subject: '测试王甲', scope: 'individual', meaning: 'payment_date', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated'};
    const [item] = await fixture(`round32-date-${name}`, [{text, exactSource: true, candidates: [candidate]}]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1); assert.equal(material.candidates[0].reviewIssues.some(issue => issue.code === 'source_relation_unresolved'), !supported);
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert.equal(rawAndLocations(item, read.body).candidates[0].reviewIssues.some(issue => issue.code === 'source_relation_unresolved'), !supported); assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({name: `round32-date-${name}`, item, state: before});
    return {supported, rawAndStoredHistoryUnchanged: true};
  });
  for (const value of ['五角星', '三角洲', '八角亭', '五角大楼']) await scenario(`round32_nonmoney_${value}`, async () => {
    const [item] = await fixture(`round32-angle-${value}`, [{text: `测试王甲材料记载${value}。`, exactSource: true, candidates: [money(value, value, {meaning: 'other_money', completeness: 'not_applicable', period: null})]}]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 0); assert.equal(material.rejected.length, 1); assert.equal(JSON.parse(material.raw).candidates[0].value, value); assert.match(material.rejected[0].reason, /没有金额表达/u);
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    const reread = rawAndLocations(item, read.body); assert.deepEqual(reread.candidates, []); assert.deepEqual(reread.rejected, material.rejected); assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({name: `round32-angle-${value}`, item, state: before});
    return {accepted: 0, rejected: 1, rawAndStoredHistoryUnchanged: true};
  });
  // Explicit RMB cannot convert the clipped beginning of an angle noun to cents.
  for (const [name, text, value, quote] of [
    ['full', '测试王甲材料记载人民币五角星。', '人民币五角星', '人民币五角星'],
    ['value-crop', '测试王甲材料记载人民币五角星。', '人民币五角', '人民币五角星'],
    ['value-quote-crop', '测试王甲材料记载人民币五角星。', '人民币五角', '人民币五角'],
    ['layout-crop', '测试王甲材料记载人民币五角\n星。', '人民币五角', '人民币五角'],
  ]) await scenario(`round32_rmb_angle_${name}`, async () => {
    const [item] = await fixture(`round32-rmb-angle-${name}`, [{text, exactSource: true, candidates: [money(value, quote, {meaning: 'other_money', completeness: 'not_applicable', period: null})]}]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1); assert.equal(material.candidates[0].amount, null); assert.notEqual(material.candidates[0].normalization.status, 'exact');
    const legacy = stored(item.caseId), old = legacy.state.materials[0].candidates[0]; old.amount = '0.50';
    old.normalization = {rawValue: old.value, amount: old.amount, status: 'exact', matchedText: '人民币五角', span: {start: 0, end: 5}, reason: 'Synthetic historical clipped RMB angle noun'};
    db.prepare('UPDATE case_material_facts SET state_json=? WHERE case_id=? AND user_id=?').run(JSON.stringify(legacy.state), item.caseId, owner);
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert.equal(rawAndLocations(item, read.body).candidates[0].amount, null); assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({name: `round32-rmb-angle-${name}`, item, state: before});
    return {amount: null, historicalExactDowngraded: true, rawAndStoredHistoryUnchanged: true};
  });
  // End ROUND32 additions.
  // ROUND33: postfix RMB scope, duplicate markers and lexical layout boundaries.
  const round33Cases = [
    { name: 'postfix-rmb', text: '测试王甲2026年1月全部应付工资合计4000人民币。', value: '4000人民币', amount: '4000.00', total: true, group: false },
    { name: 'postfix-traditional', text: '测试王甲2026年1月全部应付工资合计4000人民幣。', value: '4000人民幣', amount: '4000.00', total: true, group: false },
    ...['4000人民币人民币', '4000元人民币CNY', '4000人民幣人民幣'].map(value => ({ name: `duplicate-${value}`, text: `测试王甲工资${value}。`, value, amount: null, seed: '4000.00' })),
    { name: 'duplicate-cropped', text: '测试王甲工资4000人民币人民币。', value: '4000人民币', amount: null, seed: '4000.00' },
    { name: 'duplicate-next-block', text: '测试王甲工资4000人民币\n人民币。', value: '4000人民币', amount: null, seed: '4000.00' },
    { name: 'new-worker-not-minutes', text: '测试王甲工资人民币2分\n钟某2026年2月工资9000元。', value: '人民币2分', amount: '0.02' },
    { name: 'true-group', text: '测试王甲等3人2026年1月全部应付工资合计4000人民币。', value: '4000人民币', amount: '4000.00', total: true, group: true },
    { name: 'actual-minutes-continuation', text: '测试王甲工资人民币2分\n钟。', value: '人民币2分', amount: null, seed: '0.02' },
  ];
  for (const entry of round33Cases) await scenario(`round33_${entry.name}`, async () => {
    const attributes = entry.total ? {} : { meaning: 'other_money', completeness: 'not_applicable', period: null };
    const [item] = await fixture(`round33-${entry.name}`, [{ text: entry.text, exactSource: true, candidates: [money(entry.value, entry.value, attributes)] }]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1);
    assert.equal(material.candidates[0].amount, entry.amount);
    if (entry.group !== undefined) assert.equal(material.candidates[0].reviewIssues.some(issue => issue.code === 'scope_text_mismatch'), entry.group);
    const legacy = stored(item.caseId), old = legacy.state.materials[0].candidates[0];
    old.amount = entry.amount === null ? entry.seed : null;
    old.normalization = { rawValue: old.value, amount: old.amount, status: entry.amount === null ? 'exact' : 'unsupported', matchedText: old.value, span: { start: 0, end: Array.from(old.value).length }, reason: 'Synthetic historical ROUND33 candidate for downgrade and non-upgrade verification' };
    db.prepare('UPDATE case_material_facts SET state_json=? WHERE case_id=? AND user_id=?').run(JSON.stringify(legacy.state), item.caseId, owner);
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert.equal(rawAndLocations(item, read.body).candidates[0].amount, null);
    assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({ name: `round33-${entry.name}`, item, state: before });
    return { freshAmount: entry.amount, scopeMismatch: entry.group ?? null, historicalExactDowngraded: entry.amount === null, historicalNullNotUpgraded: entry.amount !== null, rawAndStoredHistoryUnchanged: true };
  });
  // End ROUND33 additions.
  // ROUND34: finite date wrappers, anchored two-character names and whole rate units.
  for (const [name, text, value, supported = true] of [
    ['recurring-at', '测试王甲工资于每月15日发放。', '每月15日'],
    ['recurring-in', '测试王甲工资在每月15日发放。', '每月15日'],
    ['traditional-pay', '测试王甲工資應於2026年1月15日前給付。', '2026年1月15日前'],
    ['traditional-pay-cropped', '测试王甲工資應於2026年1月15日前給付。', '2026年1月15日', false],
    ['traditional-finish', '测试王甲工資應於2026年1月15日前支付完畢。', '2026年1月15日前'],
    ['traditional-finish-cropped', '测试王甲工資應於2026年1月15日前支付完畢。', '2026年1月15日', false],
  ]) await scenario(`round34_date_${name}`, async () => {
    const candidate = {kind: 'date', value, quote: value, subject: '测试王甲', scope: 'individual', meaning: 'payment_date', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated'};
    const [item] = await fixture(`round34-date-${name}`, [{text, exactSource: true, candidates: [candidate]}]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1);
    assert.equal(material.candidates[0].reviewIssues.some(issue => issue.code === 'source_relation_unresolved'), !supported);
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert.equal(rawAndLocations(item, read.body).candidates[0].reviewIssues.some(issue => issue.code === 'source_relation_unresolved'), !supported);
    assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({name: `round34-date-${name}`, item, state: before});
    return {supported, rawAndStoredHistoryUnchanged: true};
  });
  const round34Money = [
    ...['王近', '王约'].map(subject => ({name: `name-${subject}`, subject, text: `${subject}工资4000元。`, value: '4000元', amount: '4000.00'})),
    {name: 'real-estimate-after-name', subject: '王近', text: '王近工资约4000元。', value: '4000元', amount: null},
    {name: 'fabricated-name-swallow', subject: '工资约', text: '工资约4000元。', value: '4000元', amount: null},
    ...['月亮', '月份', '小时候'].map(unit => ({name: `whole-unit-${unit}`, subject: '测试王甲', text: `测试王甲工资4000元/${unit}。`, value: `4000元/${unit}`, amount: null, rate: unit === '小时候' ? 'hour' : 'month'})),
    {name: 'cropped-unit', subject: '测试王甲', text: '测试王甲工资4000元/月亮。', value: '4000元', amount: null, rate: 'month'},
    {name: 'valid-month', subject: '测试王甲', text: '测试王甲工资4000元/月。', value: '4000元/月', amount: '4000.00', rate: 'month'},
  ];
  for (const entry of round34Money) await scenario(`round34_money_${entry.name}`, async () => {
    const attributes = {subject: entry.subject, meaning: entry.rate ? 'rate' : 'other_money', completeness: 'not_applicable', period: null, rateUnit: entry.rate ?? null};
    const [item] = await fixture(`round34-money-${entry.name}`, [{text: entry.text, exactSource: true, candidates: [money(entry.value, entry.value, attributes)]}]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1); assert.equal(material.candidates[0].amount, entry.amount);
    if (entry.amount === null) assert.notEqual(material.candidates[0].normalization.status, 'exact');
    const legacy = stored(item.caseId), old = legacy.state.materials[0].candidates[0]; old.amount = entry.amount === null ? '4000.00' : null;
    old.normalization = {rawValue: old.value, amount: old.amount, status: entry.amount === null ? 'exact' : 'unsupported', matchedText: old.value, span: {start: 0, end: Array.from(old.value).length}, reason: 'Synthetic historical ROUND34 downgrade or non-upgrade verification'};
    db.prepare('UPDATE case_material_facts SET state_json=? WHERE case_id=? AND user_id=?').run(JSON.stringify(legacy.state), item.caseId, owner);
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert.equal(rawAndLocations(item, read.body).candidates[0].amount, null); assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({name: `round34-money-${entry.name}`, item, state: before});
    return {freshAmount: entry.amount, historicalExactDowngraded: entry.amount === null, historicalNullNotUpgraded: entry.amount !== null, rawAndStoredHistoryUnchanged: true};
  });
  // End ROUND34 additions.
  // ROUND34 CI closure: independent newline versus explicit slash continuation.
  for (const entry of [
    {name: 'detached-month', text: '测试王甲2026年1月完整应付工资80000元\n每月。', amount: '80000.00', status: 'exact', relation: true},
    {name: 'slash-line-total', text: '测试王甲工资80000元/\n月。', amount: null, status: 'rate_unit_mismatch'},
    {name: 'slash-line-rate', text: '测试王甲工资80000元/\n月。', amount: '80000.00', status: 'exact', rate: true},
    {name: 'slash-line-compound', text: '测试王甲工资80000元/\n月亮。', amount: null, status: 'unsupported', rate: true},
    {name: 'slash-next-block', text: '测试王甲工资80000元\n/月亮。', amount: null, status: 'unsupported', rate: true},
    {name: 'bounded-unit-total', text: '测试王甲工资80000元/月以上。', amount: null, status: 'rate_unit_mismatch'},
    {name: 'bounded-unit-rate', text: '测试王甲工资80000元/月以上。', amount: null, status: 'approximate', rate: true},
    {name: 'bounded-word-compound', text: '测试王甲工资80000元/月以上海。', amount: null, status: 'unsupported', rate: true},
  ]) await scenario(`round34_ci_${entry.name}`, async () => {
    const attributes = entry.rate ? {meaning: 'rate', completeness: 'not_applicable', period: null, rateUnit: 'month'} : {period: entry.name === 'detached-month' ? '2026年1月' : null};
    const [item] = await fixture(`round34-ci-${entry.name}`, [{text: entry.text, exactSource: true, candidates: [money('80000元', '80000元', attributes)]}]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1); const fact = material.candidates[0];
    assert.equal(fact.amount, entry.amount); assert.equal(fact.normalization.status, entry.status);
    if (entry.relation) assert(fact.reviewIssues.some(issue => issue.code === 'source_relation_unresolved'));
    const legacy = stored(item.caseId), old = legacy.state.materials[0].candidates[0]; old.amount = entry.amount === null ? '80000.00' : null;
    old.normalization = {rawValue: old.value, amount: old.amount, status: entry.amount === null ? 'exact' : 'unsupported', matchedText: old.value, span: {start: 0, end: Array.from(old.value).length}, reason: 'Synthetic historical ROUND34 CI compatibility boundary'};
    db.prepare('UPDATE case_material_facts SET state_json=? WHERE case_id=? AND user_id=?').run(JSON.stringify(legacy.state), item.caseId, owner);
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert.equal(rawAndLocations(item, read.body).candidates[0].amount, null); assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({name: `round34-ci-${entry.name}`, item, state: before});
    return {freshAmount: entry.amount, normalizationStatus: entry.status, historicalExactDowngraded: entry.amount === null, historicalNullNotUpgraded: entry.amount !== null, rawAndStoredHistoryUnchanged: true};
  });
  // End ROUND34 CI closure additions.
  // ROUND35: currency-prefixed empty labels are rejected; unknown prose remains
  // visible but never authorizes an amount. TXT fixtures do not prove page OCR.
  for (const value of ['人民币工资', '人民币薪资', '人民币金额', '￥工资']) await scenario(`round35_empty_currency_label_${value}`, async () => {
    const [item] = await fixture(`round35-label-${value}`, [{text: value + '。', exactSource: true, candidates: [money(value, value, {subject: null, scope: 'unknown', meaning: 'other_money', completeness: 'not_applicable', period: null})]}]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 0); assert.equal(material.rejected.length, 1); assert.match(material.rejected[0].reason, /没有金额表达/u);
    assert.equal(JSON.parse(material.raw).candidates[0].value, value);
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert.equal(rawAndLocations(item, read.body).candidates.length, 0); assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({name: `round35-label-${value}`, item, state: before});
    return {accepted: 0, rejected: 1, rawAndStoredHistoryUnchanged: true};
  });
  for (const value of ['人民币工资不详', '测试王甲人民币工资']) await scenario(`round35_unresolved_currency_prose_${value}`, async () => {
    const [item] = await fixture(`round35-unresolved-${value}`, [{text: value + '。', exactSource: true, candidates: [money(value, value, {subject: value.startsWith('测试王甲') ? '测试王甲' : null, scope: 'unknown', meaning: 'other_money', completeness: 'not_applicable', period: null})]}]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1); assert.equal(material.candidates[0].amount, null); assert.notEqual(material.candidates[0].normalization.status, 'exact');
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert.equal(rawAndLocations(item, read.body).candidates[0].amount, null); assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({name: `round35-unresolved-${value}`, item, state: before});
    return {accepted: 1, amount: null, usable: false, rawAndStoredHistoryUnchanged: true};
  });
  for (const [name, continuation] of [['qualifier', '以上事实无争议'], ['range', '至5000元为李乙工资'], ['arithmetic', '×2是附件编号']]) await scenario(`round35_unknown_block_boundary_${name}`, async () => {
    const text = `测试王甲收到工资4000元\n${continuation}`;
    const [item] = await fixture(`round35-block-${name}`, [{text, exactSource: true, candidates: [money('4000元', '4000元', {meaning: 'paid_total', completeness: 'unknown', period: null})]}]);
    assert.equal(item.analysis.result.blocks.length, 2);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1); assert.equal(material.candidates[0].amount, null); assert.equal(material.candidates[0].normalization.status, 'uncertain');
    const legacy = stored(item.caseId), old = legacy.state.materials[0].candidates[0]; old.amount = '4000.00';
    old.normalization = {rawValue: old.value, amount: old.amount, status: 'exact', matchedText: old.value, span: {start: 0, end: Array.from(old.value).length}, reason: 'Synthetic historical unconfirmed layout boundary'};
    db.prepare('UPDATE case_material_facts SET state_json=? WHERE case_id=? AND user_id=?').run(JSON.stringify(legacy.state), item.caseId, owner);
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert.equal(rawAndLocations(item, read.body).candidates[0].amount, null); assert.equal(read.body.state.materials[0].candidates[0].normalization.status, 'uncertain'); assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({name: `round35-block-${name}`, item, state: before});
    return {amount: null, normalizationStatus: 'uncertain', samePageTxtBlocks: 2, historicalExactDowngraded: true, rawAndStoredHistoryUnchanged: true};
  });
  // Actual same-page safety regressions found by the full integration check.
  for (const tail of ['USD', '港币', 'EUR', '？']) await scenario(`round35_terminal_continuation_${tail}`, async () => {
    const text = `测试王甲工资4000元整\n${tail}。`;
    const [item] = await fixture(`round35-terminal-${tail}`, [{text, exactSource: true, candidates: [money('4000元', '4000元', {meaning: 'other_money', completeness: 'not_applicable', period: null})]}]);
    assert.equal(item.analysis.result.blocks.length, 2);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1); assert.equal(material.candidates[0].amount, null); assert.notEqual(material.candidates[0].normalization.status, 'exact');
    const legacy = stored(item.caseId), old = legacy.state.materials[0].candidates[0]; old.amount = '4000.00';
    old.normalization = {rawValue: old.value, amount: old.amount, status: 'exact', matchedText: old.value, span: {start: 0, end: Array.from(old.value).length}, reason: 'Synthetic historical terminal continuation regression'};
    db.prepare('UPDATE case_material_facts SET state_json=? WHERE case_id=? AND user_id=?').run(JSON.stringify(legacy.state), item.caseId, owner);
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert.equal(rawAndLocations(item, read.body).candidates[0].amount, null); assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({name: `round35-terminal-${tail}`, item, state: before});
    return {amount: null, historicalExactDowngraded: true, rawAndStoredHistoryUnchanged: true};
  });
  // End ROUND35 additions.
  // ROUND36: conjunction bounds stay unavailable; complete 个月 aliases retain
  // their monthly rate role. Historical nulls are never silently upgraded.
  for (const entry of [
    ...['及以上', '或以下', '或以上', '及以下'].map((tail, index) => ({name: `bound-${tail}`, tail, full: index < 2, amount: null, status: 'approximate'})),
    ...['每个月', '/个月', '每個月'].map(tail => ({name: `month-${tail}`, tail, rate: true, amount: '4000.00', status: 'exact'})),
    ...['每个月亮', '/个月份'].map(tail => ({name: `compound-${tail}`, tail, rate: true, amount: null, status: 'unsupported'})),
    {name: 'monthly-rate-not-total', tail: '每个月', amount: null, status: 'rate_unit_mismatch'},
  ]) await scenario(`round36_${entry.name}`, async () => {
    const value = entry.full ? `4000元${entry.tail}` : '4000元';
    const attributes = entry.rate ? {meaning: 'rate', completeness: 'not_applicable', period: null, rateUnit: 'month'} : {period: null};
    const [item] = await fixture(`round36-${entry.name}`, [{text: `测试王甲工资4000元${entry.tail}。`, exactSource: true, candidates: [money(value, value, attributes)]}]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1);
    assert.equal(material.candidates[0].amount, entry.amount); assert.equal(material.candidates[0].normalization.status, entry.status);
    const legacy = stored(item.caseId), old = legacy.state.materials[0].candidates[0]; old.amount = entry.amount === null ? '4000.00' : null;
    old.normalization = {rawValue: old.value, amount: old.amount, status: entry.amount === null ? 'exact' : 'unsupported', matchedText: old.value, span: {start: 0, end: Array.from(old.value).length}, reason: 'Synthetic historical ROUND36 bound or monthly alias'};
    db.prepare('UPDATE case_material_facts SET state_json=? WHERE case_id=? AND user_id=?').run(JSON.stringify(legacy.state), item.caseId, owner);
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert.equal(rawAndLocations(item, read.body).candidates[0].amount, null); assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({name: `round36-${entry.name}`, item, state: before});
    return {freshAmount: entry.amount, normalizationStatus: entry.status, historicalExactDowngraded: entry.amount === null, historicalNullNotUpgraded: entry.amount !== null, rawAndStoredHistoryUnchanged: true};
  });
  // End ROUND36 additions.
  // ROUND36 companion review: bounded common spelling/layout repairs.
  for (const [name, sourceValue, value] of [
    ['fullwidth-wide-symbol', '￥４０００', '￥４０００'],
    ['fullwidth-symbol', '¥４０００', '¥４０００'],
    ['traditional-together', '4000元一並支付', '4000元'],
    ['traditional-together-variant', '4000元一併給付', '4000元'],
  ]) await scenario(`round36_spelling_${name}`, async () => {
    const [item] = await fixture(`round36-spelling-${name}`, [{text: `测试王甲工资${sourceValue}。`, exactSource: true, candidates: [money(value, value, {period: null})]}]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1); assert.equal(material.candidates[0].amount, '4000.00');
    const legacy = stored(item.caseId), old = legacy.state.materials[0].candidates[0]; old.amount = null;
    old.normalization = {rawValue: old.value, amount: null, status: 'unsupported', matchedText: null, span: null, reason: 'Synthetic historical ROUND36 spelling rejection'};
    db.prepare('UPDATE case_material_facts SET state_json=? WHERE case_id=? AND user_id=?').run(JSON.stringify(legacy.state), item.caseId, owner);
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert.equal(rawAndLocations(item, read.body).candidates[0].amount, null); assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({name: `round36-spelling-${name}`, item, state: before});
    return {freshAmount: '4000.00', historicalNullNotUpgraded: true, rawAndStoredHistoryUnchanged: true};
  });
  for (const [value, text] of [
    ['每個月十五號', '测试王甲工資每個月十五號發放。'],
    ['每月第15日', '测试王甲工资每月第15日发放。'],
    ['2026年1月15日', '测试王甲工资于2026年1月15日支付。'],
  ]) await scenario(`round36_payment_date_${value}`, async () => {
    const candidate = {kind: 'date', value, quote: value, subject: '测试王甲', scope: 'individual', meaning: 'payment_date', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated'};
    const [item] = await fixture(`round36-date-${value}`, [{text, exactSource: true, candidates: [candidate]}]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1); assert(!material.candidates[0].reviewIssues.some(issue => issue.code === 'source_relation_unresolved'));
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert(!rawAndLocations(item, read.body).candidates[0].reviewIssues.some(issue => issue.code === 'source_relation_unresolved')); assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({name: `round36-date-${value}`, item, state: before});
    return {sourceRelationSupported: true, paymentNotReceiptProof: true, rawAndStoredHistoryUnchanged: true};
  });
  for (const [subject, noun, scope] of [['测试王甲', '经济补偿金', 'individual'], ['测试王甲', '赔偿金', 'individual'], ['甲公司', '材料款', 'organization']]) await scenario(`round36_other_money_${noun}`, async () => {
    const [item] = await fixture(`round36-other-${noun}`, [{text: `${subject}收到${noun}4000元。`, exactSource: true, candidates: [money('4000元', '4000元', {subject, scope, meaning: 'other_money', completeness: 'not_applicable', period: null})]}]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1); assert.equal(material.candidates[0].amount, '4000.00'); assert.equal(material.candidates[0].representation.meaning, 'other_money'); assert(!material.candidates[0].reviewIssues.some(issue => issue.code === 'source_relation_unresolved'));
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert(!rawAndLocations(item, read.body).candidates[0].reviewIssues.some(issue => issue.code === 'source_relation_unresolved')); assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({name: `round36-other-${noun}`, item, state: before});
    return {amount: '4000.00', role: 'other_money', sourceRelationSupported: true, rawAndStoredHistoryUnchanged: true};
  });
  // End ROUND36 companion additions.
  for (const [name, tail, rate] of [['unfinished-month-layout', '每\n个月', false], ['unknown-month-rate', '每个月？', true]]) await scenario(`round36_safety_${name}`, async () => {
    const attributes = rate ? {meaning: 'rate', completeness: 'not_applicable', period: null, rateUnit: 'month'} : {period: null};
    const [item] = await fixture(`round36-safety-${name}`, [{text: `测试王甲工资4000元${tail}。`, exactSource: true, candidates: [money('4000元', '4000元', attributes)]}]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1); assert.equal(material.candidates[0].amount, null); assert.notEqual(material.candidates[0].normalization.status, 'exact');
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert.equal(rawAndLocations(item, read.body).candidates[0].amount, null); assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({name: `round36-safety-${name}`, item, state: before});
    return {amount: null, rawAndStoredHistoryUnchanged: true};
  });
  // ROUND37: review candidates remain intact while ambiguous owners and
  // arithmetic operands are excluded from usable totals on fresh and old reads.
  for (const subject of ['王和欧', '王与南', '王及区', '王跟欧', '王暨欧', '王或欧', '王同欧', '王&欧', '王／欧', '王甲']) await scenario(`round37_ambiguous_owner_${subject}`, async () => {
    const ambiguous = subject !== '王甲';
    const text = `${subject}2026年1月全部应付工资合计4000元。`;
    const [item] = await fixture(`round37-owner-${subject}`, [{text, exactSource: true, candidates: [money('4000元', '4000元', {subject})]}]);
    const extracted = await extract(item), material = rawAndLocations(item, extracted);
    assert.equal(material.candidates.length, 1); assert.equal(material.candidates[0].amount, '4000.00');
    assert.equal(material.candidates[0].reviewIssues.some(issue => issue.code === 'source_relation_unresolved'), ambiguous);
    const legacy = stored(item.caseId); legacy.state.materials[0].candidates[0].reviewIssues = [];
    db.prepare('UPDATE case_material_facts SET state_json=? WHERE case_id=? AND user_id=?').run(JSON.stringify(legacy.state), item.caseId, owner);
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert.equal(rawAndLocations(item, read.body).candidates[0].reviewIssues.some(issue => issue.code === 'source_relation_unresolved'), ambiguous);
    assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    // A synthetic human scope confirmation alone cannot authorize ambiguous
    // model totals. An unambiguous worker is the positive control for this gate.
    const scoped = await request(item.path, 'POST', {action: 'confirm_scope', revision: read.body.revision, generation: read.body.generation,
      scope: {worker: subject, employer: '合成测试单位', start: '2026-01-01', end: '2026-01-31'}, note: '仅用于软件测试的模拟人工范围核对，不是业务验收。', verified: true});
    assert.equal(scoped.status, 200); assert.deepEqual(scoped.body.fields.due.values, ambiguous ? [] : ['4000.00']);
    assert.equal(scoped.body.canCalculate, false); assert.deepEqual(scoped.body.state.confirmations, {due: null, paid: null});
    assert.equal(rawAndLocations(item, scoped.body).raw, material.raw);
    const revoked = await request(item.path, 'POST', {action: 'revoke', field: 'scope', revision: scoped.body.revision, generation: scoped.body.generation});
    assert.equal(revoked.status, 200); unconfirmed(revoked.body);
    durableSnapshots.push({name: `round37-owner-${subject}`, item, state: stored(item.caseId)});
    return {amount: '4000.00', ambiguousSubjectNotUsable: ambiguous, confirmedScopeSuggestedAmounts: scoped.body.fields.due.values,
      historicalCleanCandidateRechecked: true, rawAndStoredHistoryUnchangedOnRead: true};
  });
  for (const suffix of ['翻倍', '加倍']) for (const shape of ['full', 'cropped', 'layout']) await scenario(`round37_arithmetic_${suffix}_${shape}`, async () => {
    const value = shape === 'full' ? `4000元${suffix}` : '4000元';
    const text = `测试王甲工资4000元${shape === 'layout' ? '\n' : ''}${suffix}。`;
    const [item] = await fixture(`round37-arithmetic-${suffix}-${shape}`, [{text, exactSource: true, candidates: [money(value, value, {period: null})]}]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1);
    assert.equal(material.candidates[0].amount, null); assert.notEqual(material.candidates[0].normalization.status, 'exact');
    const legacy = stored(item.caseId), old = legacy.state.materials[0].candidates[0]; old.amount = '4000.00';
    old.normalization = {rawValue: old.value, amount: old.amount, status: 'exact', matchedText: '4000元', span: {start: 0, end: 5}, reason: 'Synthetic historical ROUND37 lexical operand'};
    db.prepare('UPDATE case_material_facts SET state_json=? WHERE case_id=? AND user_id=?').run(JSON.stringify(legacy.state), item.caseId, owner);
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert.equal(rawAndLocations(item, read.body).candidates[0].amount, null);
    assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({name: `round37-arithmetic-${suffix}-${shape}`, item, state: before});
    return {amount: null, historicalExactDowngraded: true, rawAndStoredHistoryUnchanged: true};
  });
  for (const glyph of ['辞职', '辭職']) await scenario(`round37_employment_date_${glyph}`, async () => {
    const value = '2026年1月', text = `测试王甲於${value}${glyph}。`;
    const candidate = {kind: 'date', value, quote: value, subject: '测试王甲', scope: 'individual', meaning: 'employment_period', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated'};
    const [item] = await fixture(`round37-date-${glyph}`, [{text, exactSource: true, candidates: [candidate]}]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1);
    assert(!material.candidates[0].reviewIssues.some(issue => issue.code === 'source_relation_unresolved'));
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert(!rawAndLocations(item, read.body).candidates[0].reviewIssues.some(issue => issue.code === 'source_relation_unresolved'));
    assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({name: `round37-date-${glyph}`, item, state: before});
    return {sourceRelationSupported: true, rawAndStoredHistoryUnchanged: true};
  });
  // ROUND38: preserve raw observations while guarding new finite spellings.
  for (const [expression, clipped] of [
    ['高达4000元', '4000元'], ['高達4000元', '4000元'], ['低至4000元', '4000元'],
    ['4000元翻一倍', '4000元'], ['￥4000￥', '￥4000'], ['人民币4000￥', '人民币4000'], ['4000元￥', '4000元'],
  ]) for (const full of [true, false]) await scenario(`round38_money_${expression}_${full}`, async () => {
    const value = full ? expression : clipped;
    const [item] = await fixture(`round38-money-${expression}-${full}`, [{text: `测试王甲2026年1月全部应付工资合计${expression}。`, exactSource: true, candidates: [money(value, value)]}]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1);
    assert.equal(material.candidates[0].amount, null); assert.notEqual(material.candidates[0].normalization.status, 'exact');
    const legacy = stored(item.caseId), old = legacy.state.materials[0].candidates[0]; old.amount = '4000.00';
    old.normalization = {rawValue: old.value, amount: old.amount, status: 'exact', matchedText: old.value, span: {start: 0, end: Array.from(old.value).length}, reason: 'Synthetic historical ROUND38 invalid exact value'};
    db.prepare('UPDATE case_material_facts SET state_json=? WHERE case_id=? AND user_id=?').run(JSON.stringify(legacy.state), item.caseId, owner);
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert.equal(rawAndLocations(item, read.body).candidates[0].amount, null); assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({name: `round38-money-${expression}-${full}`, item, state: before});
    return {amount: null, historicalExactDowngraded: true, rawAndStoredHistoryUnchanged: true};
  });
  for (const verb of ['发薪', '發薪']) await scenario(`round38_recurring_${verb}`, async () => {
    const value = '每月15日', text = `测试王甲工资${value}${verb}。`;
    const candidate = {kind: 'date', value, quote: value, subject: '测试王甲', scope: 'individual', meaning: 'payment_date', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated'};
    const [item] = await fixture(`round38-date-${verb}`, [{text, exactSource: true, candidates: [candidate]}]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1); assert(!material.candidates[0].reviewIssues.some(issue => issue.code === 'source_relation_unresolved'));
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert(!rawAndLocations(item, read.body).candidates[0].reviewIssues.some(issue => issue.code === 'source_relation_unresolved')); assert.deepEqual(stored(item.caseId), before);
    durableSnapshots.push({name: `round38-date-${verb}`, item, state: before}); return {sourceRelationSupported: true, paymentNotReceiptProof: true, rawUnchanged: true};
  });
  for (const reverse of [false, true]) await scenario(`round38_prefix_nested_same_event_${reverse}`, async () => {
    const text = '测试王甲2026年1月全部应付工资4000元。';
    const candidates = ['工资4000元', '4000元'].map(value => money(value, text)); if (reverse) candidates.reverse();
    const [item] = await fixture(`round38-prefix-${reverse}`, [{text, exactSource: true, candidates}]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1); assert.equal(material.rejected.length, 1); assert.equal(JSON.parse(material.raw).candidates.length, 2);
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body); assert.equal(rawAndLocations(item, read.body).candidates.length, 1); assert.deepEqual(stored(item.caseId), before);
    durableSnapshots.push({name: `round38-prefix-${reverse}`, item, state: before}); return {accepted: 1, rejectedDuplicate: 1, rawCandidates: 2, rawAndStoredHistoryUnchanged: true};
  });
  await scenario('round38_prefix_two_same_amount_events_stay_distinct', async () => {
    const quotes = ['测试王甲第一笔工资4000元', '测试王甲第二笔工资4000元'];
    const [item] = await fixture('round38-prefix-two-events', [{text: quotes.join('。') + '。', exactSource: true, candidates: quotes.map(quote => money('工资4000元', quote, {period: null, meaning: 'payment', completeness: 'unknown'}))}]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 2); assert.equal(material.rejected.length, 0); assert.notEqual(material.candidates[0].start, material.candidates[1].start);
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body); assert.equal(rawAndLocations(item, read.body).candidates.length, 2); assert.deepEqual(stored(item.caseId), before);
    durableSnapshots.push({name: 'round38-prefix-two-events', item, state: before}); return {accepted: 2, separateOccurrences: true, rawAndStoredHistoryUnchanged: true};
  });
  // ROUND39: calendar labels, halving operands and plural owners cannot supply personal money.
  for (const subject of ['王氏兄弟', '双方', '王甲']) await scenario(`round39_plural_owner_${subject}`, async () => {
    const ambiguous = subject !== '王甲';
    const text = `${subject}2026年1月全部应付工资合计4000元。`;
    const [item] = await fixture(`round39-owner-${subject}`, [{text, exactSource: true, candidates: [money('4000元', '4000元', {subject})]}]);
    const extracted = await extract(item), material = rawAndLocations(item, extracted);
    assert.equal(material.candidates.length, 1); assert.equal(material.candidates[0].amount, '4000.00');
    assert.equal(material.candidates[0].reviewIssues.some(issue => issue.code === 'source_relation_unresolved'), ambiguous);
    const legacy = stored(item.caseId); legacy.state.materials[0].candidates[0].reviewIssues = [];
    db.prepare('UPDATE case_material_facts SET state_json=? WHERE case_id=? AND user_id=?').run(JSON.stringify(legacy.state), item.caseId, owner);
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert.equal(rawAndLocations(item, read.body).candidates[0].reviewIssues.some(issue => issue.code === 'source_relation_unresolved'), ambiguous);
    assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    // A synthetic human scope confirmation alone cannot authorize ambiguous
    // model totals. An unambiguous worker is the positive control for this gate.
    const scoped = await request(item.path, 'POST', {action: 'confirm_scope', revision: read.body.revision, generation: read.body.generation,
      scope: {worker: subject, employer: '合成测试单位', start: '2026-01-01', end: '2026-01-31'}, note: '仅用于软件测试的模拟人工范围核对，不是业务验收。', verified: true});
    assert.equal(scoped.status, 200); assert.deepEqual(scoped.body.fields.due.values, ambiguous ? [] : ['4000.00']);
    assert.equal(scoped.body.canCalculate, false); assert.deepEqual(scoped.body.state.confirmations, {due: null, paid: null});
    assert.equal(rawAndLocations(item, scoped.body).raw, material.raw);
    const revoked = await request(item.path, 'POST', {action: 'revoke', field: 'scope', revision: scoped.body.revision, generation: scoped.body.generation});
    assert.equal(revoked.status, 200); unconfirmed(revoked.body);
    durableSnapshots.push({name: `round39-owner-${subject}`, item, state: stored(item.caseId)});
    return {amount: '4000.00', ambiguousSubjectNotUsable: ambiguous, confirmedScopeSuggestedAmounts: scoped.body.fields.due.values,
      historicalCleanCandidateRechecked: true, rawAndStoredHistoryUnchangedOnRead: true};
  });
  for (const [expression, clipped] of [
    ['4000元减半', '4000元'], ['4000元減半', '4000元'], ['4000元折半', '4000元'],
  ]) for (const full of [true, false]) await scenario(`round39_money_${expression}_${full}`, async () => {
    const value = full ? expression : clipped;
    const [item] = await fixture(`round39-money-${expression}-${full}`, [{text: `测试王甲2026年1月全部应付工资合计${expression}。`, exactSource: true, candidates: [money(value, value)]}]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1);
    assert.equal(material.candidates[0].amount, null); assert.notEqual(material.candidates[0].normalization.status, 'exact');
    const legacy = stored(item.caseId), old = legacy.state.materials[0].candidates[0]; old.amount = '4000.00';
    old.normalization = {rawValue: old.value, amount: old.amount, status: 'exact', matchedText: old.value, span: {start: 0, end: Array.from(old.value).length}, reason: 'Synthetic historical ROUND39 invalid exact value'};
    db.prepare('UPDATE case_material_facts SET state_json=? WHERE case_id=? AND user_id=?').run(JSON.stringify(legacy.state), item.caseId, owner);
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert.equal(rawAndLocations(item, read.body).candidates[0].amount, null); assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({name: `round39-money-${expression}-${full}`, item, state: before});
    return {amount: null, historicalExactDowngraded: true, rawAndStoredHistoryUnchanged: true};
  });
  for (const verb of ['到账', '入账', '到帳', '入賬']) await scenario(`round39_recurring_${verb}`, async () => {
    const value = '2026年1月15日', text = `测试王甲工资于${value}${verb}。`;
    const candidate = {kind: 'date', value, quote: value, subject: '测试王甲', scope: 'individual', meaning: 'payment_date', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated'};
    const [item] = await fixture(`round39-date-${verb}`, [{text, exactSource: true, candidates: [candidate]}]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1); assert(!material.candidates[0].reviewIssues.some(issue => issue.code === 'source_relation_unresolved'));
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert(!rawAndLocations(item, read.body).candidates[0].reviewIssues.some(issue => issue.code === 'source_relation_unresolved')); assert.deepEqual(stored(item.caseId), before);
    durableSnapshots.push({name: `round39-date-${verb}`, item, state: before}); return {sourceRelationSupported: true, dateDoesNotConfirmAmount: true, rawUnchanged: true};
  });
  for (const currency of ['人民币', 'RMB']) for (const full of [true, false]) await scenario(`round39_calendar_currency_${currency}_${full}`, async () => {
    const expression = `币种：${currency} 2026年1月工资`, value = full ? expression : `${currency} 2026`;
    const [item] = await fixture(`round39-calendar-${currency}-${full}`, [{text: `测试王甲记载：${expression}。`, exactSource: true, candidates: [money(value, value, {meaning: 'other_money', completeness: 'not_applicable', period: null})]}]);
    const material = rawAndLocations(item, await extract(item));
    assert.equal(material.candidates.length, full ? 0 : 1); assert.equal(material.rejected.length, full ? 1 : 0);
    if (!full) {
      assert.equal(material.candidates[0].amount, null);
      const legacy = stored(item.caseId), old = legacy.state.materials[0].candidates[0]; old.amount = '2026.00';
      old.normalization = {rawValue: old.value, amount: old.amount, status: 'exact', matchedText: old.value, span: {start: 0, end: Array.from(old.value).length}, reason: 'Synthetic old calendar year mistaken for yuan'};
      db.prepare('UPDATE case_material_facts SET state_json=? WHERE case_id=? AND user_id=?').run(JSON.stringify(legacy.state), item.caseId, owner);
    }
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    const seen = rawAndLocations(item, read.body); assert.equal(seen.candidates.length, full ? 0 : 1);
    if (!full) assert.equal(seen.candidates[0].amount, null);
    assert.equal(seen.raw, material.raw); assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({name: `round39-calendar-${currency}-${full}`, item, state: before});
    return {rejectedEmptyLabel: full, preciseYearAmount: null, rawAndStoredHistoryUnchanged: true};
  });
  // End ROUND39 additions.
  // ROUND40: bounded qualifiers, operands and accounting signs stay unavailable.
  for (const expression of ['4000元为上限', '4000元的双倍', '(4000元)', '（4000元）']) for (const full of [true, false]) await scenario(`round40_unavailable_${expression}_${full}`, async () => {
    const value = full ? expression : '4000元';
    const [item] = await fixture(`round40-unavailable-${expression}-${full}`, [{text: `测试王甲2026年1月全部应付工资合计${expression}。`, exactSource: true, candidates: [money(value, value)]}]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1); assert.equal(material.candidates[0].amount, null);
    const legacy = stored(item.caseId), old = legacy.state.materials[0].candidates[0]; old.amount = '4000.00';
    old.normalization = {rawValue: old.value, amount: old.amount, status: 'exact', matchedText: old.value, span: {start: 0, end: Array.from(old.value).length}, reason: 'Synthetic ROUND40 old exact observation'};
    db.prepare('UPDATE case_material_facts SET state_json=? WHERE case_id=? AND user_id=?').run(JSON.stringify(legacy.state), item.caseId, owner);
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body);
    assert.equal(rawAndLocations(item, read.body).candidates[0].amount, null); assert.deepEqual(stored(item.caseId), before); assert.deepEqual(read.body.state.history, before.state.history);
    durableSnapshots.push({name: `round40-unavailable-${expression}-${full}`, item, state: before});
    return {amount: null, historicalExactDowngraded: true, rawAndStoredHistoryUnchanged: true};
  });
  for (const suffix of ['每个小时', '/个小时', '每个小时待定']) await scenario(`round40_hour_${suffix}`, async () => {
    const amount = suffix.endsWith('待定') ? null : '4000.00';
    const [item] = await fixture(`round40-hour-${suffix}`, [{text: `测试王甲工资4000元${suffix}。`, exactSource: true, candidates: [money('4000元', '4000元', {meaning: 'rate', completeness: 'not_applicable', period: null, rateUnit: 'hour'})]}]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates[0].amount, amount); assert.equal(material.candidates[0].representation.rateUnit, 'hour');
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body); assert.equal(rawAndLocations(item, read.body).candidates[0].amount, amount); assert.deepEqual(stored(item.caseId), before);
    durableSnapshots.push({name: `round40-hour-${suffix}`, item, state: before}); return {amount, hourlyClassifierPreserved: true, uncertaintyPreserved: true};
  });
  for (const currency of ['RMB', 'CNY']) await scenario(`round40_qualified_${currency}`, async () => {
    const value = `${currency}约4000元`;
    const [item] = await fixture(`round40-qualified-${currency}`, [{text: `测试王甲2026年1月全部应付工资合计${value}。`, exactSource: true, candidates: [money(value, value)]}]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates[0].amount, null); assert.equal(material.candidates[0].normalization.status, 'approximate');
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body); assert.equal(rawAndLocations(item, read.body).candidates[0].amount, null); assert.deepEqual(stored(item.caseId), before);
    durableSnapshots.push({name: `round40-qualified-${currency}`, item, state: before}); return {amount: null, qualifierAndRawPreserved: true};
  });
  for (const [verb, meaning, field, value, amount] of [['应发', 'due_total', 'due', '4000元', '4000.00'], ['实发', 'paid_total', 'paid', '3500元', '3500.00']]) await scenario(`round40_total_${verb}`, async () => {
    const [item] = await fixture(`round40-total-${verb}`, [{text: `测试王甲2026年1月${verb}工资合计${value}。`, exactSource: true, candidates: [money(value, value, {meaning})]}]);
    const material = rawAndLocations(item, await extract(item)); assert(!material.candidates[0].reviewIssues.some(issue => issue.code === 'source_relation_unresolved'));
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body); assert.deepEqual(stored(item.caseId), before);
    const scoped = await request(item.path, 'POST', {action: 'confirm_scope', revision: read.body.revision, generation: read.body.generation,
      scope: {worker: '测试王甲', employer: '合成测试单位', start: '2026-01-01', end: '2026-01-31'}, note: '合成程序测试的范围核对，不是人工业务验收。', verified: true});
    assert.equal(scoped.status, 200); assert.deepEqual(scoped.body.fields[field].values, [amount]); assert.equal(scoped.body.canCalculate, false); assert.deepEqual(scoped.body.state.confirmations, {due: null, paid: null}); assert.equal(rawAndLocations(item, scoped.body).raw, material.raw);
    const revoked = await request(item.path, 'POST', {action: 'revoke', field: 'scope', revision: scoped.body.revision, generation: scoped.body.generation}); assert.equal(revoked.status, 200); unconfirmed(revoked.body);
    durableSnapshots.push({name: `round40-total-${verb}`, item, state: stored(item.caseId)}); return {amount, scopedSuggestion: [amount], calculationStillUnconfirmed: true};
  });
  for (const [value, text, meaning] of [['1月15日', '测试王甲工资于1月15日支付。', 'payment_date'], ['2026年1月与2月', '测试王甲2026年1月与2月工资所属期间。', 'wage_period']]) await scenario(`round40_date_${meaning}`, async () => {
    const candidate = {kind: 'date', value, quote: value, subject: '测试王甲', scope: 'individual', meaning, completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated'};
    const [item] = await fixture(`round40-date-${meaning}`, [{text, exactSource: true, candidates: [candidate]}]);
    const material = rawAndLocations(item, await extract(item)); assert.equal(material.candidates.length, 1); assert(!material.candidates[0].reviewIssues.some(issue => issue.code === 'source_relation_unresolved')); assert.equal(material.candidates[0].value, value);
    const before = stored(item.caseId), read = await request(item.path); assert.equal(read.status, 200); unconfirmed(read.body); assert(!rawAndLocations(item, read.body).candidates[0].reviewIssues.some(issue => issue.code === 'source_relation_unresolved')); assert.deepEqual(stored(item.caseId), before);
    durableSnapshots.push({name: `round40-date-${meaning}`, item, state: before}); return {sourceRelationSupported: true, noInventedYear: true, dateDoesNotConfirmAmount: true};
  });
  // End ROUND40 additions.
  await scenario('malformed_raw_failure_does_not_rewrite_other_material_or_prior_audit', async () => {
    const quote = '测试王甲2026年1月完整应付工资四万元';
    const [first, bad] = await fixture('raw-failure-history', [
      { text: `${quote}。`, candidates: [money('四万元', quote)] },
      { text: '测试王甲2026年1月工资材料待核。', raw: '{"schemaVersion":3,"candidates":[合成不完整JSON' },
    ]);
    const before = await extract(first); const materialBefore = rawAndLocations(first, before); const historyBefore = structuredClone(before.state.history);
    const response = await extract(bad); assert.equal(response.state.job.status, 'failed');
    const injected = outputs.findLast(result => result.evidenceId === bad.evidenceId); assert.equal(response.state.job.raw, injected.raw);
    assert.deepEqual(response.state.materials.find(material => material.evidenceId === first.evidenceId), materialBefore);
    assert.deepEqual(response.state.history.slice(0, historyBefore.length), historyBefore);
    assert.equal(response.state.history.filter(item => item.type === 'candidates_extracted').length, 1);
    assert.equal(stored(bad.caseId).state.job.raw, injected.raw);
    durableSnapshots.push({ name: 'malformed-raw', item: bad, state: stored(bad.caseId) });
    return { failedRawPreserved: true, previousSuccessfulMaterialPreserved: true, previousAuditPrefixPreserved: true };
  });
  for (const spec of [
    { name: 'empty-raw', raw: '' },
    { name: 'unfinished-raw', raw: envelope([]), finish_reason: 'length' },
  ]) await scenario(`${spec.name}_is_failed_with_exact_raw_retained`, async () => {
    const [item] = await fixture(spec.name, [{ text: '测试王甲2026年1月工资描述没有明确金额。', ...spec }]);
    const response = await extract(item); assert.equal(response.state.job.status, 'failed');
    assert(Object.hasOwn(response.state.job, 'raw')); assert.equal(response.state.job.raw, spec.raw);
    assert.equal(response.state.materials.length, 0); assert.equal(response.state.history.filter(item => item.type === 'candidates_extracted').length, 0);
    durableSnapshots.push({ name: spec.name, item, state: stored(item.caseId) });
    return { failed: true, raw: response.state.job.raw, finishReason: spec.finish_reason || 'stop', acceptedCandidates: 0 };
  });
  await scenario('valid_empty_candidates_retains_raw_and_coverage_without_zero', async () => {
    const [item] = await fixture('empty-candidates', [{ text: '测试王甲2026年1月工资描述没有明确金额。', candidates: [] }]);
    const response = await extract(item); assert.equal(response.state.job, null);
    const material = rawAndLocations(item, response); assert.deepEqual(material.candidates, []); assert.deepEqual(material.rejected, []);
    assert.equal(material.coverage.status, 'empty'); assert.equal(material.raw, envelope([]));
    durableSnapshots.push({ name: 'empty-candidates', item, state: stored(item.caseId) });
    return { accepted: 0, raw: material.raw, coverage: material.coverage.status, zeroCreated: false };
  });
  await scenario('worker_restart_preserves_all_success_failure_empty_raw_and_audit_snapshots', async () => {
    assert(durableSnapshots.length >= 10, 'Restart must cover the successful, guard, failed and empty cases.');
    try { await stopChild(worker, 'Worker'); }
    catch (error) { cleanupFailures.push({ operation: 'stop_worker', ...errorRecord(error) }); throw error; }
    worker = undefined; await startWorker();
    for (const snapshot of durableSnapshots) {
      const response = await request(snapshot.item.path); assert.equal(response.status, 200); unconfirmed(response.body);
      assert.deepEqual(stored(snapshot.item.caseId), snapshot.state, `${snapshot.name} persisted state must not be migrated or rewritten by reread.`);
      assert.deepEqual(response.body.state.history, snapshot.state.state.history);
      assert.equal(response.body.state.job?.raw, snapshot.state.state.job?.raw);
      assert.deepEqual(response.body.state.materials.map(material => material.raw), snapshot.state.state.materials.map(material => material.raw));
    }
    assert(calls.length > 0); assert(calls.every(call => call.authenticated));
    return { checkedCases: durableSnapshots.length, storedRawAndHistoryUnchanged: true, privateServiceAuthentication: true };
  });
} catch (error) { failure ??= { phase, ...errorRecord(error) }; }
finally {
  await cleanup('stop_worker', () => stopChild(worker, 'Worker'));
  await cleanup('stop_migration', () => stopChild(migrationChild, 'Migration'));
  await cleanup('close_database', () => db?.close());
  await cleanup('close_proxy', async () => { if (proxy) { proxy.closeAllConnections(); await bounded(new Promise(resolve => proxy.close(resolve)), 5000, 'Synthetic result proxy did not close.'); } });
  await cleanup('close_material_service', async () => { await service?.close(); });
  await cleanup('remove_temporary_resources', async () => {
    if (temp && cleanupFailures.some(item => ['stop_worker', 'stop_migration'].includes(item.operation))) {
      cleanupFailures.push({ operation: 'retain_temporary_resources', name: 'CleanupIncomplete', message: 'Private temporary resources retained because owned process cleanup failed.', path: temp });
      return;
    }
    if (temp) await rm(temp, { recursive: true, force: true });
  });
  if (observations.some(item => item.status !== 'PASS')) failure ??= { phase: 'acceptance', message: 'One or more synthetic HTTP scenarios failed; original observations and raw outputs are retained.' };
  if (cleanupFailures.length) failure ??= { phase: 'cleanup', message: 'Temporary regression resources did not fully clean up.' };
  const report = () => Buffer.from(JSON.stringify({ status: failure || interruption ? 'FAIL' : 'PASS', mode: 'material-facts-v7-http', runId,
    boundary: 'production Worker HTTP + disposable on-disk D1/R2 + real TXT material service and rules queue + explicitly injected synthetic fact outputs; no real-model or business acceptance',
    actualModelInference: false, syntheticInputs: true, holdoutRead: false, historicalReportsOverwritten: false, buildRoot: root, recordedAt: new Date().toISOString(),
    observations, failure: failure ?? interruption ?? null, interruption: interruption ?? null, syntheticOutputs: outputs, serviceCalls: calls, retiredServiceJobs,
    cleanup: { status: cleanupFailures.length ? 'FAIL' : 'PASS', failures: cleanupFailures },
  }, null, 2) + '\n');
  try {
    const interruptedBeforeWrite = shutdown.signal.aborted;
    await reportFile.writeFile(report());
    if (!interruptedBeforeWrite && shutdown.signal.aborted) {
      const updated = report();
      for (let offset = 0; offset < updated.length;) {
        const { bytesWritten } = await reportFile.write(updated, offset, updated.length - offset, offset);
        assert(bytesWritten > 0, 'Interrupted report publication made no progress.'); offset += bytesWritten;
      }
      await reportFile.truncate(updated.length);
    }
  }
  finally { await reportFile.close(); }
}
console.log(JSON.stringify({ status: failure || interruption ? 'FAIL' : 'PASS', mode: 'material-facts-v7-http', checks: observations.length, output }));
if (failure || interruption) process.exitCode = 1;
