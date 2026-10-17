import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { createFactInference, createFactJobs } from './fact-jobs.mjs';
import { createMaterialService } from './material-service.mjs';

const source = { id: 'fixture', name: 'controlled fixture', sha256: 'a'.repeat(64), analysisRevision: 1, ready: true, blocks: [{ id: 'b1', page: 1, text: '应发工资5000元，累计已付0元。', bbox: null, confidence: null }] };
const qwen = { backend: 'qwen', python: 'controlled-fixture', modelPath: 'controlled-fixture', integrityDir: 'controlled-fixture' };
const deepseek = { backend: 'deepseek', python: 'controlled-fixture', keyFile: 'controlled-fixture' };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function controlledRunner(readMemory = async () => ({ level: 1, swapUsed: 0 })) {
  let time = 0, nextId = 0;
  const timers = new Map(), children = [];
  const schedule = (callback, delay, repeat = false) => {
    const id = ++nextId; timers.set(id, { callback, at: time + delay, repeat: repeat ? delay : 0 }); return id;
  };
  const inference = createFactInference({
    now: () => time, readMemory,
    scheduleTimeout: (callback, delay) => schedule(callback, delay), cancelTimeout: id => timers.delete(id),
    scheduleInterval: (callback, delay) => schedule(callback, delay, true), cancelInterval: id => timers.delete(id),
    spawnProcess: () => {
      const child = new EventEmitter();
      child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
      child.signals = []; child.kill = signal => { child.signals.push({ signal, at: time }); return true; };
      child.result = (finish = 'stop', raw = 'controlled raw answer') => child.stdout.write(JSON.stringify({ type: 'result', id: source.id, raw_output: raw, model: 'controlled-model', finish_reason: finish }) + '\n');
      child.exit = (code = 0, signal = null) => child.emit('exit', code, signal);
      child.close = (code = 0, signal = null) => { child.exit(code, signal); child.emit('close', code, signal); child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); };
      children.push(child); return child;
    },
  });
  return { inference, children, timers,
    async advance(ms) {
      const end = time + ms;
      for (;;) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at || a[0] - b[0]).find(([, timer]) => timer.at <= end);
        if (!next) break;
        const [id, timer] = next; time = timer.at;
        if (timer.repeat) timer.at += timer.repeat; else timers.delete(id);
        timer.callback(); await flush();
      }
      time = end; await flush();
    },
  };
}

test('Qwen preflight requires normal measurable memory before spawning', async t => {
  for (const sample of [{ level: 2, swapUsed: 0 }, { level: 4, swapUsed: 0 }, { level: 1, swapUsed: NaN }, { level: 0, swapUsed: 0 }, null]) await t.test(String(sample?.level), async () => {
    const runner = controlledRunner(async () => sample);
    await assert.rejects(runner.inference(source, qwen, new AbortController().signal), /内存/);
    assert.equal(runner.children.length, 0); assert.equal(runner.timers.size, 0);
  });
  const runner = controlledRunner(async () => { throw new Error('private diagnostic path'); });
  await assert.rejects(runner.inference(source, qwen, new AbortController().signal), error => !error.message.includes('private') && error.status === 503);
  assert.equal(runner.children.length, 0);
});

test('cancellation during preflight never spawns a late model', async () => {
  let release;
  const runner = controlledRunner(() => new Promise(resolve => { release = resolve; }));
  const controller = new AbortController(), pending = runner.inference(source, qwen, controller.signal);
  controller.abort(); release({ level: 1, swapUsed: 0 });
  await assert.rejects(pending, /取消/); assert.equal(runner.children.length, 0);
  await assert.rejects(runner.inference(source, qwen, controller.signal), /取消/);
});

