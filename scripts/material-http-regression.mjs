import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';

const [base, output, mode = 'text'] = process.argv.slice(2);
if (!base || !output || !['text', 'images'].includes(mode)) throw new Error('Usage: node scripts/material-http-regression.mjs BASE OUTPUT [text|images]');
const observations = [];
let failureContext;
const headers = (user = 'a') => ({ 'oai-authenticated-user-id': `material-http-${user}`, 'oai-authenticated-user-email': `${user}@synthetic.test` });
const request = async (path, method = 'GET', body, user = 'a') => fetch(`${base}${path}`, { method, headers: headers(user), body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
const observe = (name, detail = {}) => observations.push({ name, ...detail, status: 'PASS' });
const created = [];
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
    let analysis;
    for (let attempt = 0; attempt < 150; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const response = await request(`/api/evidence/${evidence.id}/analysis`); assert.equal(response.status, 200);
      analysis = (await response.json()).analysis;
      if (analysis.status !== 'running') break;
    }
    assert.equal(analysis.status, 'ready', analysis.error);
    const result = analysis.result;
    failureContext = { fixture: name, analysis };
    assert.equal(result.source.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert(result.blocks.some((block) => block.text.includes(expected)), `${name}: expected known synthetic text ${expected}`);
    assert(result.fields.length > 0, `${name}: grounded fields missing`);
    for (const field of result.fields) {
      assert(result.blocks.filter((b) => field.blockIds.includes(b.id)).map((b) => b.text).join('\n').includes(field.quote));
      assert(field.quote.includes(field.extractedValue));
    }
    // Check the known synthetic facts, not only that the transport returned fields.
    const expectedFields = documentKind === 'contract'
      ? { employer: '合成星海科技有限公司', worker: '张小合', job: '设备维护员', employment_start: '2026年01月05日', wage_standard: '8000元' }
      : documentKind === 'wage_statement'
        ? { employer: '合成星海科技有限公司', worker: '张小合', payment_date: '2026年02月10日', payment_amount: '6500元' }
        : { management_statement: '安排你明天上午到工厂上班，请按时打卡。' };
    for (const [key, value] of Object.entries(expectedFields)) assert(result.fields.some((f) => f.key === key && f.value === value), `${name}: missing expected ${key}=${value}`);
    const allowedKeys = documentKind === 'chat' ? ['worker', 'management_statement', 'arrears_statement'] : Object.keys(expectedFields);
    assert(result.fields.every((f) => allowedKeys.includes(f.key)), `${name}: unsupported field classification`);
    const allowedValues = documentKind === 'chat' ? {
      worker: ['张小合'],
      management_statement: ['安排你明天上午到工厂上班，请按时打卡。'],
      arrears_statement: ['2月份工资还没发，请问什么时候支付？', '2月份工资还没发', '公司拖欠2月份工资，会尽快支付。', '公司拖欠2月份工资'],
    } : Object.fromEntries(Object.entries(expectedFields).map(([key, value]) => [key, [value]]));
    assert(result.fields.every((f) => allowedValues[f.key]?.includes(f.value)), `${name}: field value does not match the known synthetic fact category`);
    assert(result.fields.every((f) => !/合成测试材料|仅用于软件|不具有法律效力|不是银行流水/.test(f.value)), `${name}: document metadata misclassified as fact`);
    if (documentKind === 'chat') assert(result.fields.some((f) => f.key === 'arrears_statement' && /工资还没发|拖欠2月份工资/.test(f.value)), `${name}: missing wage arrears statement`);
    assert(result.knowledge.hits.some((h) => h.kind === 'case'));
    assert(result.knowledge.hits.some((h) => h.kind === 'provision'));
    assert(result.knowledge.hits.every((h) => h.citations.every((c) => c.text && c.sourceUrl && c.paragraphId)));
    assert.equal((await request(`/api/evidence/${evidence.id}/analysis`, 'GET', undefined, 'b')).status, 404);
    assert.equal((await request(`/api/evidence/${evidence.id}/analysis`, 'POST', { documentKind }, 'b')).status, 404);
    const unchanged = (await (await request(`/api/evidence/${evidence.id}/analysis`)).json()).analysis;
    assert.deepEqual(unchanged, analysis);
    observe('upload_extract_retrieve_cite_owner_isolation', { fixture: name, engine: result.engine, fields: result.fields.map((f) => ({ key: f.key, value: f.value, quote: f.quote, blockIds: f.blockIds, origin: f.origin })), semanticFixtureAssertions: 'PASS', warnings: result.warnings, blockCount: result.blocks.length, publicHitIds: result.knowledge.hits.map((h) => h.id), fingerprint: result.knowledge.fingerprint });
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
  const unrelated = await request('/api/knowledge?query=' + encodeURIComponent('番茄炒蛋怎么做')); assert.equal(unrelated.status, 200); assert.equal((await unrelated.json()).hits.length, 0);
  observe('unrelated_query_has_no_fabricated_hit');
  const manual = await request('/api/knowledge?query=' + encodeURIComponent('没签劳动合同但是每天打卡')); assert.equal(manual.status, 200); assert((await manual.json()).hits.length > 0);
  observe('natural_language_labor_query');
  await writeFile(output, JSON.stringify({ status: 'PASS', mode, syntheticInputs: true, recordedAt: new Date().toISOString(), observations }, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'PASS', checks: observations.length, mode, output }));
} catch (error) {
  await writeFile(output, JSON.stringify({ status: 'FAIL', mode, syntheticInputs: true, recordedAt: new Date().toISOString(), error: error.message, failureContext, observations }, null, 2) + '\n');
  throw error;
} finally {
  for (const id of created) await request(`/api/evidence?id=${id}`, 'DELETE').catch(() => undefined);
  await request('/api/cases', 'PATCH', { id: workCase.id, status: 'archived' }).catch(() => undefined);
}
