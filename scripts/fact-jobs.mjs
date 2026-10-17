import { randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { buildExtractionMessages, extractRuleCandidates, validateFactSource } from '../lib/material-facts-v3.ts';

const ttl = 5 * 60_000;
const fail = (message, status = 400) => Object.assign(new Error(message), { status, code: 'FACT_JOB_FAILED' });

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
export function createFactJobs(config = {}, inference = infer) {
  const backend = config.backend ?? 'rules';
  if (!['rules', 'qwen', 'deepseek'].includes(backend)) throw new Error('Invalid fixed fact backend');
  const configured = backend === 'rules' || Boolean(config.python && (backend === 'qwen' ? config.modelPath && config.integrityDir : config.keyFile));
  const jobs = new Map(), queue = [];
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
      finally { job.source = null; job.finishedAt = Date.now(); job.resolveDone(); }
    } } finally { processing = false; }
  }
  const prune = () => { for (const [id, job] of jobs) if (job.finishedAt && Date.now() - job.finishedAt > ttl) jobs.delete(id); };
  const timer = setInterval(prune, 30_000); timer.unref();
  return {
    backend, configured,
    submit(payload) {
      prune();
      if (!configured || closed) throw fail('候选模型尚未配置。', 503);
      if (!payload || Object.keys(payload).length !== 1 || !payload.source) throw fail('只接受服务端提供的材料文本。');
      try { validateFactSource(payload.source); }
      catch (error) { throw fail(error instanceof Error ? error.message : '材料文本不符合提取要求。', 400); }
      if (!payload.source.ready || !payload.source.blocks.length) throw fail('材料文字尚未就绪。');
      if (jobs.size >= 32 || queue.length + Number(processing) >= 3) throw fail('候选提取队列已满。', 429);
      let resolveDone;
      const done = new Promise(resolve => { resolveDone = resolve; });
      const job = { id: randomUUID(), status: 'running', source: structuredClone(payload.source), controller: new AbortController(), done, resolveDone };
      jobs.set(job.id, job); queue.push(job); void drain();
      return { jobId: job.id };
    },
    get(id) { prune(); const job = jobs.get(id); return job ? { status: job.status, ...(job.result ? { result: job.result } : {}), ...(job.error ? { error: job.error } : {}) } : null; },
    async cancel(id) {
      const job = jobs.get(id); if (!job) return;
      job.controller.abort(); delete job.result; job.source = null;
      const index = queue.indexOf(job);
      if (index >= 0) { queue.splice(index, 1); job.resolveDone(); }
      await job.done; jobs.delete(id);
    },
    async close() { closed = true; clearInterval(timer); await Promise.all([...jobs.keys()].map(id => this.cancel(id))); },
  };
}

export function factConfigFromEnvironment() {
  return { backend: process.env.ANXIN_FACTS_BACKEND || 'rules', python: process.env.ANXIN_FACTS_PYTHON,
    modelPath: process.env.ANXIN_FACTS_MODEL_PATH, integrityDir: process.env.ANXIN_FACTS_INTEGRITY_DIR,
    keyFile: process.env.ANXIN_FACTS_KEY_FILE, tunnelPort: process.env.ANXIN_FACTS_DEEPSEEK_TUNNEL_PORT };
}
