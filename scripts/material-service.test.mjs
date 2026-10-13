import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { cleanModelFields, createMaterialService, extractRuleFields, validateFields } from './material-service.mjs';

const token = randomBytes(40).toString('hex');
const auth = { Authorization: `Bearer ${token}` };
const fixture = (name) => new URL(`../fixtures/material-demo/${name}`, import.meta.url);

async function submit(service, bytes, mime = 'text/plain', kind = 'contract') {
  const response = await fetch(`${service.url}/jobs`, { method: 'POST', headers: { ...auth, 'Content-Type': mime, 'x-document-kind': kind }, body: bytes });
  return { response, payload: await response.json() };
}
async function finish(service, jobId, timeout = 90_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const response = await fetch(`${service.url}/jobs/${jobId}`, { headers: auth });
    const payload = await response.json();
    if (payload.status !== 'running') return payload;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Controlled synthetic job did not finish in time.');
}

test('all routes require the caller token, reject browser origins and client parameters', async (t) => {
  const service = await createMaterialService({ token, port: 0 });
  t.after(() => service.close());
  assert.match(service.url, /^http:\/\/127\.0\.0\.1:\d+$/u);
  for (const path of ['/health', '/jobs', '/jobs/00000000-0000-4000-8000-000000000000', '/unknown']) {
    assert.equal((await fetch(service.url + path)).status, 401);
  }
  assert.equal((await fetch(`${service.url}/health`, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  const health = await fetch(`${service.url}/health`, { headers: auth });
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('access-control-allow-origin'), null);
  assert.equal((await health.json()).capabilities.concurrency, 1);
  assert.equal((await fetch(`${service.url}/health`, { headers: { ...auth, Origin: 'http://localhost' } })).status, 403);
  assert.equal((await fetch(`${service.url}/jobs?url=https%3A%2F%2Fexample.com`, { method: 'POST', headers: auth, body: 'x' })).status, 400);
  assert.equal((await fetch(`${service.url}/jobs`, { method: 'POST', headers: { ...auth, 'Content-Type': 'text/plain', 'x-model': 'unapproved' }, body: 'x' })).status, 400);
  assert.equal((await submit(service, 'x', 'application/msword')).response.status, 415);
  assert.equal((await submit(service, '', 'text/plain')).response.status, 400);
  assert.equal((await submit(service, 'x', 'text/plain', 'invalid')).response.status, 400);
  assert.equal((await submit(service, Buffer.alloc(10 * 1024 * 1024 + 1))).response.status, 413);
});

test('TXT jobs run actual UTF-8 extraction and explicit rules with verbatim field citations', async (t) => {
  const service = await createMaterialService({ token });
  t.after(() => service.close());
  const { response, payload } = await submit(service, await readFile(fixture('facts.txt')));
  assert.equal(response.status, 202);
  const job = await finish(service, payload.jobId);
  assert.equal(job.status, 'ready');
  assert.equal(job.result.engine.structuring, 'ocr_rules');
  assert.equal(job.result.engine.ocr, 'utf8_text');
  assert.equal(job.result.engine.model, null);
  assert.equal(job.result.engine.modelDigest, null);
  assert.equal(job.result.engine.imageCount, 0);
  assert.equal(job.result.pageCount, 1);
  const values = Object.fromEntries(job.result.fields.map((field) => [field.key, field.value]));
  assert.equal(values.employer, '合成星海科技有限公司');
  assert.equal(values.worker, '张小合');
  assert.equal(values.wage_standard, '8000元');
  assert.equal(values.employment_start, '2026年01月05日');
  for (const field of job.result.fields) {
    assert.equal(field.origin, 'rule');
    assert(field.quote.includes(field.value));
    assert(field.blockIds.every((id) => job.result.blocks.find((block) => block.id === id).text.includes(field.quote)));
  }
  const invalid = await submit(service, Buffer.from([0xff, 0xfe]));
  assert.equal((await finish(service, invalid.payload.jobId)).error.code, 'INVALID_TEXT');
  const empty = await submit(service, '   \n ');
  assert.equal((await finish(service, empty.payload.jobId)).error.code, 'OCR_EMPTY');
  const long = await submit(service, '合'.repeat(32_001));
  assert.equal((await finish(service, long.payload.jobId)).error.code, 'TEXT_LIMIT');
  assert.equal((await fetch(`${service.url}/jobs/00000000-0000-4000-8000-000000000000`, { headers: auth })).status, 404);
});

test('model fields require allowed keys, existing blocks and exact original text', () => {
  const blocks = [{ id: 'p1-b1', page: 1, text: '月工资：8000元', bbox: null, confidence: null }, { id: 'p1-b2', text: '无关行' }];
  const supported = { key: 'wage_standard', value: '8000元', quote: '月工资：8000元', blockIds: ['p1-b1'] };
  const { fields, rejected, rejectionReasons } = validateFields([supported,
    { ...supported, value: '9000元' }, { ...supported, quote: '工资：8000.00元' },
    { ...supported, blockIds: ['missing'] }, { ...supported, blockIds: ['p1-b1', 'p1-b2'] },
    { ...supported, key: 'legal_result' }, { ...supported, key: '__proto__' },
  ], blocks);
  assert.equal(fields.length, 1);
  assert.equal(fields[0].origin, 'model');
  assert.equal(rejected, 6);
  assert.deepEqual(rejectionReasons, { invalid_shape: 2, unknown_block: 1, value_not_in_quote: 2, quote_not_in_blocks: 1, semantic_mismatch: 0 });
  assert.throws(() => validateFields(null, blocks), /格式/u);
  assert.equal(extractRuleFields([{ id: 'a', text: '安排你明天到工厂上班。' }], 'chat')[0].key, 'management_statement');
});

test('recorded real Apple HTTP misclassifications are rejected without adding or changing model fields', () => {
  // Accepted key/value/block IDs from the pre-filter 2026-10-13 actual Apple HTTP run.
  // Quotes are original fixture substrings; this test is a replay, not another inference.
  const fixtures = [
    { texts: ['合成测试材料•劳动合同', '用人单位：合成星海科技有限公司', '劳动者：张小合', '工作岗位：设备维护员', '入职日期：2026年01月05日', '月工资：8000元', '声明：本材料仅用于软件识别测试，不具有法律效力。'],
      rows: [['employer', '合成星海科技有限公司', 2], ['worker', '张小合', 3], ['job', '设备维护员', 4], ['employment_start', '2026年01月05日', 5], ['wage_standard', '8000元', 6], ['management_statement', '本材料仅用于软件识别测试，不具有法律效力。', 7]], accepted: 5, rejected: 1 },
    { texts: ['合成测试材料•工资到账记录', '用人单位：合成星海科技有限公司', '员工姓名：张小合', '付款日期：2026年02月10日', '到账金额：6500元', '摘要：2026年01月工资', '声明：本材料仅用于软件识别测试，不是银行流水。'],
      rows: [['employer', '合成星海科技有限公司', 2], ['worker', '张小合', 3], ['payment_date', '2026年02月10日', 4], ['payment_amount', '6500元', 5], ['job', '合成测试材料•工资到账记录', 1], ['wage_standard', '2026年01月工资', 6], ['management_statement', '本材料仅用于软件识别测试，不是银行流水。', 7]], accepted: 4, rejected: 3 },
    { texts: ['合成测试材料•工作聊天截图', '主管（合成）：2026年03月02日 09:00', '安排你明天上午到工厂上班，请按时打卡。', '张小合（合成）：2026年03月02日 09:05', '2月份工资还没发，请问什么时候支付？', '主管（合成）：2026年03月02日 09:10', '公司拖欠2月份工资，会尽快支付。', '声明：这不是实际聊天记录，仅用于软件测试。'],
      rows: [['job', '工作聊天截图', 1], ['worker', '张小合', 4], ['employer', '公司', 7], ['wage_standard', '2月份工资', 5], ['payment_date', '2月份工资', 5], ['management_statement', '安排你明天上午到工厂上班，请按时打卡。', 3], ['management_statement', '会尽快支付。', 7]], accepted: 2, rejected: 5 },
  ];
  for (const fixture of fixtures) {
    const blocks = fixture.texts.map((text, index) => ({ id: `p1-b${index + 1}`, text }));
    const candidates = fixture.rows.map(([key, value, block]) => ({ key, value, quote: value, blockIds: [`p1-b${block}`] }));
    const validated = validateFields(candidates, blocks);
    assert.equal(validated.fields.length, fixture.accepted);
    assert.equal(validated.rejected, fixture.rejected);
    assert.equal(validated.rejectionReasons.semantic_mismatch, fixture.rejected);
    for (const field of validated.fields) {
      assert.equal(field.origin, 'model');
      const original = candidates.find((candidate) => candidate.key === field.key && candidate.value === field.value);
      assert.equal(field.value, original.value); assert.equal(field.quote, original.quote);
    }
    assert.equal(validated.fields.some((field) => field.key === 'arrears_statement'), false, 'No missing model field is filled by rules.');
  }
  const guardCases = [
    ['arrears_statement', '此前工资尚未发放。', '此前工资尚未发放。', true],
    ['arrears_statement', '2月份工资还没发，请问什么时候支付？', '2月份工资还没发，请问什么时候支付？', true],
    ['arrears_statement', '公司拖欠2月份工资，会尽快支付。', '公司拖欠2月份工资，会尽快支付。', true],
    ['arrears_statement', '会尽快支付。', '公司拖欠2月份工资，会尽快支付。', false],
    ['payment_date', '2026年13月01日', '付款日期：2026年13月01日', false],
    ['payment_date', '2026年02月10日', '张小合：2026年02月10日 09:00', false],
    ['payment_date', '2026年02月10日', '预计付款日期：2026年02月10日', false],
    ['employment_start', '2026年02月10日', '付款日期：2026年02月10日', false],
    ['wage_standard', '2026', '摘要：2026年01月工资', false],
    ['payment_amount', '6500元', '尚未到账金额：6500元', false],
    ['payment_amount', '8000元', '月工资：8000元，到账金额：6500元', false],
    ['wage_standard', '6500元', '月工资：8000元，到账金额：6500元', false],
    ['wage_standard', '8000', '月工资：8000', true],
    ['management_statement', '请明天上班并按时打卡。', '请明天上班并按时打卡。', true],
  ];
  for (const [key, value, text, accepted] of guardCases) {
    const result = validateFields([{ key, value, quote: value, blockIds: ['b'] }], [{ id: 'b', text }]);
    assert.equal(result.fields.length, Number(accepted), `${key}: ${value}`);
  }
});

test('semantic model rejections are visible in job warnings and cannot be filled by rules', async (t) => {
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url).startsWith('http://127.0.0.1:11434/')) {
      const path = new URL(url).pathname;
      if (path === '/api/tags') return Response.json({ models: [{ name: 'synthetic-vision', digest: 'synthetic-test-digest' }] });
      if (path === '/api/show') return Response.json({ capabilities: ['vision'] });
      return Response.json({ message: { content: JSON.stringify({ fields: [
        { key: 'worker', value: '张小合', quote: '劳动者：张小合', blockIds: ['p1-b3'] },
        { key: 'management_statement', value: '本材料仅用于软件识别测试，不具有法律效力。', quote: '本材料仅用于软件识别测试，不具有法律效力。', blockIds: ['p1-b7'] },
      ] }) } });
    }
    return realFetch(url, options);
  });
  const service = await createMaterialService({ token, model: 'synthetic-vision' });
  try {
    const submitted = await submit(service, await readFile(fixture('facts.txt')));
    const job = await finish(service, submitted.payload.jobId);
    assert.equal(job.status, 'ready');
    assert.equal(job.result.fields.length, 1);
    assert.equal(job.result.fields[0].key, 'worker');
    assert.equal(job.result.fields[0].origin, 'model');
    assert(job.result.warnings.some((warning) => warning.includes('原文不支持该字段含义 1 个')));
    assert.equal(job.result.fields.some((field) => field.key === 'wage_standard'), false);
  } finally { t.mock.restoreAll(); await service.close(); }
});

