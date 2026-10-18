import { createHash, randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { buildExtractionMessages, extractRuleCandidates, validateFactSource } from '../lib/material-facts.ts';

const ttl = 5 * 60_000;
// Three admitted jobs can each own the model for ten minutes. Keep retired
// caller IDs longer than that entire lifecycle, without retaining source text.
const replayTtl = 31 * 60_000;
const maxIds = 1024;
const fail = (message, status = 400) => Object.assign(new Error(message), { status, code: 'FACT_JOB_FAILED' });
export const isFactJobId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
function sourceFingerprint(source) {
  const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
  return createHash('sha256').update(JSON.stringify(ordered(source))).digest('hex');
}

const execute = promisify(execFile);
async function readMacMemory() {
  const [pressure, swap] = await Promise.all([
    execute('sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'], { timeout: 2000, maxBuffer: 4096 }),
    execute('sysctl', ['-n', 'vm.swapusage'], { timeout: 2000, maxBuffer: 4096 }),
  ]);
  const match = /used\s*=\s*([\d.]+)([MG])/.exec(swap.stdout);
  return { level: Number(pressure.stdout.trim()), swapUsed: match ? Number(match[1]) * (match[2] === 'G' ? 1024 ** 3 : 1024 ** 2) : NaN };
}
function validateMemory(sample) {
  if (!sample || ![1, 2, 4].includes(sample.level) || !Number.isFinite(sample.swapUsed) || sample.swapUsed < 0) throw new Error('Invalid memory sample');
  return sample;
}

