import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvironment } from '../deploy/synthetic-http/environment.mjs';

const fixtureDirectory = new URL('../fixtures/regional-demo/', import.meta.url);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sorted = (value) => value && typeof value === 'object'
  ? Array.isArray(value) ? value.map(sorted) : Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]))
  : value;
const caseFields = ['company', 'type', 'amount', 'location', 'description', 'nextAction', 'deadline'];
// Case/chat POST has no API operation UUID. Do not repeat an unresolved write
// while the gateway's preceding request may still be processing (60 seconds).
const unresolvedWriteWindow = 65_000;
function assertPreviousWriteSettled(attemptedAt) {
  if (attemptedAt && Date.now() - attemptedAt < unresolvedWriteWindow) throw new Error('前次写入结果尚未确认，请等待一分钟后用同一环境重试；不会立即重复创建。');
}

export function verifyRegionalDemo(directory = fixtureDirectory) {
  const bytes = readFileSync(new URL('content.json', directory));
  const fixture = JSON.parse(bytes);
  const checksums = JSON.parse(readFileSync(new URL('checksums.json', directory)));
  const fail = () => { throw new Error('地区展示素材校验失败，未写入资料。'); };
  if (fixture.schemaVersion !== 1 || digest(bytes) !== checksums.contentJsonSha256 || fixture.cases.length !== 8 || checksums.cases.length !== 8) fail();
  const keys = new Set();
  for (const item of fixture.cases) {
    const expected = checksums.cases.find((entry) => entry.key === item.key);
    if (keys.has(item.key) || !expected || item.evidence.length !== 2 || item.documents.length !== 1 || expected.materials.length !== 2 || expected.documents.length !== 1) fail();
    keys.add(item.key);
    for (const [index, evidence] of item.evidence.entries()) {
      const material = expected.materials[index];
      if (material.path !== `materials/${item.key}/${evidence.name}` || evidence.mimeType !== 'text/plain') fail();
      const materialBytes = readFileSync(new URL(material.path, directory));
      if (materialBytes.length !== material.bytes || digest(materialBytes) !== material.sha256 || !materialBytes.equals(Buffer.from(evidence.content))) fail();
    }
    for (const document of item.documents) {
      const expectedDocument = expected.documents.find((entry) => entry.type === document.type);
      if (!expectedDocument || digest(JSON.stringify(sorted(document.fields))) !== expectedDocument.fieldsSha256) fail();
    }
    if (typeof item.chatQuestion !== 'string' || !item.chatQuestion.trim() || digest(item.chatQuestion) !== expected.chatQuestionSha256) fail();
  }
  return { fixture, contentHash: checksums.contentJsonSha256 };
}

