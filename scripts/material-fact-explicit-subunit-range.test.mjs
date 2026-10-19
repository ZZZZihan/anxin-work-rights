import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = resolve(process.env.V7_SUBUNIT_RANGE_ROOT || fileURLToPath(new URL('../', import.meta.url)));
const { hasMoneyRange, isMoneyRangeEndpoint } = await import(pathToFileURL(resolve(root, 'lib/material-fact-range-review.ts')).href);
for (const [a, b] of [
  ['人民币5角', '人民币8角'], ['人民幣2分', '人民幣8分'], ['人民币5角2分', '人民币8角'],
  ['人民币5角', '8角'], ['人民币2分', '8分'], ['人民币5角', '四元'], ['四元', '人民币5角'],
  ['人民幣兩億圓', '人民幣四億圓'], ['人民币5角', 'RMB8角'],
]) for (const link of ['至', '至\n']) test('explicit RMB range preserves both endpoint identities: ' + a + link + b, () => {
  assert.equal(hasMoneyRange(a + link + b), true);
  assert.equal(isMoneyRangeEndpoint('', a, link + b), true);
  assert.equal(isMoneyRangeEndpoint(a + link, b, ''), true);
});
for (const after of ['5分钟后到账', '8分米', '8角度', '三天到账', '八个人分别收款']) test('a time, measure or count is not an RMB subunit endpoint: ' + after, () => {
  assert.equal(hasMoneyRange('人民币5角至' + after), false);
});
