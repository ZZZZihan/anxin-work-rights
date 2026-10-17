import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execute = promisify(execFile);
const runner = pathToFileURL(realpathSync(fileURLToPath(process.env.ANXIN_RUNNER_UNDER_TEST ?? new URL('../experiments/material-facts-v4/run.mjs', import.meta.url)))).href;

// Import the actual CLI with in-memory I/O and a controlled child. No dataset,
// credentials, Python, model, or network request is used, and no file is written.
const fixture = String.raw`
import { registerHooks } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const [runner, scenario] = process.argv.slice(1);
const out = resolve('/virtual/fact-runner-output');
const files = new Map();
const operations = [];
const signals = [];
let appendFailed = false, closed = false, exitAt = null, closeAt = null;
let spawned = 0;
const inputs = [{ id: 'synthetic-controlled-a', source: {} }];
const first = { type: 'result', id: inputs[0].id, raw_output: '{"candidates":[]}', finish_reason: 'stop' };
const unicode = '应发工资5000元😀';
if (scenario === 'utf8') first.raw_output = JSON.stringify({ candidates: [], transport_fixture: unicode });
const late = { ...first, id: 'synthetic-controlled-late' };
const emit = row => child.stdout.write(JSON.stringify(row) + '\n');
const child = new EventEmitter();
child.stdout = new PassThrough(); child.stderr = new PassThrough();
child.stdin = new Writable({ write(chunk, encoding, done) { done(); } });
child.stdin.on('finish', () => setImmediate(() => {
  if (scenario === 'utf8') {
    for (const byte of Buffer.from(JSON.stringify(first) + '\n')) child.stdout.write(Buffer.from([byte]));
    for (const byte of Buffer.from(unicode)) child.stderr.write(Buffer.from([byte]));
    setTimeout(() => {
      exitAt = Date.now(); child.emit('exit', 0, null);
      setTimeout(() => { closed = true; closeAt = Date.now(); child.emit('close', 0, null); }, 70);
    }, 10);
  } else if (scenario === 'parse') {
    emit(first);
    child.stdout.write('{invalid-json\n');
    emit(late);
  } else if (scenario === 'stdout-write') {
    emit(first); emit(late);
  } else {
    emit(first); child.stderr.write('controlled-stderr'); emit(late);
  }
}));
child.kill = signal => {
  signals.push({ signal, at: Date.now() });
  if (signal === 'SIGTERM' && scenario === 'parse') return true; // Require KILL.
  if (exitAt !== null) return true;
  setTimeout(() => {
    exitAt = Date.now(); child.emit('exit', null, signal);
    // A separate close event proves the runner does not release on exit alone.
    setTimeout(() => { closed = true; closeAt = Date.now(); child.emit('close', null, signal); }, 70);
  }, 10);
  return true;
};

const io = {
  readFile: async path => String(path).endsWith('/inputs.jsonl')
    ? Buffer.from(inputs.map(row => JSON.stringify(row)).join('\n') + '\n') : Buffer.from('controlled-source-bytes'),
  mkdir: async () => {},
  writeFile: async (path, bytes) => {
    operations.push({ type: 'write', path, closed, at: Date.now() }); files.set(path, Buffer.from(bytes));
  },
  appendFile: async (path, bytes) => {
    operations.push({ type: 'append', path, closed, at: Date.now() });
    const shouldFail = scenario === 'stdout-write' ? path.endsWith('/events.jsonl') : scenario === 'stderr-write' && path.endsWith('/worker.log');
    if (shouldFail && !appendFailed) { appendFailed = true; throw new Error('controlled-write-failure'); }
    files.set(path, Buffer.concat([files.get(path) ?? Buffer.alloc(0), Buffer.from(bytes)]));
  },
};
const workers = {
  spawn: () => { spawned++; return child; },
  execFile: (command, args, options, callback) => callback(null, args[1] === 'vm.swapusage' ? 'used = 0M' : '1', ''),
};
// Match the promisified shape returned by the real child_process.execFile.
workers.execFile[Symbol.for('nodejs.util.promisify.custom')] = async (command, args) => ({ stdout: args[1] === 'vm.swapusage' ? 'used = 0M' : '1', stderr: '' });
globalThis.runnerFixture = { io, workers };
const mocks = {
  'node:fs/promises': 'const v = globalThis.runnerFixture.io; export const { readFile, mkdir, writeFile, appendFile } = v;',
  'node:child_process': 'const v = globalThis.runnerFixture.workers; export const { spawn, execFile } = v;',
  '../../lib/material-facts.ts': 'export const buildExtractionMessages = () => []; export const extractRuleCandidates = () => "{}";',
};
registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL === runner && mocks[specifier]) return { url: 'data:text/javascript,' + encodeURIComponent(mocks[specifier]), shortCircuit: true };
  return nextResolve(specifier, context);
} });
process.argv = [process.execPath, runner, '--backend', 'qwen', '--out', out, '--inputs', '/virtual/inputs.jsonl', '--model-path', '/virtual/model', '--integrity-dir', '/virtual/integrity'];
await import(runner);
const runExitCode = process.exitCode;
const outcome = JSON.parse(files.get(resolve(out, 'outcome.json')));
const rows = (files.get(resolve(out, 'results.jsonl')) ?? '').toString().trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
assert.equal(spawned, 1);
assert.equal(closed, true);
if (scenario === 'utf8') {
  assert.equal(runExitCode, 0);
  assert.equal(outcome.completed, true);
  assert.equal(outcome.attempts[0].completed, true);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].raw_output, first.raw_output);
  assert.equal(rows[0].finish_reason, 'stop');
  assert.equal(files.get(resolve(out, 'worker.log')).toString(), unicode);
  assert.deepEqual(signals, []);
} else {
assert.equal(runExitCode, 1);
assert.equal(outcome.completed, false);
assert.equal(outcome.attempts[0].completed, false);
assert.equal(outcome.attempts[0].stop_reason, 'worker_output_error');
assert.equal(outcome.attempts[0].output_error_type, scenario === 'parse' ? 'SyntaxError' : 'Error');
assert(rows.every(row => row.id === first.id && row.finish_reason === 'worker_output_error'));
assert.equal(rows.length, scenario === 'stdout-write' ? 0 : 1);
assert.equal(signals[0].signal, 'SIGTERM');
if (scenario === 'parse') {
  const escalation = signals.find(row => row.signal === 'SIGKILL');
  assert(escalation);
  assert(escalation.at - signals[0].at >= 2800);
}
}
assert(closeAt >= exitAt + 60);
assert(operations.filter(row => row.path.endsWith('/outcome.json')).every(row => row.closed && row.at >= closeAt));
assert(operations.filter(row => row.type === 'append' && row.path.endsWith('/results.jsonl')).every(row => row.closed));
process.exitCode = 0;
console.log(JSON.stringify({ scenario, status: 'PASS', worker_closed: closed, outcome_completed: outcome.completed, run_exit_code: runExitCode, result_rows: rows.length, signals: signals.map(row => row.signal) }));
`;

for (const scenario of ['parse', 'stdout-write', 'stderr-write', 'utf8']) {
  test(scenario === 'utf8' ? 'runner preserves stdout and stderr UTF-8 across byte boundaries' : `runner waits for close and records failure after ${scenario} error`, { timeout: 10_000 }, async () => {
    const { stdout, stderr } = await execute(process.execPath, ['--unhandled-rejections=strict', '--input-type=module', '-e', fixture, runner, scenario], { timeout: 9000, maxBuffer: 100_000 }).catch(error => {
      assert.fail(JSON.stringify({ scenario, exit_code: error.code, stdout: error.stdout, stderr: error.stderr }));
    });
    assert.equal(stderr, '');
    const report = JSON.parse(stdout.trim().split('\n').at(-1));
    assert.equal(report.status, 'PASS');
    assert.equal(report.worker_closed, true);
  });
}
