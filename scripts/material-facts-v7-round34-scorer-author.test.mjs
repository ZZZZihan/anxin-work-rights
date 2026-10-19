import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCandidateEvent, assessCase } from '../experiments/material-facts-v7/assess.mjs';
const modes = ['raw_basic', 'raw_relational', 'raw_strict', 'accepted_basic', 'accepted_relational', 'accepted_strict'];
const inner = '2026年1月';
const cp = text => Array.from(text).length;
function fixture(value, { suffix = '', anchorValue = inner } = {}) {
  const text = `😀王甲${value}任职。${suffix}`;
  const source = { id: 'r34-source', name: 'synthetic.txt', sha256: 'a'.repeat(64), analysisRevision: 1, ready: true, blocks: [{ id: 'b1', page: 1, text }] };
  const candidate = { kind: 'date', value, quote: text, blockId: 'b1', subject: '王甲', scope: 'individual', meaning: 'employment_period', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated' };
  const start = cp(text.slice(0, text.indexOf(anchorValue)));
  return { input: { id: 'r34-date', source }, candidate, label: { id: 'r34-date', schemaVersion: 3, label_status: 'provisional_non_expert', expected: [candidate], expected_event_ids: ['employment'], acceptable_alternatives: [], events: [{ id: 'employment', anchors: [{ blockId: 'b1', start, end: start + cp(anchorValue) }] }] } };
}
for (const value of [`從${inner}起`, `${inner}後`, `${inner}間`, `${inner}期間`, `從${inner}後`, `从${inner}起`, `${inner}后`, `${inner}间`, `${inner}期间`, `自${inner}止`]) {
  test(`source-only date wrapper aligns without changing value or code points: ${value}`, () => {
    const fx = fixture(value), before = structuredClone(fx);
    const resolved = resolveCandidateEvent(fx.candidate, fx.input, fx.label);
    assert.equal(resolved.status, 'aligned'); assert.equal(resolved.event, 'employment');
    assert.deepEqual(resolved.positions, [{ blockId: 'b1', start: cp('😀王甲'), end: cp('😀王甲' + value) }]);
    const result = { id: fx.input.id, finish_reason: 'stop', raw_output: JSON.stringify({ schemaVersion: 3, candidates: [fx.candidate] }) };
    const raw = result.raw_output, row = assessCase(fx.input, fx.label, result);
    for (const mode of modes) assert.deepEqual([row[mode].tp, row[mode].fp, row[mode].fn], [1, 0, 0], mode);
    assert.equal(result.raw_output, raw); assert.deepEqual(fx, before);
  });
}
for (const value of [`根據${inner}起`, `從其他工作${inner}起`, `${inner}後另付4000元`]) {
  test(`arbitrary narrative cannot borrow a date anchor: ${value}`, () => {
    const fx = fixture(value); assert.equal(resolveCandidateEvent(fx.candidate, fx.input, fx.label).status, 'unregistered_position');
  });
}
test('a repeated traditional wrapper in two events remains ambiguous', () => {
  const value = `從${inner}起`, fx = fixture(value, { suffix: `王乙${value}任职。` });
  fx.candidate.quote = value;
  const start = cp(fx.input.source.blocks[0].text.slice(0, fx.input.source.blocks[0].text.lastIndexOf(inner)));
  fx.label.events.push({ id: 'other-employment', anchors: [{ blockId: 'b1', start, end: start + cp(inner) }] });
  assert.equal(resolveCandidateEvent(fx.candidate, fx.input, fx.label).status, 'ambiguous_event');
});
test('an unregistered repeated traditional date cannot borrow the registered event', () => {
  const value = `${inner}後`, fx = fixture(value, { suffix: `王乙${value}任职。` });
  fx.candidate.quote = value;
  assert.equal(resolveCandidateEvent(fx.candidate, fx.input, fx.label).status, 'unregistered_position');
});
test('traditional wrapper also works around an inner candidate in an outer registered anchor', () => {
  const value = `從${inner}起`, fx = fixture(value, { anchorValue: value }); fx.candidate.value = inner;
  assert.equal(resolveCandidateEvent(fx.candidate, fx.input, fx.label).status, 'aligned');
});
test('alignment fold does not introduce date value aliases or edit gold', () => {
  const value = `從${inner}起`, fx = fixture(value); fx.label.expected = [{ ...fx.candidate, value: inner }];
  const before = structuredClone(fx.label);
  const row = assessCase(fx.input, fx.label, { finish_reason: 'stop', raw_output: JSON.stringify({ schemaVersion: 3, candidates: [fx.candidate] }) });
  for (const mode of modes) assert.deepEqual([row[mode].tp, row[mode].fp, row[mode].fn], [0, 1, 1], mode);
  assert.deepEqual(fx.label, before);
});
test('date wrapper folding cannot expand money containment', () => {
  const fx = fixture('從1000元後', { anchorValue: '1000元' });
  Object.assign(fx.candidate, { kind: 'money', meaning: 'payment', completeness: 'partial' });
  assert.equal(resolveCandidateEvent(fx.candidate, fx.input, fx.label).status, 'unregistered_position');
});
