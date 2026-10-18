import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Pure, finite contracts for the four post-496fb27 review findings. No runtime
// ingestion, source/history/scoring CLI, worker, HTTP request or model is run.
const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const { normalizeCandidateValueV4: normalize } = await import(pathToFileURL(resolve(ROOT, 'lib/material-money-v4.ts')));
const { hasSupportedCandidateAttribution: attributed } = await import(pathToFileURL(resolve(ROOT, 'lib/material-fact-event-review.ts')));
const cp = text => Array.from(text).length;
const raw = (kind, value, quote, extra = {}) => ({ kind, value, quote, blockId: 'b1', subject: '王甲', scope: 'individual',
  meaning: kind === 'date' ? 'payment_date' : 'rate', completeness: 'not_applicable',
  period: null, rateUnit: kind === 'date' ? null : 'hour', assertion: 'narrated', ...extra });
function date(value, text, extra = {}) {
  const candidate = raw('date', value, text, extra), before = structuredClone(candidate);
  const normalized = { rawValue: value, status: 'exact', amount: null, matchedText: value, span: { start: 0, end: cp(value) }, reason: 'Synthetic date attribution only.' };
  const result = attributed(candidate, text, normalized);
  assert.deepEqual(candidate, before); assert.equal(normalized.rawValue, value);
  assert.equal(Array.from(value).slice(normalized.span.start, normalized.span.end).join(''), value);
  console.log(JSON.stringify({ evidence: 'round31_date_module', candidate, result }));
  return result;
}
function money(value, text, extra = {}) {
  const candidate = raw('money', value, text, extra), before = structuredClone(candidate), result = normalize(candidate);
  assert.deepEqual(candidate, before); assert.equal(result.normalization.rawValue, value);
  if (result.normalization.span) assert.equal(Array.from(value).slice(result.normalization.span.start, result.normalization.span.end).join(''), result.normalization.matchedText);
  console.log(JSON.stringify({ evidence: 'round31_money_module', candidate, result }));
  return result;
}
for (const path of ['lib/material-money-v4.ts', 'lib/material-fact-event-review.ts', 'scripts/owned-http-process-group.mjs'])
  console.log(JSON.stringify({ evidence: 'round31_implementation', path, sha256: createHash('sha256').update(await readFile(resolve(ROOT, path))).digest('hex') }));

for (const value of ['每月九号', '每月三十一號', '每月１５號']) test('a complete recurring receipt day keeps its literal calendar: ' + value,
  () => assert.equal(date(value, '😀王甲收到工资' + value), true));
test('the original 日 receipt spelling stays supported', () => assert.equal(date('每月15日', '😀王甲领取工资每月15日'), true));
test('recurring aliases do not admit invalid day numbers or cropped boundaries', () => {
  for (const value of ['每月0号', '每月32號', '每月三十二号']) assert.equal(date(value, '王甲收到工资' + value), false);
  assert.equal(date('每月15号', '王甲收到工资每月15号前'), false);
});
test('a recurring receipt day cannot be a wage period or a payer-only event', () => {
  assert.equal(date('每月15號', '王甲收到工资每月15號', { meaning: 'wage_period' }), false);
  assert.equal(date('每月15号', '王甲支付工资每月15号'), false);
});
test('a recurring date cannot borrow another owner or turn a collective label into an individual', () => {
  assert.equal(date('每月15號', '李乙收到工资每月15號'), false);
  assert.equal(date('每月15号', '王甲班组收到工资每月15号', { subject: '王甲班组' }), false);
});
test('際 is folded only in an actual wage-receipt cue', () => assert.equal(date('2026年1月15日', '😀王甲實際領取工資2026年1月15日'), true));
test('係 is folded only in the located employment-relationship cue', () => assert.equal(date('2026年1月15日', '😀王甲勞動關係終止2026年1月15日', { meaning: 'employment_period' }), true));
test('traditional date cues retain negation, other-event and wrong-role barriers', () => {
  assert.equal(date('2026年1月15日', '王甲未實際收到工資2026年1月15日'), false);
  assert.equal(date('2026年1月15日', '王甲勞動關係終止2026年1月15日', { meaning: 'payment_date' }), false);
  assert.equal(date('2026年1月15日', '王甲勞動關係終止，李乙收到工資2026年1月15日'), false);
});
test('simplified actual receipt and relationship cues remain controls', () => {
  assert.equal(date('2026年1月15日', '王甲实际收到工资2026年1月15日'), true);
  assert.equal(date('2026年1月15日', '王甲劳动关系终止2026年1月15日', { meaning: 'employment_period' }), true);
});

