import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCandidateEvent, assessCase } from '../experiments/material-facts-v7/assess.mjs';

const inner = '2026年1月';
const cp = value => Array.from(value).length;
const modes = ['raw_basic', 'raw_relational', 'raw_strict', 'accepted_basic', 'accepted_relational', 'accepted_strict'];
function fixture(value, { anchorValue = inner, suffix = '' } = {}) {
  const text = `😀王甲${value}任职。${suffix}`;
  const candidate = { kind: 'date', value, quote: text, blockId: 'b1', subject: '王甲', scope: 'individual', meaning: 'employment_period', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated' };
  const start = cp(text.slice(0, text.indexOf(anchorValue)));
  return { candidate, input: { id: 'r37-synthetic', source: { id: 'r37-source', name: 'synthetic.txt', sha256: 'a'.repeat(64), analysisRevision: 1, ready: true, blocks: [{ id: 'b1', page: 1, text }] } },
    label: { id: 'r37-synthetic', schemaVersion: 3, label_status: 'provisional_non_expert', expected: [candidate], expected_event_ids: ['employment'], acceptable_alternatives: [], events: [{ id: 'employment', anchors: [{ blockId: 'b1', start, end: start + cp(anchorValue) }] }] } };
}
const boundaries = [
  ...['以前', '以后', '之前', '之后', '为止', '以後', '之後', '為止'].map(suffix => `${inner}${suffix}`),
  ...['自', '从', '從', '截至', '截止至', '截止到', '截止', '到', '至'].map(prefix => `${prefix}${inner}`),
  `截止至${inner}为止`, `從${inner}之後`,
];
for (const value of boundaries) test(`finite date boundary aligns while raw literal remains unchanged: ${value}`, () => {
  const fx = fixture(value), before = structuredClone(fx);
  assert.deepEqual(resolveCandidateEvent(fx.candidate, fx.input, fx.label), { status: 'aligned', event: 'employment', positions: [{ blockId: 'b1', start: cp('😀王甲'), end: cp('😀王甲' + value) }] });
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [fx.candidate] });
  const result = { finish_reason: 'stop', raw_output: raw };
  const row = assessCase(fx.input, fx.label, result);
  for (const mode of modes) assert.deepEqual([row[mode].tp, row[mode].fp, row[mode].fn], [1, 0, 0], mode);
  assert.equal(result.raw_output, raw); assert.deepEqual(fx, before);
});
for (const value of [`${inner}以前`, `截至${inner}为止`, `從${inner}之後`]) {
  test(`inner date can align to its complete registered wrapper: ${value}`, () => {
    const fx = fixture(value, { anchorValue: value }); fx.candidate.value = inner;
    assert.equal(resolveCandidateEvent(fx.candidate, fx.input, fx.label).status, 'aligned');
  });
  test(`boundary alignment cannot make the cropped date equal: ${value}`, () => {
    const fx = fixture(value); fx.label.expected = [{ ...fx.candidate, value: inner }];
    const labelBefore = structuredClone(fx.label);
    const row = assessCase(fx.input, fx.label, { finish_reason: 'stop', raw_output: JSON.stringify({ schemaVersion: 3, candidates: [fx.candidate] }) });
    for (const mode of modes) assert.deepEqual([row[mode].tp, row[mode].fp, row[mode].fn], [0, 1, 1]);
    assert.deepEqual(fx.label, labelBefore);
  });
  test(`same date at two real positions cannot borrow one event: ${value}`, () => {
    const fx = fixture(value, { suffix: `王乙${value}任职。` }); fx.candidate.quote = value;
    const start = cp(fx.input.source.blocks[0].text.slice(0, fx.input.source.blocks[0].text.lastIndexOf(inner)));
    fx.label.events.push({ id: 'other-employment', anchors: [{ blockId: 'b1', start, end: start + cp(inner) }] });
    assert.equal(resolveCandidateEvent(fx.candidate, fx.input, fx.label).status, 'ambiguous_event');
  });
  test(`unregistered second occurrence blocks attribution: ${value}`, () => {
    const fx = fixture(value, { suffix: `王乙${value}任职。` }); fx.candidate.quote = value;
    assert.equal(resolveCandidateEvent(fx.candidate, fx.input, fx.label).status, 'unregistered_position');
  });
}
for (const value of [`此前${inner}`, `根据${inner}之前`, `${inner}以后另付4000元`, `${inner}之前之后`, `到另一人${inner}`, `截止${inner}至2026年2月`]) test(`unsupported narrative cannot expand event anchor: ${value}`, () => {
  const fx = fixture(value); assert.equal(resolveCandidateEvent(fx.candidate, fx.input, fx.label).status, 'unregistered_position');
});
test('date-only boundary grammar never expands monetary event anchors', () => {
  const fx = fixture('截止4000元为止', { anchorValue: '4000元' });
  Object.assign(fx.candidate, { kind: 'money', meaning: 'payment', completeness: 'partial' });
  assert.equal(resolveCandidateEvent(fx.candidate, fx.input, fx.label).status, 'unregistered_position');
});