test('Ollama calls reject redirects and a model transport failure cannot become rule success', async (t) => {
  const realFetch = globalThis.fetch;
  const paths = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url).startsWith('http://127.0.0.1:11434/')) {
      assert.equal(options.redirect, 'error');
      const path = new URL(url).pathname; paths.push(path);
      if (path === '/api/tags') return Response.json({ models: [{ name: 'synthetic-vision', digest: 'synthetic-test-digest' }] });
      if (path === '/api/show') return Response.json({ capabilities: ['vision'] });
      throw new TypeError('Synthetic redirect rejected; no request is sent elsewhere.');
    }
    return realFetch(url, options);
  });
  const service = await createMaterialService({ token, model: 'synthetic-vision' });
  try {
    const submitted = await submit(service, '月工资：8000元');
    const job = await finish(service, submitted.payload.jobId);
    assert.equal(job.status, 'failed');
    assert.equal(job.error.code, 'PROCESSING_FAILED');
    assert.equal(job.result, undefined);
    assert.deepEqual(paths, ['/api/tags', '/api/show', '/api/chat']);
  } finally { t.mock.restoreAll(); await service.close(); }
});

test('recorded synthetic Apple candidates can lose display ID prefixes while exact citations stay mandatory', () => {
  // Recorded 2026-10-13 local text model candidates, replayed without another inference.
  const rows = [
    ['p1-b2', '用人单位：合成星海科技有限公司', 'employer', '合成星海科技有限公司'],
    ['p1-b3', '劳动者：张小合', 'worker', '张小合'],
    ['p1-b4', '工作岗位：设备维护员', 'job', '设备维护员'],
    ['p1-b5', '入职日期：2026年01月05日', 'employment_start', '2026年01月05日'],
    ['p1-b6', '月工资：8000元', 'wage_standard', '8000元'],
  ];
  const blocks = rows.map(([id, text]) => ({ id, text }));
  const candidates = rows.map(([id, text, key, value]) => ({ key, value, quote: `[${id}] ${text}`, blockIds: [id] }));
  assert.equal(validateFields(candidates, blocks).fields.length, 0);
  const replay = validateFields(cleanModelFields(candidates, blocks), blocks);
  assert.equal(replay.fields.length, 5);
  assert.equal(replay.rejected, 0);
  for (const field of replay.fields) assert.equal(field.origin, 'model');
  const malicious = [
    { ...candidates[4], quote: '[p1-b6] 月工资：9000元', value: '9000元' },
    { ...candidates[4], quote: '[p1-b2] 月工资：8000元' },
    { ...candidates[4], blockIds: ['missing'] },
    { ...candidates[4], blockIds: ['p1-b6', 'p1-b2'] },
  ];
  assert.equal(validateFields(cleanModelFields(malicious, blocks), blocks).fields.length, 0);
});