test('external critical guard covers loading, escalates after 3 seconds, and waits for close', async () => {
  let samples = 0;
  const runner = controlledRunner(async () => ({ level: samples++ === 0 ? 1 : 4, swapUsed: 0 }));
  let settled = false;
  const pending = runner.inference(source, qwen, new AbortController().signal).finally(() => { settled = true; });
  await flush(); const child = runner.children[0];
  await runner.advance(1999); assert.deepEqual(child.signals, []);
  await runner.advance(1); assert.deepEqual(child.signals, [{ signal: 'SIGTERM', at: 2000 }]);
  child.result(); // Even a complete-looking row emitted during shutdown remains unauthorized.
  await runner.advance(2999); assert.equal(child.signals.length, 1); assert.equal(settled, false);
  await runner.advance(1); assert.equal(child.signals[1].signal, 'SIGKILL'); assert.equal(settled, false);
  child.exit(null, 'SIGKILL'); await flush(); assert.equal(settled, false);
  child.close(null, 'SIGKILL');
  assert.equal((await pending).finish_reason, 'external_memory_guard'); assert.equal(runner.timers.size, 0);
});

test('warning must remain continuous for 10 seconds and normal pressure resets it', async () => {
  let level = 1;
  const runner = controlledRunner(async () => ({ level, swapUsed: 0 }));
  const pending = runner.inference(source, qwen, new AbortController().signal); await flush();
  const child = runner.children[0]; level = 2;
  await runner.advance(10_000); assert.equal(child.signals.length, 0);
  level = 1; await runner.advance(2000); level = 2;
  await runner.advance(10_000); assert.equal(child.signals.length, 0);
  await runner.advance(2000); assert.deepEqual(child.signals, [{ signal: 'SIGTERM', at: 24_000 }]);
  child.result('safety_stop', 'partial answer'); child.close(1);
  const result = await pending; assert.equal(result.raw, 'partial answer'); assert.equal(result.finish_reason, 'external_memory_guard');
});

test('swap guard uses pre-spawn baseline and stops only above 4 GiB growth', async () => {
  let swapUsed = 3 * 1024 ** 3;
  const runner = controlledRunner(async () => ({ level: 1, swapUsed }));
  const pending = runner.inference(source, qwen, new AbortController().signal); await flush();
  const child = runner.children[0]; swapUsed += 4 * 1024 ** 3;
  await runner.advance(2000); assert.equal(child.signals.length, 0);
  swapUsed++; await runner.advance(2000); assert.equal(child.signals[0].signal, 'SIGTERM');
  child.close(null, 'SIGTERM'); await assert.rejects(pending, /提取失败/);
});

test('lost monitor fails closed even before any model telemetry', async () => {
  let reads = 0;
  const runner = controlledRunner(async () => { if (reads++) throw new Error('private diagnostic'); return { level: 1, swapUsed: 0 }; });
  const pending = runner.inference(source, qwen, new AbortController().signal); await flush();
  await runner.advance(2000); const child = runner.children[0];
  assert.equal(child.signals[0].signal, 'SIGTERM');
  child.result(); child.close(); assert.equal((await pending).finish_reason, 'monitor_error');
});

test('an in-flight memory sample cannot signal a child after successful exit', async () => {
  let reads = 0, release;
  const runner = controlledRunner(async () => {
    if (!reads++) return { level: 1, swapUsed: 0 };
    return new Promise(resolve => { release = resolve; });
  });
  const pending = runner.inference(source, qwen, new AbortController().signal); await flush();
  await runner.advance(2000); const child = runner.children[0];
  child.result(); child.close(); assert.equal((await pending).finish_reason, 'stop');
  release({ level: 4, swapUsed: 10 * 1024 ** 3 }); await flush();
  await runner.advance(10_000); assert.equal(child.signals.length, 0); assert.equal(runner.timers.size, 0);
});

test('absolute 600-second timeout also bounds the remote backend', async () => {
  const runner = controlledRunner(async () => { throw new Error('remote backend must not inspect local memory'); });
  const pending = runner.inference(source, deepseek, new AbortController().signal);
  const child = runner.children[0];
  await runner.advance(599_999); assert.equal(child.signals.length, 0);
  await runner.advance(1); assert.deepEqual(child.signals, [{ signal: 'SIGTERM', at: 600_000 }]);
  await runner.advance(3000); assert.equal(child.signals[1].signal, 'SIGKILL');
  child.result(); child.close(null, 'SIGKILL'); assert.equal((await pending).finish_reason, 'timeout');
});

