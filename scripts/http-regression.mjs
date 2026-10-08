// Only disposable loopback D1/R2 instances may be fault-injected.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { realpathSync, writeFileSync } from 'node:fs';
const base = new URL(process.argv[2]);
assert.equal(base.hostname, '127.0.0.1');
const sqlite = realpathSync(process.argv[3]);
assert(/^\/(private\/)?tmp\/anxin-e2e-/.test(sqlite));
const output = process.argv[4];
const runId = crypto.randomUUID();
const observations = [];
function observe(check, detail = {}) { observations.push({ check, ...detail }); }
async function request(path, user = 'a', method = 'GET', value) {
  const headers = user ? { 'oai-authenticated-user-id': `regression-${runId}-${user}`, 'oai-authenticated-user-email': `${user}@regression.test` } : {};
  if (value && !(value instanceof FormData)) headers['Content-Type'] = 'application/json';
  return fetch(new URL(path, base), { method, headers, body: value instanceof FormData ? value : value === undefined ? undefined : JSON.stringify(value), signal: AbortSignal.timeout(15000) });
}
function sql(statement) {
  execFileSync('python3', ['-c', 'import sqlite3,sys\nc=sqlite3.connect(sys.argv[1])\nc.executescript(sys.argv[2])\nc.commit()', sqlite, statement]);
}
async function upload(caseId, operationId, content = 'synthetic evidence bytes') {
  const form = new FormData(); form.append('caseId', caseId); form.append('operationId', operationId);
  form.append('file', new File([content], 'roundtrip.txt', { type: 'text/plain' }));
  return request('/api/evidence', 'a', 'POST', form);
}
try {
  assert.equal((await request('/api/bootstrap', null)).status, 401); observe('anonymous_401');
  const initial = await (await request('/api/bootstrap')).json();
  assert.equal(initial.cases.length, 0); assert.equal(initial.evidence.length, 0); observe('production_empty_account');
  for (const value of [[], 1, null, { company: 'test', type: 'test', amount: 'NaN' }, { company: 'test', type: 'test', deadline: '2026-02-29' }]) {
    assert.equal((await request('/api/cases', 'a', 'POST', value)).status, 400);
  } observe('invalid_creation_rejected', { cases: 5 });
  const created = await request('/api/cases', 'a', 'POST', { company: 'E2E 合成单位', type: '欠薪争议', amount: '12480', deadline: '2026-10-20' });
  assert.equal(created.status, 201); const workCase = (await created.json()).case;
  for (const update of [{ status: 'completed', currentStep: 0 }, { deadline: 'bad-date' }, { amount: 'bad' }, { company: '' }, { currentStep: 5 }, { status: 'bogus' }]) {
    assert.equal((await request('/api/cases', 'a', 'PATCH', { id: workCase.id, ...update })).status, 400);
  } observe('invalid_updates_rejected', { cases: 6 });
  const advanced = await request('/api/cases', 'a', 'PATCH', { id: workCase.id, currentStep: 2 });
  assert.equal((await advanced.json()).case.status, 'negotiating'); observe('server_owns_stage_status');
  assert.equal((await request('/api/cases', 'b', 'PATCH', { id: workCase.id, company: 'intruder' })).status, 404); observe('cross_user_case_404');
  for (const type of ['unsupported', 'constructor']) assert.equal((await request('/api/documents', 'a', 'PUT', { caseId: workCase.id, type, revision: 0, fields: {} })).status, 400);
  observe('unsupported_templates_400');
  const draftBody = { caseId: workCase.id, type: 'fact-timeline', fields: { title: 'original' }, revision: 0 };
  const draftResponse = await request('/api/documents', 'a', 'PUT', draftBody); assert.equal(draftResponse.status, 200);
  const draft = (await draftResponse.json()).document; assert.equal(draft.revision, 1);
  const concurrent = await Promise.all(['one', 'two'].map((title) => request('/api/documents', 'a', 'PUT', { ...draftBody, fields: { title }, revision: draft.revision })));
  assert.deepEqual(concurrent.map((res) => res.status).sort(), [200, 409]); observe('concurrent_drafts_one_winner');
  const operation = crypto.randomUUID();
  const uploaded = await upload(workCase.id, operation); assert.equal(uploaded.status, 201); const evidence = (await uploaded.json()).evidence;
  assert.equal((await upload(workCase.id, operation)).status, 200); observe('upload_retry_idempotent');
  assert.equal((await upload(workCase.id, operation, 'changed content')).status, 409); observe('operation_payload_conflict_409');
  const downloaded = await request(`/api/evidence/${evidence.id}/download`); assert.equal(downloaded.status, 200);
  assert.equal(await downloaded.text(), 'synthetic evidence bytes'); observe('download_exact_bytes');
  assert.equal((await request(`/api/evidence/${evidence.id}/download`, 'b')).status, 404);
  assert.equal((await request(`/api/evidence?id=${evidence.id}`, 'b', 'DELETE')).status, 404); observe('cross_user_evidence_404');
  sql(`CREATE TRIGGER e2e_intent_failure BEFORE UPDATE OF status ON evidence_files WHEN OLD.id = '${evidence.id}' AND NEW.status = 'deleting' BEGIN SELECT RAISE(ABORT, 'injected intent failure'); END;`);
  try {
    assert.equal((await request(`/api/evidence?id=${evidence.id}`, 'a', 'DELETE')).status, 503);
    assert.equal(await (await request(`/api/evidence/${evidence.id}/download`)).text(), 'synthetic evidence bytes'); observe('delete_intent_failure_preserves_file');
  } finally { sql('DROP TRIGGER e2e_intent_failure;'); }
  sql(`CREATE TRIGGER e2e_delete_failure BEFORE DELETE ON evidence_files WHEN OLD.id = '${evidence.id}' BEGIN SELECT RAISE(ABORT, 'injected finalization failure'); END;`);
  try {
    assert.equal((await request(`/api/evidence?id=${evidence.id}`, 'a', 'DELETE')).status, 503);
    const pending = (await (await request('/api/bootstrap')).json()).evidence.find((item) => item.id === evidence.id);
    assert.equal(pending.status, 'deleting'); assert.equal(pending.downloadable, false);
    assert.equal((await request(`/api/evidence/${evidence.id}/download`)).status, 409); observe('delete_finalization_failure_has_tombstone');
  } finally { sql('DROP TRIGGER e2e_delete_failure;'); }
  assert.equal((await request(`/api/evidence?id=${evidence.id}`, 'a', 'DELETE')).status, 200); observe('delete_retry_completes');
  const failedOperation = crypto.randomUUID();
  sql(`CREATE TRIGGER e2e_upload_finalize_failure BEFORE UPDATE OF status ON evidence_files WHEN OLD.id = '${failedOperation}' AND NEW.status = 'uploaded' BEGIN SELECT RAISE(ABORT, 'injected upload failure'); END;`);
  try {
    assert.equal((await upload(workCase.id, failedOperation)).status, 503);
    const pending = (await (await request('/api/bootstrap')).json()).evidence.find((item) => item.id === failedOperation);
    assert.equal(pending.status, 'upload_failed'); assert.equal(pending.downloadable, false); observe('upload_failure_has_recoverable_metadata');
  } finally { sql('DROP TRIGGER e2e_upload_finalize_failure;'); }
  assert.equal((await upload(workCase.id, failedOperation)).status, 201); observe('upload_retry_recovers');
  assert.equal((await request('/api/chat', 'a', 'POST', { caseId: workCase.id, message: '工资拖欠后如何整理材料？' })).status, 201); observe('rule_chat_saved');
  assert.equal((await request('/api/cases', 'a', 'PATCH', { id: workCase.id, status: 'archived' })).status, 200);
  const archived = await (await request('/api/bootstrap')).json(); assert.equal(archived.cases.length, 0); assert.equal(archived.archivedCases.length, 1);
  assert.equal((await request('/api/cases', 'a', 'PATCH', { id: workCase.id, status: 'negotiating' })).status, 200); observe('archive_restore');
  console.log(JSON.stringify({ passed: observations.length, observations }, null, 2));
} finally {
  if (output) writeFileSync(output, JSON.stringify({ runId, observations, passed: observations.length }, null, 2));
}