test('temporary cleanup failures remain visible without hanging cancellation or the next job', async (t) => {
  const realRm = fs.rm;
  let failedDirectory;
  let blocked = true;
  t.mock.method(fs, 'rm', async (path, options) => {
    if (String(path).includes('/job-') && (!failedDirectory || path === failedDirectory)) {
      failedDirectory = path;
      if (blocked) throw Object.assign(new Error('Synthetic cleanup permission failure.'), { code: 'EACCES' });
    }
    return realRm(path, options);
  });
  const service = await createMaterialService({ token });
  try {
    const first = await submit(service, '月工资：8000元');
    const failed = await finish(service, first.payload.jobId);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.error.code, 'TEMP_CLEANUP_FAILED');
    assert.equal(failed.result, undefined);
    assert.equal((await (await fetch(`${service.url}/health`, { headers: auth })).json()).cleanup.pending, 1);
    const second = await submit(service, '月工资：9000元');
    assert.equal((await finish(service, second.payload.jobId)).status, 'ready');
    const cancelled = await fetch(`${service.url}/jobs/${first.payload.jobId}`, { method: 'DELETE', headers: auth, signal: AbortSignal.timeout(2000) });
    assert.equal(cancelled.status, 503);
    assert.equal((await cancelled.json()).error.code, 'TEMP_CLEANUP_FAILED');
    blocked = false;
    assert.equal((await fetch(`${service.url}/jobs/${first.payload.jobId}`, { method: 'DELETE', headers: auth })).status, 200);
    assert.equal((await (await fetch(`${service.url}/health`, { headers: auth })).json()).cleanup.pending, 0);
    await assert.rejects(fs.stat(failedDirectory), { code: 'ENOENT' });
  } finally { t.mock.restoreAll(); await service.close(); }
});