function operationId(environmentId, batchKey, caseKey, index) {
  const bytes = createHash('sha256').update(`${environmentId}:${batchKey}:${caseKey}:${index}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function acquireLock(path) {
  if (existsSync(path)) {
    const previous = JSON.parse(readFileSync(path, 'utf8'));
    if (!Number.isInteger(previous.pid) || previous.pid <= 0) throw new Error('展示导入锁无效，请核对本环境后处理。');
    try { process.kill(previous.pid, 0); }
    catch (error) {
      if (error.code !== 'ESRCH') throw error;
      unlinkSync(path);
    }
  }
  try { writeFileSync(path, JSON.stringify({ pid: process.pid }), { mode: 0o600, flag: 'wx' }); }
  catch { throw new Error('这个展示环境正在导入，请等待当前导入结束。'); }
}

/** Import only into a marked, persistent, local direct-entry environment. */
export async function seedRegionalDemo(root, { request = fetch } = {}) {
  const config = loadEnvironment(root);
  if (config.bindIp !== '127.0.0.1' || config.proxyMode || config.origin !== `http://127.0.0.1:${config.port}` || config.directEntry !== true || config.persistentDemo !== true) {
    throw new Error('地区素材仅可导入本机隔离的持续展示环境。');
  }
  const { fixture, contentHash } = verifyRegionalDemo();
  const progressPath = join(config.root, '.regional-demo-progress.json');
  const lockPath = join(config.root, '.regional-demo-import.lock');
  acquireLock(lockPath);
  try {
    async function api(path, method = 'GET', value) {
      const headers = method === 'GET' ? {} : { Origin: config.origin };
      if (value && !(value instanceof FormData)) headers['Content-Type'] = 'application/json';
      const response = await request(config.origin + path, {
        method, headers, body: value instanceof FormData ? value : value === undefined ? undefined : JSON.stringify(value),
        redirect: 'manual', signal: AbortSignal.timeout(65_000),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `展示导入请求未完成（${response.status}），可用同一环境重试。`);
      return data;
    }
    let data = await api('/api/bootstrap');
    const userId = config.users.find((user) => user.username === 'synthetic-a').id;
    if (data.synthetic?.environmentId !== config.environmentId || data.synthetic?.directEntry !== true || data.synthetic?.persistentDemo !== true || data.user?.userId !== userId) {
      throw new Error('展示网关身份与本机环境不一致，未导入。');
    }
    const resumed = existsSync(progressPath);
    let progress;
    const save = () => {
      const temporary = progressPath + '.tmp';
      writeFileSync(temporary, JSON.stringify(progress, null, 2), { mode: 0o600 });
      renameSync(temporary, progressPath);
    };
    if (resumed) {
      progress = JSON.parse(readFileSync(progressPath, 'utf8'));
      if (progress.version !== 1 || progress.environmentId !== config.environmentId || progress.userId !== userId || progress.batchKey !== fixture.batchKey || progress.contentHash !== contentHash || !progress.cases || typeof progress.cases !== 'object' || Array.isArray(progress.cases)) {
        throw new Error('已有导入进度与这批素材不一致，未覆盖资料。');
      }
    } else {
      if (['cases', 'archivedCases', 'evidence', 'documents', 'messages'].some((key) => !Array.isArray(data[key]) || data[key].length)) {
        throw new Error('账户已有未登记资料，请使用新建隔离展示环境；不会覆盖或混入已有案件。');
      }
      progress = { version: 1, environmentId: config.environmentId, userId, batchKey: fixture.batchKey, contentHash, cases: {} };
      save();
    }
    const allCases = () => [...data.cases, ...data.archivedCases];
    for (const item of fixture.cases) {
      data = await api('/api/bootstrap');
      let entry = progress.cases[item.key];
      if (!entry) {
        entry = progress.cases[item.key] = { creating: true, evidence: [], documents: [], consultation: false };
        save();
      }
      if (!entry.id) {
        // The intent is durable before POST. A response lost after creation is
        // reconciled from bootstrap before any repeat POST is attempted.
        const matches = allCases().filter((candidate) => candidate.company === item.company && candidate.type === item.type && candidate.location === item.location);
        if (matches.length > 1) throw new Error('待恢复案件存在多个候选，停止导入以避免重复或覆盖。');
        if (matches.length === 1) entry.id = matches[0].id;
        else {
          const knownIds = new Set(Object.values(progress.cases).map((candidate) => candidate.id).filter(Boolean));
          if (allCases().some((candidate) => !knownIds.has(candidate.id))) throw new Error('账户有未登记案件，无法确认前次创建结果；停止导入以避免重复。');
          assertPreviousWriteSettled(entry.createAttemptedAt);
          entry.createAttemptedAt = Date.now();
          save();
          const created = await api('/api/cases', 'POST', Object.fromEntries(caseFields.map((key) => [key, item[key]])));
          entry.id = created.case.id;
        }
        entry.creating = false;
        save();
        data = await api('/api/bootstrap');
      }
      const workCase = allCases().find((candidate) => candidate.id === entry.id);
      if (!workCase) throw new Error('已登记的展示案件不存在，停止恢复以保留用户操作。');
      if (workCase.status === 'archived') continue;
      if (!entry.stage) {
        // New cases start at zero. A nonzero stage recovered after interruption
        // or edited by the user is kept as-is.
        if (workCase.currentStep === 0 && item.currentStep !== 0) await api('/api/cases', 'PATCH', { id: entry.id, currentStep: item.currentStep });
        entry.stage = true;
        save();
      }
      for (const [index, evidence] of item.evidence.entries()) {
        const id = operationId(config.environmentId, fixture.batchKey, item.key, index);
        if (entry.evidence.includes(id)) continue;
        const existing = data.evidence.find((candidate) => candidate.id === id);
        if (!existing || existing.status !== 'uploaded') {
          const form = new FormData();
          form.set('caseId', entry.id); form.set('operationId', id);
          form.set('category', evidence.category); form.set('note', evidence.note);
          form.set('file', new File([evidence.content], evidence.name, { type: evidence.mimeType }));
          await api('/api/evidence', 'POST', form);
        }
        entry.evidence.push(id);
        save();
      }
      for (const document of item.documents) {
        if (entry.documents.includes(document.type)) continue;
        const existing = data.documents.find((candidate) => candidate.caseId === entry.id && candidate.type === document.type);
        if (!existing) await api('/api/documents', 'PUT', { caseId: entry.id, type: document.type, fields: document.fields, revision: 0 });
        entry.documents.push(document.type);
        save();
      }
      if (!entry.consultation) {
        const existing = data.messages.filter((candidate) => candidate.caseId === entry.id && candidate.role === 'user' && candidate.content === item.chatQuestion);
        if (existing.length > 1) throw new Error('待恢复的咨询已有多条相同记录，停止导入。');
        if (!existing.length) {
          assertPreviousWriteSettled(entry.chatAttemptedAt);
          entry.chatAttemptedAt = Date.now();
          save();
          await api('/api/chat', 'POST', { caseId: entry.id, message: item.chatQuestion });
        }
        entry.consultation = true;
        save();
      }
    }
    data = await api('/api/bootstrap');
    const ids = new Set(Object.values(progress.cases).map((entry) => entry.id));
    return {
      cases: allCases().filter((item) => ids.has(item.id)).length,
      evidence: data.evidence.filter((item) => ids.has(item.caseId)).length,
      documents: data.documents.filter((item) => ids.has(item.caseId)).length,
      consultations: data.messages.filter((item) => ids.has(item.caseId) && item.role === 'user').length,
      resumed,
    };
  } finally { unlinkSync(lockPath); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  seedRegionalDemo(process.argv[2]).then((result) => console.log(JSON.stringify(result))).catch((error) => {
    console.error(error.message); process.exitCode = 1;
  });
}