test('raw unfinished answers survive and a nonzero exit cannot authorize stop', async () => {
  for (const finish of ['length', 'safety_stop', 'request_error', 'stop']) {
    const runner = controlledRunner();
    const pending = runner.inference(source, deepseek, new AbortController().signal), child = runner.children[0];
    child.result(finish, 'original raw'); child.close(1);
    const result = await pending;
    assert.equal(result.raw, 'original raw'); assert.equal(result.finish_reason, finish === 'stop' ? 'process_error' : finish);
  }
});

test('UTF-8 split across pipe chunks preserves the exact raw Chinese answer', async () => {
  const runner = controlledRunner();
  const pending = runner.inference(source, deepseek, new AbortController().signal), child = runner.children[0];
  const raw = '应发工资5000元，累计已付0元。🧾';
  const row = Buffer.from(JSON.stringify({ type: 'result', id: source.id, raw_output: raw, finish_reason: 'stop' }) + '\n');
  for (let i = 0; i < row.length; i++) child.stdout.write(row.subarray(i, i + 1));
  child.close();
  const result = await pending;
  assert.equal(result.raw, raw); assert.equal(result.finish_reason, 'stop'); assert.equal(child.signals.length, 0);
});

test('decoded Chinese output still obeys the byte limit instead of a character limit', async () => {
  const runner = controlledRunner();
  const pending = runner.inference(source, deepseek, new AbortController().signal), child = runner.children[0];
  child.stdout.write('工'.repeat(333_334));
  assert.equal(child.signals[0].signal, 'SIGTERM');
  child.close(null, 'SIGTERM'); await assert.rejects(pending, /提取失败/);
});

test('output limit terminates with the same grace period and never exposes stderr', async () => {
  const runner = controlledRunner();
  const pending = runner.inference(source, deepseek, new AbortController().signal), child = runner.children[0];
  child.stderr.write('private diagnostic path'); child.stdout.write('x'.repeat(1_000_001));
  assert.equal(child.signals[0].signal, 'SIGTERM');
  await runner.advance(3000); assert.equal(child.signals[1].signal, 'SIGKILL');
  child.close(null, 'SIGKILL'); await assert.rejects(pending, error => !error.message.includes('private') && error.status === 503);
});