test('an occupied listen port removes the newly created private service directory', async (t) => {
  const blocker = createServer();
  await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
  const realRm = fs.rm;
  const removed = [];
  t.mock.method(fs, 'rm', async (path, options) => { removed.push(path); return realRm(path, options); });
  try {
    await assert.rejects(createMaterialService({ token, port: blocker.address().port }), { code: 'EADDRINUSE' });
    assert.equal(removed.length, 1);
    await assert.rejects(fs.stat(removed[0]), { code: 'ENOENT' });
  } finally { t.mock.restoreAll(); await new Promise((resolve) => blocker.close(resolve)); }
});

test('job capacity is bounded and a restart cannot expose prior in-memory jobs', async () => {
  const service = await createMaterialService({ token });
  let jobId;
  try {
    for (let index = 0; index < 32; index += 1) {
      const submitted = await submit(service, '用人单位：合成星海科技有限公司');
      assert.equal(submitted.response.status, 202);
      jobId = submitted.payload.jobId;
      await finish(service, jobId);
    }
    assert.equal((await submit(service, 'extra')).response.status, 429);
    await finish(service, jobId);
  } finally { await service.close(); }
  const restarted = await createMaterialService({ token });
  try { assert.equal((await fetch(`${restarted.url}/jobs/${jobId}`, { headers: auth })).status, 404); }
  finally { await restarted.close(); }
});

