import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { same } from '../experiments/material-facts-v7/freeze.mjs';

// Exercise the actual private outcome validator, unchanged, with its pure
// dependencies. No verifier gate is mocked and no production visibility is added.
const source = await readFile(new URL('../experiments/material-facts-v7/verify.mjs', import.meta.url), 'utf8');
const start = source.indexOf('function checkOutcome('), end = source.indexOf('\nfunction checkEvents(', start);
assert(start >= 0 && end > start, 'The actual outcome validator must be available');
const checkOutcome = new Function('assert', 'same', 'prefix', source.slice(start, end) + '\nreturn checkOutcome;')(
  assert, same, (ids, expected) => ids.every((id, index) => id === expected[index]));
const ids = ['synthetic-a'], rows = [{ id: ids[0], finish_reason: 'stop' }];
function receipt(backend, changes = {}) {
  return { completed: changes.completed ?? true,
    isolation: backend === 'qwen' ? 'fresh_process_per_document' : 'sequential_requests',
    attempts: [{ ids, code: 0, signal: null, stop_reason: null, completed: true, incomplete_stdout: false, ...changes }] };
}
for (const backend of ['qwen', 'deepseek']) {
  test(`${backend} complete newline-terminated stream remains verifiable`, () => {
    assert.doesNotThrow(() => checkOutcome(backend, receipt(backend), rows, ids));
  });
  for (const completed of [true, false]) test(`${backend} incomplete stream is rejected even when completed=${completed}`, () => {
    assert.throws(() => checkOutcome(backend, receipt(backend, { incomplete_stdout: true, completed,
      ...(completed ? {} : { stop_reason: 'incomplete_stdout' }) }), rows, ids), /incomplete|truncated|stdout/u);
  });
  test(`${backend} missing stream-completeness evidence is rejected`, () => {
    const value = receipt(backend); delete value.attempts[0].incomplete_stdout;
    assert.throws(() => checkOutcome(backend, value, rows, ids), /incomplete|truncated|stdout/u);
  });
  test(`${backend} a non-stream process failure remains a preserved failed receipt`, () => {
    assert.doesNotThrow(() => checkOutcome(backend, receipt(backend, { code: 7, completed: false }), rows, ids));
  });
}
