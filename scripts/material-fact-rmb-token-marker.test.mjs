import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = resolve(process.env.V7_RMB_TOKEN_ROOT || fileURLToPath(new URL('../', import.meta.url)));
const { sourceMoneyHasExplicitRmbCurrency } = await import(pathToFileURL(resolve(root, 'lib/material-fact-currency-review.ts')).href);
const cp = s => Array.from(s).length;
function has(value, before = '', after = '') {
  return sourceMoneyHasExplicitRmbCurrency({ blockText: before + value + after, valueStart: before.length }, { rawValue: value, amount: '40000.00', status: 'exact', matchedText: value, span: { start: 0, end: cp(value) }, reason: 'Synthetic currency marker unit check only.' });
}
for (const value of ['40000RMB', '40000CNY', '40000rmb', '40000cny', 'RMB40000', 'CNY40000']) test('complete ASCII RMB marker is contained in the anchored token: ' + value, () => assert.equal(has(value), true));
for (const value of ['40000ARMB', '40000RMBX', '40000CNYUSD', '40000XCNYY', '40000USD', '40000', '40000\nRMB']) test('a foreign, embedded or separate-line marker does not prove this token RMB: ' + value, () => assert.equal(has(value), false));
