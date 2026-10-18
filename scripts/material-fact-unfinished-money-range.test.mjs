import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const OWN = fileURLToPath(new URL('../', import.meta.url));
const BASE = resolve(process.env.V7_UNFINISHED_RANGE_BASE_ROOT || OWN);
const MONEY = resolve(process.env.V7_MONEY_TEST_FILE || resolve(OWN, 'lib/material-money-v4.ts'));
const temp = await mkdtemp(resolve(tmpdir(), 'anxin-unfinished-money-range-'));
after(() => rm(temp, { recursive: true, force: true }));
await cp(resolve(BASE, 'lib'), resolve(temp, 'lib'), { recursive: true });
await cp(MONEY, resolve(temp, 'lib/material-money-v4.ts'));
console.log(JSON.stringify({ money_sha256: createHash('sha256').update(await readFile(MONEY)).digest('hex') }));
const api = await import(pathToFileURL(resolve(temp, 'lib/material-money-v4.ts')).href);
const candidate = quote => ({ kind: 'money', value: '3万元', quote, blockId: 'b1', subject: '王甲', scope: 'individual',
  meaning: 'arrears', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated' });

for (const suffix of ['至4', '至\n4。', '至\n约4。', '至\nRMB4。', '至\n人民币4。', '至\n約４。', '至\nＲＭＢ４。',
  '至\u200d\n约4。', '至不满4', '到4', '至CNY4', '至4万', '元人民币至约4']) {
  test('the shared finite numeric fallback is available over explicit layout: ' + JSON.stringify(suffix), () => {
    assert.equal(api.hasUnfinishedMoneyRangeAfter(suffix), true);
  });
}
for (const suffix of ['至4个月', '至约4个月', '至不满4天', '至2024年7月', '至2024-07', '至2024/07/01',
  '至\n约4个月。', '至\n人民币2024年', '至。4', '至\n王乙工资4元', '。\n至4', '，另付4元', '至待定', '', '至\n另付4元']) {
  test('the numeric fallback does not cross time, unknown prose or a new event: ' + JSON.stringify(suffix), () => {
    assert.equal(api.hasUnfinishedMoneyRangeAfter(suffix), false);
  });
}
for (const suffix of ['至4', '至\n4。', '至\n约4。', '至\nRMB4。', '至\n約４。'])
  test('the original complete-quote route uses the shared fallback without rewriting the quote: ' + JSON.stringify(suffix), () => {
    const quote = '😀𠮷王甲工资3万元' + suffix, raw = candidate(quote), before = structuredClone(raw);
    const normalized = api.normalizeCandidateValueV4(raw);
    assert.equal(normalized.amount, null); assert.equal(normalized.normalization.status, suffix.includes('RMB') ? 'range' : 'uncertain');
    assert.equal(normalized.normalization.rawValue, raw.value); assert.deepEqual(raw, before);
  });
for (const suffix of ['至4个月', '至\n约4个月。', '至2024年7月', '至2024-07', '至\n王乙工资4元'])
  test('refactoring the quote route retains its exact controls: ' + JSON.stringify(suffix), () => {
    const quote = '😀𠮷王甲工资3万元' + suffix;
    assert.equal(api.normalizeCandidateValueV4(candidate(quote)).amount, '30000.00');
  });
test('the source fallback does not alter the full-value parser or raw precise token', () => {
  const normalized = api.normalizeMoneyValueV4('3万元');
  assert.equal(normalized.amount, '30000.00'); assert.equal(normalized.matchedText, '3万元');
  assert.deepEqual(normalized.span, { start: 0, end: 3 });
});
