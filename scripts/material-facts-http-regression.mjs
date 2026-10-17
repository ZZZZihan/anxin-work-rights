// Real HTTP + disposable D1/R2 + the real local rules service. Every document
// below is explicitly synthetic; these checks do not score a Qwen/DeepSeek run.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const [base, output] = process.argv.slice(2);
if (!base || !output || process.argv.length !== 4) throw new Error('Usage: node scripts/material-facts-http-regression.mjs BASE OUTPUT');
const target = new URL(base);
if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || target.username || target.password || target.pathname !== '/' || target.search || target.hash) throw new Error('Facts regression must use the isolated loopback HTTP runner.');
const observations = [];
const evidenceIds = new Set();
const analyses = new Map();
let workCase;
let failure;
let phase = 'create_case';
const headers = (user = 'a') => ({ 'oai-authenticated-user-id': `material-facts-http-${user}`, 'oai-authenticated-user-email': `${user}@synthetic.test` });
const request = (path, method = 'GET', body, user = 'a') => fetch(`${base}${path}`, {
  method, headers: headers(user), signal: AbortSignal.timeout(20_000),
  ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
});
const json = async (response, status = 200) => {
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  return body;
};
const observe = (name, detail = {}) => observations.push({ name, status: 'PASS', ...detail });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const scope = { worker: '测试张甲', employer: '合成事实链测试单位', start: '2026-01-01', end: '2026-01-31' };
const note = '仅用于软件回归的合成核实说明：已逐项核对同一劳动者和工资期间，统一税前口径；冲突由测试用户明确选择，未作为模型能力。';
const fixtureOne = '合成软件测试材料（非真实案件，不具有法律效力）。\n劳动者：测试张甲。单位：合成事实链测试单位。工资期间：2026年1月1日至2026年1月31日。\n甲方主张应付工资1000元；另一处记载应付工资1200元。月薪3000元。\n已付金额未知，未提供完整支付信息。';
const fixtureTwo = '合成软件测试补充材料（非真实案件，不具有法律效力）。\n劳动者：测试张甲。单位：合成事实链测试单位。\n本材料记载应付工资1300元。删除标记：仅用于确认删除后派生缓存不留存。';
const factsPath = () => `/api/cases/${encodeURIComponent(workCase.id)}/facts`;
const readFacts = async () => json(await request(factsPath()));
const action = (current, value, user = 'a') => request(factsPath(), 'POST', { revision: current.revision, generation: current.generation, ...value }, user);
const moneyIds = (current) => current.candidates.filter((candidate) => !['worker', 'employer', 'period'].includes(candidate.kind)).map((candidate) => candidate.id);
const confirmAmount = async (current, field, amount, explanation = note) => json(await action(current, { action: 'confirm_amount', field, amount, note: explanation, reviewedCandidateIds: moneyIds(current), complete: true, verified: true }));
const confirmScope = async (current) => json(await action(current, { action: 'confirm_scope', scope, note, verified: true }));

async function upload(text, name) {
  const bytes = Buffer.from(text);
  const form = new FormData();
  form.set('caseId', workCase.id); form.set('operationId', randomUUID());
  form.set('file', new File([bytes], name, { type: 'text/plain' }));
  const { evidence } = await json(await request('/api/evidence', 'POST', form), 201);
  evidenceIds.add(evidence.id);
  return { id: evidence.id, bytes };
}

async function analyze(file) {
  await json(await request(`/api/evidence/${file.id}/analysis`, 'POST', { documentKind: 'other' }), 202);
  let analysis;
  for (let attempt = 0; attempt < 120; attempt++) {
    await wait(250);
    analysis = (await json(await request(`/api/evidence/${file.id}/analysis`))).analysis;
    if (analysis.status !== 'running') break;
  }
  assert.equal(analysis.status, 'ready', analysis.error);
  assert.equal(analysis.result.source.sha256, createHash('sha256').update(file.bytes).digest('hex'));
  assert.equal(analysis.result.blocks.map((block) => block.text).join('\n'), file.bytes.toString());
  analyses.set(file.id, analysis);
  const downloaded = await request(`/api/evidence/${file.id}/download`);
  assert.equal(downloaded.status, 200);
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), file.bytes);
  return analysis;
}

