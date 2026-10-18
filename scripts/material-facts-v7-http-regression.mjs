// Synthetic Issue #42 acceptance through real production Worker HTTP and
// disposable D1/R2. No live URL, model process, credential file or holdout is read.
// Run after npm run build: node scripts/material-facts-v7-http-regression.mjs [REPORT.json]
// ANXIN_MATERIAL_V7_BUILD_ROOT may point to an integrated checkout's local build.
// Each default report is unique; an explicit existing report is never overwritten.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
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
let temp, worker, migrationChild, service, proxy, db, configPath, base, phase = 'setup', failure;
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
    const bytes = Buffer.from(`合成软件测试材料（非真实案件）。😀𠮷 ${spec.text}`, 'utf8');
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
// BEGIN OWNED HTTP CHILD LIFECYCLE
const ownedChildren = new WeakMap();
function spawnOwnedChild(command, args, options) {
  const child = spawn(command, args, { ...options, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  const state = { closed: false };
  state.closedPromise = new Promise(resolve => child.once('close', () => { state.closed = true; resolve(); }));
  ownedChildren.set(child, state);
  // Drain rather than capture Wrangler output: descendants can inherit these
  // pipes, so close also waits for them, without logging private bindings.
  child.stdout?.resume(); child.stderr?.resume();
  child.once('error', () => {}); // Callers retain their own startup error check.
  return child;
}
function signalOwnedChild(child, signal) {
  if (!child) return;
  assert(ownedChildren.has(child), 'Only runner-owned detached children may be signalled.');
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) { if (error.code !== 'ESRCH') throw error; }
}
function ownedGroupAlive(child) {
  if (!child.pid) return false;
  if (process.platform === 'win32') return child.exitCode === null && child.signalCode === null;
  try { process.kill(-child.pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
async function stopChild(child, name) {
  if (!child) return;
  const state = ownedChildren.get(child);
  assert(state, 'Only runner-owned children may be stopped.');
  if (state.closed && !ownedGroupAlive(child)) return;
  // Parent exit is not tree completion: Wrangler may leave workerd alive.
  signalOwnedChild(child, 'SIGTERM');
  try { await bounded(state.closedPromise, 5000, `${name} did not close after SIGTERM.`); }
  catch { signalOwnedChild(child, 'SIGKILL'); await bounded(state.closedPromise, 5000, `${name} did not close after SIGKILL.`); }
  // A descendant may have redirected its pipes. Terminate any remaining owned
  // group before another Worker starts or the disposable state is removed.
  if (ownedGroupAlive(child)) {
    signalOwnedChild(child, 'SIGKILL');
    const deadline = Date.now() + 5000;
    while (ownedGroupAlive(child)) {
      if (Date.now() >= deadline) throw new Error(`${name} process group did not stop.`);
      await wait(20);
    }
  }
}
// END OWNED HTTP CHILD LIFECYCLE
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
const interrupt = () => {
  shutdown.abort(new Error('Synthetic HTTP regression interrupted.'));
  for (const child of [worker, migrationChild]) {
    try { signalOwnedChild(child, 'SIGTERM'); }
    catch (error) { cleanupFailures.push({ operation: 'interrupt_owned_processes', ...errorRecord(error) }); }
  }
};
process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);

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
  try { await bounded(new Promise((resolve, reject) => { migrationChild.once('error', reject); migrationChild.once('exit', code => code === 0 ? resolve() : reject(new Error(`Isolated D1 migrations exited ${code}.`))); }), 60_000, 'Isolated migrations timed out.'); }
  finally { await stopChild(migrationChild, 'Migration'); migrationChild = undefined; }
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
    await stopChild(worker, 'Worker'); worker = undefined; await startWorker();
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
  await cleanup('remove_temporary_resources', async () => { if (temp) await rm(temp, { recursive: true, force: true }); });
  process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
  if (observations.some(item => item.status !== 'PASS')) failure ??= { phase: 'acceptance', message: 'One or more synthetic HTTP scenarios failed; original observations and raw outputs are retained.' };
  if (cleanupFailures.length) failure ??= { phase: 'cleanup', message: 'Temporary regression resources did not fully clean up.' };
  const report = Buffer.from(JSON.stringify({ status: failure ? 'FAIL' : 'PASS', mode: 'material-facts-v7-http', runId,
    boundary: 'production Worker HTTP + disposable on-disk D1/R2 + real TXT material service and rules queue + explicitly injected synthetic fact outputs; no real-model or business acceptance',
    actualModelInference: false, syntheticInputs: true, holdoutRead: false, historicalReportsOverwritten: false, buildRoot: root, recordedAt: new Date().toISOString(),
    observations, failure: failure || null, syntheticOutputs: outputs, serviceCalls: calls, retiredServiceJobs,
    cleanup: { status: cleanupFailures.length ? 'FAIL' : 'PASS', failures: cleanupFailures },
  }, null, 2) + '\n');
  try { await reportFile.writeFile(report); }
  finally { await reportFile.close(); }
}
console.log(JSON.stringify({ status: failure ? 'FAIL' : 'PASS', mode: 'material-facts-v7-http', checks: observations.length, output }));
if (failure) process.exitCode = 1;
