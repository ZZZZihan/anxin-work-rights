import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? fileURLToPath(new URL('../', import.meta.url)));
const E = 'experiments/material-facts-v7';
const source = await readFile(resolve(ROOT, E, 'verify.mjs'), 'utf8');
const body = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert(from >= 0 && to > from);
  return source.slice(from, to);
};
// Exact production checker bodies; no preflight, scorer, model or historical CLI.
const same = (a, b, message) => assert.deepEqual(a, b, message);
const checkOutcome = new Function('assert', 'prefix', 'same', body('function checkOutcome(', '\nfunction checkEvents(') + '\nreturn checkOutcome;')(
  assert, (a, b) => a.every((x, i) => x === b[i]), same);
const checkEvents = new Function('assert', 'same', body('function checkEvents(', '\nfunction checkQwen(') + '\nreturn checkEvents;')(assert, same);
const { publishImmutableFile } = await import(pathToFileURL(resolve(ROOT, E, 'immutable-artifact-publication.mjs')));
const stopped = () => ({ ids: ['later'], completed: false, stop_reason: 'initial_memory_state',
  worker_started: false, stdout_state: 'not_started', incomplete_stdout: false });

test('a later pre-spawn guard preserves earlier genuine output without claiming full completion', () => {
  const row = { id: 'earlier', type: 'result', finish_reason: 'stop', output: 'preserved earlier output' };
  const outcome = { completed: false, attempts: [
    { ids: ['earlier'], completed: true, code: 0, signal: null, stop_reason: null, incomplete_stdout: false }, stopped(),
  ] };
  assert.doesNotThrow(() => checkOutcome('qwen', outcome, [row], ['earlier', 'later']));
  assert.doesNotThrow(() => checkEvents('qwen', [row], [row], outcome, ['earlier', 'later']));
  assert.equal(outcome.completed, false);
  assert.equal(row.output, 'preserved earlier output');
});

test('pre-spawn fields cannot authorize completion, another backend, results or events', () => {
  const ids = ['later'];
  for (const mutation of [
    attempt => { attempt.completed = true; },
    attempt => { attempt.worker_started = true; },
    attempt => { delete attempt.stdout_state; },
    attempt => { attempt.signal = null; },
    attempt => { delete attempt.incomplete_stdout; },
  ]) {
    const attempt = stopped(); mutation(attempt);
    assert.throws(() => checkOutcome('qwen', { completed: false, attempts: [attempt] }, [], ids));
  }
  assert.throws(() => checkOutcome('deepseek', { completed: false, attempts: [stopped()] }, [], ids));
  const outcome = { completed: false, attempts: [stopped()] };
  assert.throws(() => checkOutcome('qwen', outcome, [{ id: 'later', finish_reason: 'stop' }], ids));
  assert.throws(() => checkEvents('qwen', [{ id: 'later', type: 'load' }], [], outcome, ids));
});

test('concurrent publication has one complete winner and cannot follow an existing target symlink', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'anxin-r41-independent-publication-'));
  try {
    const target = join(directory, 'result-manifest.json');
    const payloads = [Buffer.alloc(131072, 65), Buffer.alloc(131072, 66)];
    const results = await Promise.allSettled(payloads.map(bytes => publishImmutableFile(target, bytes)));
    assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
    const failed = results.find(x => x.status === 'rejected');
    assert.equal(failed.reason.code, 'EEXIST');
    const winner = results.findIndex(x => x.status === 'fulfilled');
    assert.deepEqual(await readFile(target), payloads[winner]);
    assert.equal((await readdir(directory)).filter(x => x.endsWith('.stage')).length, 1, 'Losing stage stays diagnostic evidence');
    await assert.rejects(publishImmutableFile(target, 'replacement'), { code: 'EEXIST' });
    assert.deepEqual(await readFile(target), payloads[winner]);

    await mkdir(join(directory, 'external'));
    const external = join(directory, 'external/victim');
    await writeFile(external, 'unchanged external target');
    const link = join(directory, 'linked-result.json');
    await symlink(external, link);
    await assert.rejects(publishImmutableFile(link, 'must not replace or follow'), { code: 'EEXIST' });
    assert.equal(await readFile(external, 'utf8'), 'unchanged external target');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