async function extract(current, id) {
  current = await json(await action(current, { action: 'extract', evidenceId: id }), 202);
  for (let attempt = 0; attempt < 120 && current.state.job?.status === 'running'; attempt++) {
    await wait(250);
    current = await readFacts();
  }
  assert.equal(current.state.job, null, JSON.stringify(current.state.job));
  const material = current.state.materials.find((item) => item.evidenceId === id);
  assert.equal(material?.status, 'extracted');
  assert.equal(material.backend, 'rules');
  assert.equal(material.model, null, 'Rules regression must never claim actual model inference.');
  assert.equal(typeof material.raw, 'string');
  assert(Array.isArray(JSON.parse(material.raw).candidates));
  const analysis = analyses.get(id);
  for (const candidate of material.candidates) {
    const block = analysis.result.blocks.find((item) => item.id === candidate.blockId);
    assert(block);
    assert.equal(Array.from(block.text).slice(candidate.start, candidate.end).join(''), candidate.quote);
    assert(candidate.quote.includes(candidate.value));
    assert.equal(candidate.sourceSha256, analysis.result.source.sha256);
  }
  return current;
}

try {
  ({ case: workCase } = await json(await request('/api/cases', 'POST', { company: scope.employer, type: '欠薪争议', amount: 0, description: '合成事实链 HTTP 回归；隔离环境自动清理，非真实案件。' }), 201));
  phase = 'upload_analyze_extract';
  const first = await upload(fixtureOne, 'synthetic-fact-conflict.txt');
  await analyze(first);
  let current = await extract(await readFacts(), first.id);
  assert.equal(current.configured, true);
  assert.equal(current.state.scope, null);
  assert.deepEqual(current.state.confirmations, { due: null, paid: null });
  assert.equal(current.state.calculation, null);
  assert.equal(current.canCalculate, false);
  assert.equal(current.fields.due.status, 'conflict');
  assert.deepEqual(new Set(current.fields.due.values), new Set(['1000.00', '1200.00']));
  assert.equal(current.fields.paid.status, 'unknown');
  observe('real_rules_extract_candidates_raw_unicode_locations_without_confirmation', { candidateCount: current.candidates.length, backend: current.state.materials[0].backend, sourceSha256: current.sources[0].sha256, originalBytesPreserved: true, syntheticInputs: true });

  phase = 'owner_boundaries';
  assert.equal((await fetch(`${base}${factsPath()}`)).status, 401);
  for (const response of [await request(factsPath(), 'GET', undefined, 'b'), await action(current, { action: 'calculate' }, 'b')]) assert.equal(response.status, 404);
  assert.equal((await request(`/api/evidence/${first.id}/analysis`, 'GET', undefined, 'b')).status, 404);
  assert.equal((await action(current, { action: 'confirm_scope', scope, note, verified: true, actor: 'model' })).status, 400);
  assert.deepEqual((await readFacts()).state, current.state);
  observe('facts_owner_isolation_and_client_actor_rejected');

  phase = 'unknown_and_conflict';
  assert.equal((await action(current, { action: 'calculate' })).status, 400);
  current = await confirmScope(current);
  assert.equal(current.state.scopeReview.note, note);
  assert.equal(current.state.scopeReview.actor, 'material-facts-http-a');
  assert.equal((await action(current, { action: 'confirm_amount', field: 'due', amount: '1000', note: '', reviewedCandidateIds: moneyIds(current), complete: true, verified: true })).status, 400);
  current = await confirmAmount(current, 'due', '1000');
  assert.equal(current.state.confirmations.due.note, note);
  assert.equal((await action(current, { action: 'confirm_amount', field: 'paid', amount: '', note, reviewedCandidateIds: moneyIds(current), complete: true, verified: true })).status, 400);
  assert.equal((await action(current, { action: 'calculate' })).status, 400);
  assert.equal((await readFacts()).state.confirmations.paid, null);
  observe('unknown_paid_cannot_become_zero_conflict_requires_user_explanation', { originalDueValues: current.fields.due.values, chosenDue: current.state.confirmations.due.amount, confirmedBy: current.state.confirmations.due.actor });

  phase = 'explicit_zero_and_integer_calculation';
  current = await confirmAmount(current, 'paid', '0');
  current = await json(await action(current, { action: 'calculate' }));
  assert.equal(current.state.calculation.gap, '1000.00');
  assert.equal(current.state.confirmations.paid.cents, 0);
  assert(current.state.calculation.receiptId);
  observe('explicit_zero_authorized_integer_difference', { calculation: current.state.calculation });
  current = await confirmAmount(current, 'due', '0');
  current = await confirmAmount(current, 'paid', '0.01');
  current = await json(await action(current, { action: 'calculate' }));
  assert.equal(current.state.calculation.gap, '-0.01');
  observe('negative_sub_yuan_difference_keeps_exact_cents', { calculation: current.state.calculation });

  phase = 'revision_cas';
  const competing = await Promise.all([action(current, { action: 'revoke', field: 'due' }), action(current, { action: 'revoke', field: 'paid' })]);
  assert.deepEqual(competing.map((response) => response.status).sort(), [200, 409]);
  current = await readFacts();
  assert.equal(current.state.calculation, null);
  current = await confirmAmount(current, 'due', '1000');
  current = await confirmAmount(current, 'paid', '0');
  observe('concurrent_fact_revisions_have_one_winner');

  phase = 'new_source_invalidation';
  const beforeNewSource = current;
  const second = await upload(fixtureTwo, 'synthetic-fact-delete-marker.txt');
  assert.equal((await action(beforeNewSource, { action: 'calculate' })).status, 409);
  current = await readFacts();
  assert(current.generation > beforeNewSource.generation);
  assert.equal(current.state.scope, null);
  assert.deepEqual(current.state.confirmations, { due: null, paid: null });
  assert.equal(current.canCalculate, false);
  observe('new_source_invalidates_authorization_before_analysis', { beforeGeneration: beforeNewSource.generation, afterGeneration: current.generation });

  phase = 'source_deletion_cleanup';
  await analyze(second);
  current = await extract(await readFacts(), second.id);
  assert(current.state.materials.find((material) => material.evidenceId === second.id).raw.includes('1300'));
  const beforeDelete = current;
  await json(await request(`/api/evidence?id=${second.id}`, 'DELETE'));
  evidenceIds.delete(second.id);
  current = await readFacts();
  assert.equal(current.sources.some((source) => source.id === second.id), false);
  assert.deepEqual(current.state.materials, [], 'Deleting a source invalidates and removes the whole case facts cache.');
  assert.equal(current.state.job, null);
  assert.equal((await action(beforeDelete, { action: 'calculate' })).status, 409);
  assert.equal((await request(`/api/evidence/${second.id}/analysis`)).status, 404);
  assert.equal((await request(`/api/evidence/${second.id}/download`)).status, 404);
  observe('deleting_source_removes_original_analysis_and_case_fact_cache');

  phase = 'archive_restore_and_company_invalidation';
  current = await extract(current, first.id);
  current = await confirmScope(current);
  current = await confirmAmount(current, 'due', '1000');
  current = await confirmAmount(current, 'paid', '0');
  const beforeArchive = current;
  await json(await request('/api/cases', 'PATCH', { id: workCase.id, status: 'archived' }));
  assert.equal((await request(factsPath())).status, 404);
  assert.equal((await action(beforeArchive, { action: 'calculate' })).status, 404);
  await json(await request('/api/cases', 'PATCH', { id: workCase.id, status: 'collecting' }));
  assert.equal((await action(beforeArchive, { action: 'calculate' })).status, 409);
  current = await readFacts();
  assert.equal(current.state.scope, null);
  assert.deepEqual(current.state.confirmations, { due: null, paid: null });
  const beforeCompanyChange = current;
  await json(await request('/api/cases', 'PATCH', { id: workCase.id, company: '合成事实链另一测试单位' }));
  assert.equal((await action(beforeCompanyChange, { action: 'calculate' })).status, 409);
  observe('archive_restore_and_company_change_invalidate_prior_confirmation');
} catch (error) {
  failure = { phase, name: error.name, message: error.message };
} finally {
  phase = 'cleanup';
  const cleanup = [];
  for (const id of evidenceIds) {
    try { const response = await request(`/api/evidence?id=${id}`, 'DELETE'); cleanup.push({ id, status: response.status }); }
    catch (error) { cleanup.push({ id, error: error.message }); }
  }
  if (workCase) {
    try { const response = await request('/api/cases', 'PATCH', { id: workCase.id, status: 'archived' }); cleanup.push({ caseId: workCase.id, status: response.status }); }
    catch (error) { cleanup.push({ caseId: workCase.id, error: error.message }); }
  }
  const cleanupFailed = cleanup.some((item) => item.status !== 200 && item.status !== 404);
  if (cleanupFailed) failure ??= { phase, message: 'Synthetic fixture cleanup was incomplete.' };
  observations.push({ name: 'synthetic_uploads_removed_and_case_archived', status: cleanupFailed ? 'FAIL' : 'PASS', cleanup });
}
await writeFile(output, JSON.stringify({ status: failure ? 'FAIL' : 'PASS', mode: 'facts', syntheticInputs: true, actualModelInference: false, recordedAt: new Date().toISOString(), failure, observations }, null, 2) + '\n');
if (process.connected) process.disconnect();
if (failure) throw new Error(`${failure.phase}: ${failure.message}`);
console.log(JSON.stringify({ status: 'PASS', mode: 'facts', checks: observations.length, output }));