/** Fixed production limits; injectable process/clock boundaries allow tests without loading a model. */
export function createFactInference({ spawnProcess = spawn, readMemory = readMacMemory, now = Date.now,
  scheduleTimeout = setTimeout, cancelTimeout = clearTimeout, scheduleInterval = setInterval, cancelInterval = clearInterval } = {}) {
  return async (source, config, signal) => {
    if (signal.aborted) throw fail('候选提取已取消。', 503);
    let initialSwap = null;
    if (config.backend === 'qwen') {
      try {
        const initial = validateMemory(await readMemory());
        if (initial.level !== 1) throw new Error('Memory pressure is not normal');
        initialSwap = initial.swapUsed;
      } catch { throw fail('本机内存状态无法确认安全，候选模型未启动。', 503); }
    }
    if (signal.aborted) throw fail('候选提取已取消。', 503);
    return new Promise((resolve, reject) => {
      const args = [fileURLToPath(new URL('./fact-runtime-v2.py', import.meta.url)), '--backend', config.backend];
      if (config.backend === 'qwen') args.push('--model-path', config.modelPath, '--integrity-dir', config.integrityDir);
      if (config.backend === 'deepseek') {
        args.push('--key-file', config.keyFile);
        if (config.tunnelPort) args.push('--connect-host', '127.0.0.1', '--connect-port', String(config.tunnelPort));
      }
      // Own cancellation instead of spawn's AbortError: queue ownership lasts until actual close.
      const child = spawnProcess(config.python, args, { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_HUB_DISABLE_IMPLICIT_TOKEN: '1', HF_HUB_DISABLE_TELEMETRY: '1', PYTHONUNBUFFERED: '1' } });
      let out = '', size = 0, stopReason = null, exited = false, closed = false, monitoring = false, warningAt = null;
      let timeout, monitor, escalation;
      const clearTimers = () => { cancelTimeout(timeout); cancelInterval(monitor); cancelTimeout(escalation); };
      const stop = reason => {
        if (exited || closed || stopReason) return;
        stopReason = reason;
        cancelTimeout(timeout); cancelInterval(monitor);
        try { child.kill('SIGTERM'); } catch { /* Still wait for actual exit; never release the next model early. */ }
        if (!exited) escalation = scheduleTimeout(() => { if (!exited && !closed) { try { child.kill('SIGKILL'); } catch { /* close remains the completion boundary. */ } } }, 3000);
      };
      const abort = () => stop('cancelled');
      signal.addEventListener('abort', abort, { once: true });
      timeout = scheduleTimeout(() => stop('timeout'), 600_000);
      if (config.backend === 'qwen') monitor = scheduleInterval(async () => {
        if (monitoring || exited || closed || stopReason) return;
        monitoring = true;
        try {
          const sample = validateMemory(await readMemory());
          if (exited || closed || stopReason) return;
          warningAt = sample.level >= 2 ? warningAt ?? now() : null;
          if (sample.level >= 4 || (warningAt !== null && now() - warningAt >= 10_000) || sample.swapUsed - initialSwap > 4 * 1024 ** 3) stop('external_memory_guard');
        } catch { stop('monitor_error'); }
        finally { monitoring = false; }
      }, 2000);
      // A pipe can split a Chinese character between Buffer chunks. Decode across chunks.
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => { size += Buffer.byteLength(chunk, 'utf8'); if (size > 1_000_000) stop('output_limit'); else out += chunk; });
      child.stderr.on('data', () => {}); // Do not expose paths/credentials/tracebacks through API errors.
      child.on('error', () => stop('process_error'));
      child.once('exit', () => { exited = true; clearTimers(); });
      child.once('close', (code, exitSignal) => {
        closed = true; clearTimers(); signal.removeEventListener('abort', abort);
        try {
          const rows = out.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
          const row = rows.find(item => item.id === source.id && item.type === 'result');
          if (!row) throw new Error('Inference failed');
          // Preserve an incomplete model answer for the store's existing raw-output review path.
          // An externally stopped/nonzero process can never return an apparently complete answer.
          const finish = stopReason ?? ((code !== 0 || exitSignal) && (!row.finish_reason || row.finish_reason === 'stop') ? 'process_error' : row.finish_reason);
          resolve({ raw: row.raw_output, backend: config.backend, model: row.response_model ?? row.model ?? null, finish_reason: finish });
        } catch { reject(fail('候选提取失败、超时或输出未完成。原材料保留，可以重试。', 503)); }
      });
      child.stdin.on('error', () => {});
      try { child.stdin.end(JSON.stringify({ id: source.id, messages: buildExtractionMessages(source) }) + '\n'); }
      catch { stop('input_error'); }
      if (signal.aborted) abort();
    });
  };
}
const infer = createFactInference();