test('deleting a ready job clears cached content and DELETE is idempotent', async (t) => {
  const service = await createMaterialService({ token });
  t.after(() => service.close());
  const job = await submit(service, '劳动者：合成张小合');
  await finish(service, job.payload.jobId);
  for (let index = 0; index < 2; index += 1) {
    const response = await fetch(`${service.url}/jobs/${job.payload.jobId}`, { method: 'DELETE', headers: auth });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  }
  assert.equal((await fetch(`${service.url}/jobs/${job.payload.jobId}`, { headers: auth })).status, 404);
  assert.equal((await fetch(`${service.url}/jobs/${job.payload.jobId}`, { method: 'DELETE' })).status, 401);
});

test('at most two jobs wait and deletion cancels running/queued OCR without reviving results', { skip: process.platform !== 'darwin' }, async (t) => {
  const service = await createMaterialService({ token });
  t.after(() => service.close());
  const bytes = await readFile(fixture('contract.png'));
  const admitted = [];
  for (let index = 0; index < 3; index += 1) {
    const submitted = await submit(service, bytes, 'image/png');
    assert.equal(submitted.response.status, 202);
    admitted.push(submitted.payload.jobId);
  }
  assert.equal((await submit(service, bytes, 'image/png')).response.status, 429);
  for (const id of [admitted[1], admitted[0]]) {
    const cancelled = await fetch(`${service.url}/jobs/${id}`, { method: 'DELETE', headers: auth });
    assert.equal(cancelled.status, 200);
    assert.equal((await fetch(`${service.url}/jobs/${id}`, { headers: auth })).status, 404);
  }
  assert.equal((await finish(service, admitted[2])).status, 'ready');
  for (const id of admitted.slice(0, 2)) assert.equal((await fetch(`${service.url}/jobs/${id}`, { headers: auth })).status, 404);
});

test('real Apple Vision recognises synthetic PNG/PDF, preserves bboxes, rejects broken images and six-page PDFs', { skip: process.platform !== 'darwin' }, async (t) => {
  const service = await createMaterialService({ token });
  t.after(() => service.close());
  for (const [name, mime, kind, expected] of [
    ['contract.png', 'image/png', 'contract', ['8000元', '张小合']],
    ['wage-statement.png', 'image/png', 'wage_statement', ['6500元', '2026年02月10日']],
    ['chat.png', 'image/png', 'chat', ['公司拖欠2月份工资', '安排你明天上午到工厂上班']],
    ['contract.pdf', 'application/pdf', 'contract', ['8000元', '张小合']],
  ]) {
    const submitted = await submit(service, await readFile(fixture(name)), mime, kind);
    assert.equal(submitted.response.status, 202);
    const job = await finish(service, submitted.payload.jobId);
    assert.equal(job.status, 'ready', JSON.stringify(job.error));
    assert.equal(job.result.engine.imageCount, 1);
    const text = job.result.blocks.map((block) => block.text).join('\n');
    for (const value of expected) assert(text.includes(value), `${name}: ${value}`);
    for (const block of job.result.blocks) {
      assert.equal(block.page, 1);
      assert.equal(block.bbox.length, 4);
      assert(block.bbox.every((coordinate) => coordinate >= 0 && coordinate <= 1));
      assert(block.confidence >= 0 && block.confidence <= 1);
    }
  }
  const broken = await submit(service, Buffer.from('invalid synthetic image'), 'image/png');
  assert.equal((await finish(service, broken.payload.jobId)).error.code, 'INVALID_IMAGE');
  const oversized = await submit(service, await readFile(fixture('over-limit.pdf')), 'application/pdf');
  assert.equal((await finish(service, oversized.payload.jobId)).error.code, 'PDF_PAGE_LIMIT');
});