test('a missing executable rejects only after close and releases queue ownership', async () => {
  const inference = createFactInference();
  const jobs = createFactJobs({ ...deepseek, python: '/controlled-fixture/no-such-executable' }, inference);
  try {
    const first = jobs.submit({ source }).jobId, second = jobs.submit({ source }).jobId;
    for (let i = 0; i < 100 && jobs.get(second)?.status === 'running'; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(jobs.get(first)?.status, 'failed'); assert.equal(jobs.get(second)?.status, 'failed');
    assert.ok(!jobs.get(first).error.message.includes('/controlled-fixture'));
  } finally { await jobs.close(); }
});

test('queue cancel and close hold ownership until the process actually closes', async () => {
  const runner = controlledRunner(), jobs = createFactJobs(deepseek, runner.inference);
  const first = jobs.submit({ source }).jobId, second = jobs.submit({ source }).jobId;
  let cancelled = false;
  const cancellation = jobs.cancel(first).then(() => { cancelled = true; });
  await runner.advance(3000); assert.equal(runner.children.length, 1); assert.equal(cancelled, false);
  runner.children[0].exit(null, 'SIGKILL'); await flush(); assert.equal(runner.children.length, 1);
  runner.children[0].close(null, 'SIGKILL'); await cancellation;
  assert.equal(runner.children.length, 2); assert.equal(jobs.get(first), null);
  let closed = false;
  const closing = jobs.close().then(() => { closed = true; });
  await runner.advance(3000); assert.equal(closed, false); assert.equal(runner.children[1].signals[1].signal, 'SIGKILL');
  runner.children[1].close(null, 'SIGKILL'); await closing; assert.equal(jobs.get(second), null);
});

test('real child ignoring SIGTERM exits before cancellation permits the next process', { timeout: 12_000 }, async () => {
  let first, starts = 0, ready;
  const readyPromise = new Promise(resolve => { ready = resolve; });
  const inference = createFactInference({ spawnProcess: (_, __, options) => {
    starts++;
    if (starts > 1) assert.equal(first.signalCode, 'SIGKILL');
    const script = starts === 1
      ? "process.on('SIGTERM',()=>{});process.stdin.resume();process.stdout.write('fixture-ready\\n');setInterval(()=>{},1000)"
      : "let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{const r=JSON.parse(input);process.stdout.write(JSON.stringify({type:'result',id:r.id,raw_output:'controlled raw',finish_reason:'stop'})+'\\n')})";
    const child = spawn(process.execPath, ['-e', script], options);
    if (starts === 1) { first = child; child.stdout.once('data', ready); }
    return child;
  } });
  const jobs = createFactJobs(deepseek, inference);
  try {
    const firstId = jobs.submit({ source }).jobId; await readyPromise;
    const secondId = jobs.submit({ source }).jobId, started = performance.now();
    await jobs.cancel(firstId);
    assert.ok(performance.now() - started >= 2800); assert.equal(first.signalCode, 'SIGKILL'); assert.equal(starts, 2);
    for (let i = 0; i < 100 && jobs.get(secondId)?.status === 'running'; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(jobs.get(secondId)?.status, 'ready'); assert.equal(jobs.get(secondId).result.raw, 'controlled raw');
  } finally { await jobs.close(); }
});
test('fact queue rejects caller-controlled backend and preserves rule candidates', async () => {
  const jobs = createFactJobs();
  assert.throws(() => jobs.submit({ source, backend: 'deepseek' }));
  assert.throws(() => jobs.submit({ source: { ...source, blocks: [{ ...source.blocks[0], text: 'a'.repeat(24001) }] } }));
  const { jobId } = jobs.submit({ source });
  const job = jobs.get(jobId);
  assert.equal(job.status, 'ready');
  assert.equal(job.result.finish_reason, 'stop');
  assert.equal(JSON.parse(job.result.raw).candidates[1].value, '0元');
  await jobs.cancel(jobId); assert.equal(jobs.get(jobId), null);
  await jobs.close();
});
test('bounded queue cancellation discards late results and unblocks shutdown', async () => {
  let cancelled = 0;
  const jobs = createFactJobs({ backend: 'qwen', python: 'fixture', modelPath: 'fixture', integrityDir: 'fixture' }, async (_, __, signal) => new Promise((resolve) => { signal.addEventListener('abort', () => { cancelled++; resolve({ raw: 'late', backend: 'qwen', model: 'fixture' }); }, { once: true }); }));
  const ids = [1, 2, 3].map(() => jobs.submit({ source }).jobId);
  assert.throws(() => jobs.submit({ source }), /队列/);
  await jobs.cancel(ids[0]); assert.equal(jobs.get(ids[0]), null);
  await jobs.close(); assert.equal(cancelled, 2);
  ids.forEach(id => assert.equal(jobs.get(id), null));
});
test('real loopback fact HTTP requires token, blocks browser and arbitrary model config', async () => {
  const token = 'controlled-test-token'.repeat(3), service = await createMaterialService({ token });
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  try {
    assert.equal((await fetch(`${service.url}/fact-jobs`, { method: 'POST', body: '{}' })).status, 401);
    assert.equal((await fetch(`${service.url}/fact-jobs`, { method: 'POST', headers: { ...headers, Origin: 'https://other.invalid' }, body: '{}' })).status, 403);
    const health = await (await fetch(`${service.url}/health`, { headers })).json();
    assert.equal(health.capabilities.factBackend, 'rules');
    const bad = await fetch(`${service.url}/fact-jobs`, { method: 'POST', headers, body: JSON.stringify({ source, model: 'other' }) });
    assert.equal(bad.status, 400);
    const submitted = await fetch(`${service.url}/fact-jobs`, { method: 'POST', headers, body: JSON.stringify({ source }) });
    assert.equal(submitted.status, 202);
    const { jobId } = await submitted.json();
    const result = await (await fetch(`${service.url}/fact-jobs/${jobId}`, { headers })).json();
    assert.equal(result.status, 'ready');
    assert.equal((await fetch(`${service.url}/fact-jobs/${jobId}`, { method: 'DELETE', headers })).status, 200);
    assert.equal((await fetch(`${service.url}/fact-jobs/${jobId}`, { headers })).status, 404);
  } finally { await service.close(); }
});
