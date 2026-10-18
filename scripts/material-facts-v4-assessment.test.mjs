import test from 'node:test';
import assert from 'node:assert/strict';
import { assessCase, matchCandidates } from '../experiments/material-facts-v4/assess.mjs';

// Review regression only: exercise the frozen assessor without editing its
// code, historical raw answers, manifests, or recorded scores.
const source = {
  id: 'independent-assessment-source', name: 'synthetic.txt', sha256: 'a'.repeat(64),
  analysisRevision: 1, ready: true,
  blocks: [{ id: 'b1', page: 1, text: '张三2024年7月完整应付工资8000元。' }],
};
const expected = {
  kind: 'due_total', value: '8000元', quote: '8000元', blockId: 'b1',
  subject: '张三', period: '2024年7月', qualifier: 'gross', assertion: 'narrated',
};
const input = { id: 'independent-assessment-case', source };
const label = { id: input.id, expected: [expected] };
const malformed = [null, 1, '8000元', true, [], {}];
const result = (candidates, finish_reason = 'stop') => ({
  id: input.id, raw_output: JSON.stringify({ candidates }), finish_reason,
});

for (const candidate of malformed) {
  test(`frozen v4 assessor retains ${JSON.stringify(candidate)} as a raw false positive`, () => {
    const row = assessCase(input, label, result([candidate]));
    assert.deepEqual([row.raw_basic.tp, row.raw_basic.fp, row.raw_basic.fn], [0, 1, 1]);
    assert.deepEqual([row.accepted_strict.tp, row.accepted_strict.fp, row.accepted_strict.fn], [0, 0, 1]);
    assert.equal(row.raw_count, 1);
    assert.equal(row.accepted_count, 0);
    assert.deepEqual(row.rejected.map(item => item.index), [0]);
    assert.equal(row.exact_document, false);
  });
}

for (const invalidFirst of [true, false]) {
  test(`malformed candidates do not discard a valid later/earlier answer: invalidFirst=${invalidFirst}`, () => {
    const candidates = invalidFirst ? [...malformed, expected] : [expected, ...malformed];
    const original = structuredClone({ input, label, candidates });
    const output = result(candidates);
    const raw = output.raw_output;
    const row = assessCase(input, label, output);
    assert.deepEqual([row.raw_basic.tp, row.raw_basic.fp, row.raw_basic.fn], [1, malformed.length, 0]);
    assert.deepEqual([row.accepted_strict.tp, row.accepted_strict.fp, row.accepted_strict.fn], [1, 0, 0]);
    assert.equal(row.accepted_count, 1);
    assert.deepEqual(row.rejected.map(item => item.index), malformed.map((_, i) => i + (invalidFirst ? 0 : 1)));
    assert.deepEqual({ input, label, candidates }, original);
    assert.equal(output.raw_output, raw);
    assert.equal(row.exact_document, false);
  });
}

test('raw malformed observations remain false positives with an empty gold set', () => {
  const row = assessCase(input, { id: input.id, expected: [] }, result(malformed));
  assert.deepEqual([row.raw_basic.tp, row.raw_basic.fp, row.raw_basic.fn], [0, malformed.length, 0]);
  assert.equal(row.rejected.length, malformed.length);
  assert.equal(row.exact_document, false);
});

test('a non-stop answer cannot count as accepted business facts', () => {
  const row = assessCase(input, label, result([null, expected], 'length'));
  assert.deepEqual([row.raw_basic.tp, row.raw_basic.fp, row.raw_basic.fn], [1, 1, 0]);
  assert.deepEqual([row.accepted_strict.tp, row.accepted_strict.fp, row.accepted_strict.fn], [0, 0, 1]);
  assert.equal(row.completed, false);
  assert.equal(row.exact_document, false);
});

test('all valid gold categories short-circuit non-object raw candidates', () => {
  const kinds = ['worker', 'employer', 'period', 'monthly_rate', 'due_total', 'paid_total', 'arrears', 'award', 'payment', 'other_amount'];
  for (const kind of kinds) {
    const row = assessCase(input, { id: input.id, expected: [{ ...expected, kind }] }, result(malformed));
    assert.deepEqual([row.raw_basic.tp, row.raw_basic.fp, row.raw_basic.fn], [0, malformed.length, 1]);
  }
});

test('maximum matching does not let duplicates inflate recall', () => {
  const row = matchCandidates([expected, expected], label, (a, b) => a.kind === b.kind && a.value === b.value);
  assert.deepEqual([row.tp, row.fp, row.fn], [1, 1, 0]);
});