for (const suffix of ['/小時', '每小時', '/時']) test('a declared supported hour rate recognizes the finite traditional unit: ' + suffix, () => {
  for (const value of ['4000元', '4000元' + suffix]) assert.equal(money(value, '😀王甲工资4000元' + suffix).amount, '4000.00');
});
test('the hour alias never makes a numerator a complete total or the wrong rate unit', () => {
  for (const suffix of ['/小時', '每小時']) {
    assert.equal(money('4000元', '王甲工资4000元' + suffix, { meaning: 'due_total', completeness: 'unknown', rateUnit: null }).amount, null);
    assert.equal(money('4000元', '王甲工资4000元' + suffix, { rateUnit: 'month' }).amount, null);
  }
});
test('hour glyph support retains direct unknown, foreign and cropped-subunit guards', () => {
  for (const text of ['王甲工资4000元/小時待定', '王甲工资港币4000元/小時', '王甲工资4000元5角/小時'])
    assert.equal(money('4000元', text).amount, null);
});
test('simplified hour and unsupported slash denominators remain controls', () => {
  assert.equal(money('4000元', '王甲工资4000元/小时').amount, '4000.00');
  assert.equal(money('4000元', '王甲工资4000元/季度').amount, null);
});

// Evaluate the real helper body with only its imports/platform replaced. This
// exercises platform selection without starting or signalling any OS process;
// it is explicitly not native Windows process-tree acceptance evidence.
const helperSource = await readFile(resolve(ROOT, 'scripts/owned-http-process-group.mjs'), 'utf8');
function controlledHelper(platform) {
  const spawns = [], signals = [];
  const spawn = (command, args, options) => {
    spawns.push({ command, args, options });
    const child = new EventEmitter(); Object.assign(child, { pid: 43210, exitCode: null, signalCode: null, kill: signal => { signals.push(signal); return true; } });
    return child;
  };
  const body = helperSource.replace(/^import[^\n]*\n/gmu, '').replace(/^export /gmu, '');
  const api = vm.runInNewContext(body + '\n;({spawnOwnedChild,signalOwnedChild,stopChild,ownedGroupAlive});',
    { assert, spawn, randomUUID: () => 'synthetic-round31-owner', execFile: () => { throw new Error('Unexpected process-table query in platform-selection fixture'); },
      process: { platform, kill: (...args) => { signals.push(args); } }, setTimeout, clearTimeout, console });
  return { ...api, spawns, signals };
}
test('unsupported Windows cleanup fails before creating any launcher or descendant', () => {
  const helper = controlledHelper('win32');
  assert.throws(() => helper.spawnOwnedChild('synthetic-launcher', ['--synthetic'], { detached: true }), { code: 'ERR_OWNED_HTTP_PLATFORM_UNSUPPORTED' });
  assert.equal(helper.spawns.length, 0); assert.equal(helper.signals.length, 0);
});
test('the supported POSIX path still registers its own detached child', () => {
  const helper = controlledHelper('linux'), child = helper.spawnOwnedChild('synthetic-launcher', [], { detached: false, stdio: 'pipe' });
  assert.equal(helper.spawns.length, 1); assert.equal(helper.spawns[0].options.detached, true); assert.equal(helper.spawns[0].options.stdio, 'pipe');
  helper.signalOwnedChild(child, 'SIGTERM'); assert.deepEqual(helper.signals[0], [-43210, 'SIGTERM']);
});
test('platform handling does not permit signalling an unowned process object', () => {
  const helper = controlledHelper('linux');
  assert.throws(() => helper.signalOwnedChild({ pid: 43210 }, 'SIGKILL'), /runner-owned/u); assert.equal(helper.signals.length, 0);
});
