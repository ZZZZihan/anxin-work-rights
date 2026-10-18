import assert from 'node:assert/strict';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = process.cwd(), output = resolve(root, 'output/playwright/pr40-third-occurrence');
const fixture = JSON.parse(await readFile('/tmp/anxin-cases-ui-isolation.json', 'utf8'));
assert.equal(fixture.isolated, true);
assert.ok(fixture.databasePath.includes('/anxin-cases-ui-'));
assert.equal(new URL(fixture.base).hostname, '127.0.0.1');
const headers = { 'oai-authenticated-user-id': fixture.owner, 'oai-authenticated-user-email': 'owner@synthetic.test' };
const v3 = await import(pathToFileURL(resolve(root, 'lib/material-facts-v3.ts')));
const at = new Date().toISOString(), db = new DatabaseSync(fixture.databasePath);
const quote = '王甲2024年7月完整应付工资8000元';
const text = `${quote}。李乙2024年7月完整应付工资8000元。`;
const source = { id: randomUUID(), name: '合成同段重复金额与月份.txt', sha256: createHash('sha256').update(text).digest('hex'), analysisRevision: 1, ready: true, blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] };
const money = { kind: 'money', value: '8000元', quote, blockId: 'b1', subject: '王甲', scope: 'individual', meaning: 'due_total', completeness: 'complete', period: '2024年7月', rateUnit: null, assertion: 'narrated' };
const date = { ...money, kind: 'date', value: '2024年7月', meaning: 'wage_period', completeness: 'not_applicable', period: null };
const raw = JSON.stringify({ schemaVersion: 3, candidates: [money, date] });
try {
  const knowledgeResponse = await fetch(`${fixture.base}/api/knowledge?query=${encodeURIComponent('工资')}`, { headers });
  assert.equal(knowledgeResponse.status, 200);
  const knowledge = await knowledgeResponse.json();
  db.prepare(`INSERT INTO evidence_files(id,user_id,case_id,name,category,size,mime_type,status,note,object_key,uploaded_at,content_hash)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(source.id, fixture.owner, fixture.caseId, source.name, '其他材料', Buffer.byteLength(text), 'text/plain', 'uploaded', '严格隔离合成资料', `synthetic/${source.id}`, at, source.sha256);
  const result = { source: { evidenceId: source.id, name: source.name, sha256: source.sha256, mimeType: 'text/plain' }, engine: { ocr: 'synthetic-ui-fixture', structuring: 'ocr_rules', model: null }, pageCount: 1, blocks: source.blocks, fields: [], warnings: [], knowledge };
  db.prepare(`INSERT INTO evidence_analyses(evidence_id,user_id,content_hash,document_kind,status,revision,run_id,job_id,result_json,error,started_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(source.id, fixture.owner, source.sha256, 'other', 'ready', 1, randomUUID(), null, JSON.stringify(result), null, at, at);
  const generation = db.prepare('SELECT generation FROM case_material_generations WHERE case_id=? AND user_id=?').get(fixture.caseId, fixture.owner).generation;
  const state = v3.ingestCandidates(v3.emptyFactState(generation), source, { raw }, 'synthetic-v3', fixture.owner, at);
  assert.equal(state.materials[0].candidates.length, 2);
  assert.equal(state.materials[0].coverage.status, 'no_signal');
  db.prepare('INSERT INTO case_material_facts(case_id,user_id,revision,state_json,updated_at) VALUES(?,?,1,?,?)').run(fixture.caseId, fixture.owner, JSON.stringify(state), at);
  const response = await fetch(`${fixture.base}/api/cases/${fixture.caseId}/facts`, { headers });
  assert.equal(response.status, 200);
  const body = await response.json(), material = body.state.materials[0], coverage = material.sourceCoverage;
  assert.equal(coverage.status, 'possible_missing');
  assert.equal(coverage.rawCount, 2);
  assert.equal(coverage.acceptedCount, 2);
  for (const kind of ['money', 'date']) assert.deepEqual(coverage.signals.filter(item => item.kind === kind).map(item => item.covered), [true, false]);
  assert.equal(material.raw, raw);
  assert.equal(JSON.parse(material.raw).candidates.length, 2);
  assert.deepEqual(body.candidates.map(item => item.representation.subject), ['王甲', '王甲']);
  assert.equal(body.state.confirmations.due, null);
  assert.equal(body.state.confirmations.paid, null);
  assert.equal(body.canCalculate, false);
  const persisted = JSON.parse(db.prepare('SELECT state_json FROM case_material_facts WHERE case_id=?').get(fixture.caseId).state_json);
  assert.equal(persisted.materials[0].raw, raw);
  assert.equal(persisted.materials[0].coverage.status, 'no_signal');
  assert.equal(Object.hasOwn(persisted.materials[0], 'sourceCoverage'), false);
  const sha = async path => createHash('sha256').update(await readFile(resolve(root, path))).digest('hex');
  const report = {
    status: 'API_PASS_BROWSER_PENDING', recordedAt: at,
    boundary: 'production dist + independent local Worker/D1 + headed Chromium; direct synthetic analysis/fact seed; no model or OCR inference',
    gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    sourceSha256: { coverage: await sha('lib/material-fact-coverage-review.ts'), store: await sha('lib/material-fact-store.ts') },
    distSha256: await sha('dist/server/index.js'), distModifiedAt: (await stat(resolve(root, 'dist/server/index.js'))).mtime.toISOString(),
    fixture: { source, rawCandidateCount: 2, extractedSubjects: ['王甲', '王甲'], expectedOmittedSubject: '李乙' },
    api: { status: 200, sourceCoverageStatus: coverage.status, signals: coverage.signals, persistedFrozenCoverageStatus: persisted.materials[0].coverage.status, derivedCoveragePersisted: false, rawPreserved: true, rawCount: 2, confirmations: body.state.confirmations, canCalculate: body.canCalculate },
    browser: { status: 'PENDING' }, cleanup: { status: 'PENDING' },
  };
  await writeFile(resolve(output, 'facts-response.json'), JSON.stringify(body, null, 2) + '\n');
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile('/tmp/anxin-occurrence-ui-fixture.json', JSON.stringify({ caseId: fixture.caseId, evidenceId: source.id, sourceName: source.name, output }), { mode: 0o600 });
  console.log('occurrence fixture: real HTTP assertions PASS; browser pending');
} finally { db.close(); }
