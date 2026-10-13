import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';

const [base, output, mode = 'text', ...options] = process.argv.slice(2);
if (!base || !output || !['text', 'images'].includes(mode) || options.some((option) => !['--service-restart', '--punctuation-equivalence'].includes(option))) throw new Error('Usage: node scripts/material-http-regression.mjs BASE OUTPUT [text|images] [--service-restart] [--punctuation-equivalence]');
const restartCoverage = options.includes('--service-restart');
if (restartCoverage && typeof process.send !== 'function') throw new Error('Service restart coverage requires the isolated runner IPC channel.');
const punctuationEquivalence = options.includes('--punctuation-equivalence');
const semanticComparison = punctuationEquivalence ? 'punctuation-equivalence' : 'exact';
// Compare fixture facts only. Never normalize result blocks, quotes, extracted
// values or source bytes; all of their grounding assertions below stay exact.
const punctuationMap = { '，': ',', '？': '?', '：': ':', '；': ';', '。': '.', '！': '!' };
const comparableFact = (value) => punctuationEquivalence ? value.replace(/[，？：；。！]/gu, (character) => punctuationMap[character]) : value;
const sameFact = (actual, expected) => comparableFact(actual) === comparableFact(expected);
const observations = [];
let failureContext;
const headers = (user = 'a') => ({ 'oai-authenticated-user-id': `material-http-${user}`, 'oai-authenticated-user-email': `${user}@synthetic.test` });
const request = async (path, method = 'GET', body, user = 'a') => fetch(`${base}${path}`, { method, headers: headers(user), body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
const observe = (name, detail = {}) => observations.push({ name, ...detail, status: 'PASS' });
const created = [];
async function readyAnalysis(id) {
  let analysis;
  for (let attempt = 0; attempt < 150; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const response = await request(`/api/evidence/${id}/analysis`); assert.equal(response.status, 200);
    analysis = (await response.json()).analysis;
    if (analysis.status !== 'running') break;
  }
  assert.equal(analysis.status, 'ready', analysis.error);
  return analysis;
}
async function originalPreserved(id, bytes) {
  const downloaded = await request(`/api/evidence/${id}/download`); assert.equal(downloaded.status, 200);
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), bytes, 'Original file must remain byte-for-byte unchanged.');
}
function assertKnownResult(result, name, documentKind, expected, bytes) {
  assert.equal(result.source.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert(result.blocks.some((block) => block.text.includes(expected)), `${name}: expected known synthetic text ${expected}`);
  assert(result.fields.length > 0, `${name}: grounded fields missing`);
  for (const field of result.fields) {
    assert(result.blocks.filter((b) => field.blockIds.includes(b.id)).map((b) => b.text).join('\n').includes(field.quote));
    assert(field.quote.includes(field.extractedValue));
    assert.equal(field.value, field.extractedValue, `${name}: initial field value must preserve raw extraction`);
  }
  // All words, dates and amounts must match. The explicit optional mapping can
  // accept fullwidth/ASCII punctuation only, without altering any raw result.
  const expectedFields = documentKind === 'contract'
    ? { employer: '合成星海科技有限公司', worker: '张小合', job: '设备维护员', employment_start: '2026年01月05日', wage_standard: '8000元' }
    : documentKind === 'wage_statement'
      ? { employer: '合成星海科技有限公司', worker: '张小合', payment_date: '2026年02月10日', payment_amount: '6500元' }
      : { management_statement: '安排你明天上午到工厂上班，请按时打卡。' };
  for (const [key, value] of Object.entries(expectedFields)) assert(result.fields.some((f) => f.key === key && sameFact(f.value, value)), `${name}: missing expected ${key}=${value}`);
  const allowedKeys = documentKind === 'chat' ? ['worker', 'management_statement', 'arrears_statement'] : Object.keys(expectedFields);
  assert(result.fields.every((f) => allowedKeys.includes(f.key)), `${name}: unsupported field classification`);
  const allowedValues = documentKind === 'chat' ? {
    worker: ['张小合'],
    management_statement: ['安排你明天上午到工厂上班，请按时打卡。'],
    arrears_statement: ['2月份工资还没发，请问什么时候支付？', '2月份工资还没发', '公司拖欠2月份工资，会尽快支付。', '公司拖欠2月份工资'],
  } : Object.fromEntries(Object.entries(expectedFields).map(([key, value]) => [key, [value]]));
  assert(result.fields.every((f) => allowedValues[f.key]?.some((value) => sameFact(f.value, value))), `${name}: field value does not match the known synthetic fact category`);
  assert(result.fields.every((f) => !/合成测试材料|仅用于软件|不具有法律效力|不是银行流水/.test(f.value)), `${name}: document metadata misclassified as fact`);
  if (documentKind === 'chat') assert(result.fields.some((f) => f.key === 'arrears_statement' && /工资还没发|拖欠2月份工资/.test(f.value)), `${name}: missing wage arrears statement`);
  assert(result.knowledge.hits.some((h) => h.kind === 'case'));
  assert(result.knowledge.hits.some((h) => h.kind === 'provision'));
  assert(result.knowledge.hits.every((h) => h.citations.every((c) => c.text && c.sourceUrl && c.paragraphId)));
}
async function restartService() {
  const requestId = randomUUID();
  await new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); process.removeListener('message', received); process.removeListener('disconnect', disconnected); };
    const received = (message) => {
      if (message?.type !== 'material-service-restarted' || message.requestId !== requestId) return;
      cleanup();
      if (message.ok === true) resolve(); else reject(new Error(message.error || 'Material service restart failed.'));
    };
    const disconnected = () => { cleanup(); reject(new Error('Isolated runner IPC disconnected before service restart.')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Material service restart timed out.')); }, 45_000);
    process.on('message', received); process.once('disconnect', disconnected);
    process.send({ type: 'restart-material-service', requestId }, (error) => { if (error) { cleanup(); reject(error); } });
  });
}
const caseResponse = await request('/api/cases', 'POST', { type: '欠薪争议', company: '合成材料集成测试单位（非真实案件）', amount: 0, description: '自动验证使用合成材料，测试结束清理。' });
assert.equal(caseResponse.status, 201); const { case: workCase } = await caseResponse.json();
try {
  const fixtures = mode === 'images'
    ? [['contract.png', 'image/png', 'contract', '8000'], ['wage-statement.png', 'image/png', 'wage_statement', '6500'], ['chat.png', 'image/png', 'chat', '工资'], ['contract.pdf', 'application/pdf', 'contract', '8000']]
    : [['facts.txt', 'text/plain', 'contract', '8000']];
  for (const [name, mime, documentKind, expected] of fixtures) {
    const bytes = await readFile(new URL(`../fixtures/material-demo/${name}`, import.meta.url));
    const form = new FormData(); form.set('file', new File([bytes], name, { type: mime })); form.set('caseId', workCase.id); form.set('operationId', randomUUID());
    const uploaded = await request('/api/evidence', 'POST', form); assert.equal(uploaded.status, 201);
    const { evidence } = await uploaded.json(); created.push(evidence.id);
    const start = await request(`/api/evidence/${evidence.id}/analysis`, 'POST', { documentKind }); assert.equal(start.status, 202, JSON.stringify(await start.json()));
    const analysis = await readyAnalysis(evidence.id);
    const result = analysis.result;
    failureContext = { fixture: name, analysis };
    assertKnownResult(result, name, documentKind, expected, bytes);
    assert.equal((await request(`/api/evidence/${evidence.id}/analysis`, 'GET', undefined, 'b')).status, 404);
    assert.equal((await request(`/api/evidence/${evidence.id}/analysis`, 'POST', { documentKind }, 'b')).status, 404);
    assert.equal((await request(`/api/evidence/${evidence.id}/analysis`, 'PUT', { revision: analysis.revision, fields: [{ id: result.fields[0].id, value: '跨用户篡改应被拒绝', confirmed: true }] }, 'b')).status, 404);
    assert.equal((await request(`/api/evidence?id=${evidence.id}`, 'DELETE', undefined, 'b')).status, 404);
    assert.equal((await request(`/api/evidence/${evidence.id}/download`, 'GET', undefined, 'b')).status, 404);
    const unchanged = (await (await request(`/api/evidence/${evidence.id}/analysis`)).json()).analysis;
    assert.deepEqual(unchanged, analysis);
    await originalPreserved(evidence.id, bytes);
    observe('upload_extract_retrieve_cite_owner_isolation', { fixture: name, deniedMethods: ['analysis_GET', 'analysis_POST', 'analysis_PUT', 'evidence_DELETE', 'download_GET'], ownerAnalysisUnchanged: true, originalBytesPreserved: true, engine: result.engine, fields: result.fields.map((f) => ({ key: f.key, value: f.value, extractedValue: f.extractedValue, quote: f.quote, blockIds: f.blockIds, origin: f.origin })), semanticFixtureAssertions: 'PASS', semanticComparison, warnings: result.warnings, blockCount: result.blocks.length, publicHitIds: result.knowledge.hits.map((h) => h.id), fingerprint: result.knowledge.fingerprint });
    const edit = { revision: analysis.revision, fields: [{ id: result.fields[0].id, value: result.fields[0].value, confirmed: true }] };
    assert.equal((await request(`/api/evidence/${evidence.id}/analysis`, 'PUT', edit)).status, 200);
    assert.equal((await request(`/api/evidence/${evidence.id}/analysis`, 'PUT', edit)).status, 409);
    const saved = (await (await request(`/api/evidence/${evidence.id}/analysis`)).json()).analysis;
    assert.equal(saved.result.fields[0].review, 'confirmed');
    observe('review_persists_and_stale_revision_rejected', { fixture: name });
    assert.equal((await request(`/api/evidence?id=${evidence.id}`, 'DELETE')).status, 200);
    assert.equal((await request(`/api/evidence/${evidence.id}/analysis`)).status, 404);
    observe('delete_removes_analysis_access', { fixture: name });
    failureContext = undefined;
  }
  if (restartCoverage) {
    const name = 'facts.txt';
    const bytes = await readFile(new URL(`../fixtures/material-demo/${name}`, import.meta.url));
    const form = new FormData(); form.set('file', new File([bytes], name, { type: 'text/plain' })); form.set('caseId', workCase.id); form.set('operationId', randomUUID());
    const uploaded = await request('/api/evidence', 'POST', form); assert.equal(uploaded.status, 201);
    const { evidence } = await uploaded.json(); created.push(evidence.id);
    const start = await request(`/api/evidence/${evidence.id}/analysis`, 'POST', { documentKind: 'contract' }); assert.equal(start.status, 202);
    const initial = (await start.json()).analysis; assert.equal(initial.status, 'running');
    failureContext = { fixture: name, phase: 'service_restart', analysis: initial };
    // Do not poll before restarting: the application still holds the old job ID,
    // even if this small UTF-8 job already finished in the old service cache.
    await restartService();
    const afterRestart = await request(`/api/evidence/${evidence.id}/analysis`); assert.equal(afterRestart.status, 200);
    const failed = (await afterRestart.json()).analysis;
    assert.equal(failed.status, 'failed'); assert.match(failed.error, /任务已失效.*服务重启/);
    assert.equal(failed.result, null); assert.equal(failed.revision, initial.revision);
    await originalPreserved(evidence.id, bytes);
    const withoutRetry = await request(`/api/evidence/${evidence.id}/analysis`, 'POST', { documentKind: 'contract' }); assert.equal(withoutRetry.status, 200);
    assert.deepEqual((await withoutRetry.json()).analysis, failed, 'A failed job must not silently restart without explicit retry.');
    assert.equal((await request(`/api/evidence/${evidence.id}/analysis`, 'POST', { documentKind: 'contract', retry: true }, 'b')).status, 404);
    const retried = await request(`/api/evidence/${evidence.id}/analysis`, 'POST', { documentKind: 'contract', retry: true }); assert.equal(retried.status, 202);
    const newRun = (await retried.json()).analysis;
    assert.equal(newRun.status, 'running'); assert.equal(newRun.revision, failed.revision + 1);
    const recovered = await readyAnalysis(evidence.id);
    failureContext = { fixture: name, phase: 'restart_recovered', analysis: recovered };
    assertKnownResult(recovered.result, name, 'contract', '8000', bytes);
    await originalPreserved(evidence.id, bytes);
    observe('service_restart_old_job_fails_explicit_retry_recovers', { fixture: name, oldStatus: failed.status, recoveredStatus: recovered.status, originalBytesPreserved: true, explicitRetryRequired: true, revision: recovered.revision, semanticFixtureAssertions: 'PASS', semanticComparison });
    const wage = recovered.result.fields.find((field) => field.key === 'wage_standard'); assert(wage);
    const correctedValue = '8500元';
    const corrected = await request(`/api/evidence/${evidence.id}/analysis`, 'PUT', { revision: recovered.revision, fields: [{ id: wage.id, value: correctedValue, confirmed: true }] }); assert.equal(corrected.status, 200);
    const saved = (await (await request(`/api/evidence/${evidence.id}/analysis`)).json()).analysis;
    const savedWage = saved.result.fields.find((field) => field.id === wage.id);
    assert.equal(savedWage.value, correctedValue); assert.equal(savedWage.review, 'corrected'); assert.equal(savedWage.confirmed, true);
    assert.equal(savedWage.extractedValue, wage.extractedValue); assert.equal(savedWage.quote, wage.quote); assert.deepEqual(savedWage.blockIds, wage.blockIds);
    assert.deepEqual(saved.result.blocks, recovered.result.blocks); assert.deepEqual(saved.result.source, recovered.result.source);
    assert(saved.result.knowledge.hits.some((hit) => hit.kind === 'case')); assert(saved.result.knowledge.hits.some((hit) => hit.kind === 'provision'));
    assert(saved.result.knowledge.hits.every((hit) => hit.citations.every((citation) => citation.text && citation.sourceUrl && citation.paragraphId)));
    await originalPreserved(evidence.id, bytes);
    observe('recovered_field_correction_persists_with_raw_source_and_citations', { originalValue: wage.extractedValue, correctedValue, sourcePreserved: true, originalBytesPreserved: true, publicHitIds: saved.result.knowledge.hits.map((hit) => hit.id) });
    assert.equal((await request(`/api/evidence?id=${evidence.id}`, 'DELETE')).status, 200);
    assert.equal((await request(`/api/evidence/${evidence.id}/analysis`)).status, 404);
    assert.equal((await request(`/api/evidence/${evidence.id}/download`)).status, 404);
    observe('recovered_material_cleanup_removes_analysis_and_original');
    failureContext = undefined;
  }
  const unrelated = await request('/api/knowledge?query=' + encodeURIComponent('番茄炒蛋怎么做')); assert.equal(unrelated.status, 200); assert.equal((await unrelated.json()).hits.length, 0);
  observe('unrelated_query_has_no_fabricated_hit');
  const manual = await request('/api/knowledge?query=' + encodeURIComponent('没签劳动合同但是每天打卡')); assert.equal(manual.status, 200); assert((await manual.json()).hits.length > 0);
  observe('natural_language_labor_query');
  await writeFile(output, JSON.stringify({ status: 'PASS', mode, semanticComparison, serviceRestartCoverage: restartCoverage ? 'PASS' : 'NOT_RUN', syntheticInputs: true, recordedAt: new Date().toISOString(), observations }, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'PASS', checks: observations.length, mode, output }));
} catch (error) {
  await writeFile(output, JSON.stringify({ status: 'FAIL', mode, semanticComparison, serviceRestartCoverage: restartCoverage ? 'REQUESTED' : 'NOT_RUN', syntheticInputs: true, recordedAt: new Date().toISOString(), error: error.message, failureContext, observations }, null, 2) + '\n');
  throw error;
} finally {
  for (const id of created) await request(`/api/evidence?id=${id}`, 'DELETE').catch(() => undefined);
  await request('/api/cases', 'PATCH', { id: workCase.id, status: 'archived' }).catch(() => undefined);
  if (process.connected) process.disconnect();
}