/** Authenticated parent HTTP server owns this bounded, memory-only queue. */
export function createFactJobs(config = {}, inference = infer, { now = Date.now } = {}) {
  const backend = config.backend ?? 'rules';
  if (!['rules', 'qwen', 'deepseek'].includes(backend)) throw new Error('Invalid fixed fact backend');
  const configured = backend === 'rules' || Boolean(config.python && (backend === 'qwen' ? config.modelPath && config.integrityDir : config.keyFile));
  const jobs = new Map(), queue = [], ids = new Map();
  let processing = false, closed = false;
  async function drain() {
    if (processing || closed) return;
    processing = true;
    try { while (queue.length && !closed) {
      const job = queue.shift();
      try {
        const result = backend === 'rules' ? { raw: extractRuleCandidates(job.source), backend, model: null, finish_reason: 'stop' } : await inference(job.source, { ...config, backend }, job.controller.signal);
        if (!job.controller.signal.aborted) { job.result = result; job.status = 'ready'; }
      } catch { job.error = { code: 'FACT_JOB_FAILED', message: '候选提取未完成，请检查模型配置或稍后重试。' }; job.status = 'failed'; }
      finally { job.source = null; job.finishedAt = now(); job.resolveDone(); }
    } } finally { processing = false; }
  }
  const retire = (id, time) => {
    const record = ids.get(id);
    if (record) record.expiresAt = time + replayTtl;
    else {
      if (ids.size >= maxIds) throw fail('候选任务取消记录已满，请稍后重试。', 429);
      ids.set(id, { fingerprint: null, expiresAt: time + replayTtl });
    }
  };
  const prune = () => {
    const time = now();
    for (const [id, job] of jobs) if (job.finishedAt !== undefined && time - job.finishedAt > ttl) {
      // A ready result expires, but a delayed POST must not recreate its ID.
      retire(id, time); jobs.delete(id);
    }
    for (const [id, record] of ids) if (record.expiresAt !== null && record.expiresAt <= time && !jobs.has(id)) ids.delete(id);
  };
  const timer = setInterval(prune, 30_000); timer.unref();
  return {
    backend, configured,
    submit(payload) {
      prune();
      if (!configured || closed) throw fail('候选模型尚未配置。', 503);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !payload.source
        || Object.keys(payload).some(key => !['source', 'jobId'].includes(key))) throw fail('只接受服务端提供的材料文本和任务标识。');
      const suppliedId = Object.hasOwn(payload, 'jobId');
      if (suppliedId && !isFactJobId(payload.jobId)) throw fail('候选任务标识须为有效的小写 UUID。');
      try { validateFactSource(payload.source); }
      catch (error) { throw fail(error.message); }
      if (!payload.source.ready || !payload.source.blocks.length) throw fail('材料文字尚未就绪。');
      const fingerprint = sourceFingerprint(payload.source);
      const id = suppliedId ? payload.jobId : randomUUID();
      const existing = ids.get(id);
      if (existing) {
        if (existing.fingerprint !== null && existing.fingerprint !== fingerprint) throw fail('候选任务标识已绑定其他材料。', 409);
        if (existing.expiresAt !== null || !jobs.has(id)) throw fail('候选任务已取消或过期，请使用新的任务标识。', 410);
        return { jobId: id };
      }
      if (ids.size >= maxIds || jobs.size >= 32 || queue.length + Number(processing) >= 3) throw fail('候选提取队列或任务记录已满。', 429);
      let resolveDone;
      const done = new Promise(resolve => { resolveDone = resolve; });
      const job = { id, status: 'running', source: structuredClone(payload.source), controller: new AbortController(), done, resolveDone };
      // Reserve a small ID record at admission so cancellation of known work
      // cannot fail merely because unknown-ID tombstones filled the capacity.
      ids.set(id, { fingerprint, expiresAt: null });
      jobs.set(job.id, job); queue.push(job); void drain();
      return { jobId: job.id };
    },
    get(id) {
      if (!isFactJobId(id)) throw fail('候选任务标识无效。');
      prune(); const job = jobs.get(id);
      return job && !job.controller.signal.aborted ? { status: job.status, ...(job.result ? { result: job.result } : {}), ...(job.error ? { error: job.error } : {}) } : null;
    },
    async cancel(id) {
      if (!isFactJobId(id)) throw fail('候选任务标识无效。');
      prune(); retire(id, now());
      const job = jobs.get(id); if (!job) return;
      job.controller.abort(); delete job.result; job.source = null;
      const index = queue.indexOf(job);
      if (index >= 0) { queue.splice(index, 1); job.resolveDone(); }
      await job.done; jobs.delete(id); retire(id, now());
    },
    async close() { closed = true; clearInterval(timer); await Promise.all([...jobs.keys()].map(id => this.cancel(id))); ids.clear(); },
  };
}

export function factConfigFromEnvironment() {
  return { backend: process.env.ANXIN_FACTS_BACKEND || 'rules', python: process.env.ANXIN_FACTS_PYTHON,
    modelPath: process.env.ANXIN_FACTS_MODEL_PATH, integrityDir: process.env.ANXIN_FACTS_INTEGRITY_DIR,
    keyFile: process.env.ANXIN_FACTS_KEY_FILE, tunnelPort: process.env.ANXIN_FACTS_DEEPSEEK_TUNNEL_PORT };
}
