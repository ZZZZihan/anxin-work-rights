import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createEnvironment, loadEnvironment, removeEnvironment } from './environment.mjs';
import { seedRegionalDemo, verifyRegionalDemo } from '../../scripts/regional-demo.mjs';

const environments = [];
function environment(options = {}) {
  const item = createEnvironment({ directEntry: true, persistentDemo: true, ...options });
  environments.push(item);
  return item;
}
afterEach(() => {
  for (const item of environments.splice(0)) removeEnvironment(item.root, item.environmentId);
});

function gateway(item) {
  const config = loadEnvironment(item.root);
  const data = {
    synthetic: { environmentId: item.environmentId, directEntry: true, persistentDemo: true },
    user: { userId: config.users[0].id }, cases: [], archivedCases: [], evidence: [], documents: [], messages: [],
  };
  const files = new Map();
  const mutations = [];
  let failure;
  async function request(url, options) {
    const path = new URL(url).pathname;
    expect(new URL(url).origin).toBe(item.origin);
    if (options.method === 'GET') return Response.json(data);
    expect(options.headers.Origin).toBe(item.origin);
    mutations.push({ method: options.method, path });
    const body = options.body instanceof FormData ? options.body : JSON.parse(options.body);
    let result;
    if (path === '/api/cases' && options.method === 'POST') {
      expect(Object.keys(body).sort()).toEqual(['amount', 'company', 'deadline', 'description', 'location', 'nextAction', 'type']);
      const workCase = { ...body, id: randomUUID(), currentStep: 0, status: 'collecting' };
      data.cases.push(workCase); result = { case: workCase };
    } else if (path === '/api/cases') {
      const workCase = data.cases.find((entry) => entry.id === body.id);
      workCase.currentStep = body.currentStep;
      workCase.status = body.currentStep === 4 ? 'completed' : body.currentStep === 3 ? 'arbitration' : body.currentStep === 2 ? 'negotiating' : 'collecting';
      result = { case: workCase };
    } else if (path === '/api/evidence') {
      const id = body.get('operationId');
      const upload = body.get('file');
      const bytes = Buffer.from(await upload.arrayBuffer());
      let evidence = data.evidence.find((entry) => entry.id === id);
      if (evidence) expect(bytes.equals(files.get(id))).toBe(true);
      else {
        evidence = { id, caseId: body.get('caseId'), name: upload.name, category: body.get('category'), note: body.get('note'), status: 'uploaded', downloadable: true };
        data.evidence.push(evidence); files.set(id, bytes);
      }
      result = { evidence };
    } else if (path === '/api/documents') {
      if (data.documents.some((entry) => entry.caseId === body.caseId && entry.type === body.type)) return Response.json({ error: 'conflict' }, { status: 409 });
      const document = { ...body, id: randomUUID(), revision: 1 };
      data.documents.push(document); result = { document };
    } else if (path === '/api/chat') {
      const user = { id: randomUUID(), caseId: body.caseId, role: 'user', content: body.message };
      const assistant = { id: randomUUID(), caseId: body.caseId, role: 'assistant', content: '规则路径提示', sources: [] };
      data.messages.push(user, assistant); result = { messages: [user, assistant] };
    } else throw new Error('Unexpected endpoint');
    if (failure?.path === path && failure?.method === options.method) {
      failure = undefined;
      throw new Error('simulated response lost after server accepted mutation');
    }
    return Response.json(result);
  }
  return { data, files, mutations, request, loseNextResponse(path, method) { failure = { path, method }; } };
}

describe('regional fixture import', () => {
  let item, server;
  beforeEach(() => { item = environment(); server = gateway(item); });

  it('checks all fixture bytes and creates eight complete HTTP workflows without sending metadata', async () => {
    const { fixture } = verifyRegionalDemo();
    expect(fixture.cases).toHaveLength(8);
    expect(await seedRegionalDemo(item.root, server)).toEqual({ cases: 8, evidence: 16, documents: 8, consultations: 8, resumed: false });
    expect(server.data.messages).toHaveLength(16);
    for (const [index, expected] of fixture.cases.entries()) {
      const workCase = server.data.cases[index];
      expect(workCase.currentStep).toBe(expected.currentStep);
      expect(workCase).not.toHaveProperty('sourceRefs');
      const materials = server.data.evidence.filter((entry) => entry.caseId === workCase.id);
      expect(materials).toHaveLength(2);
      for (const evidence of materials) {
        const fixtureFile = expected.evidence.find((entry) => entry.name === evidence.name);
        expect(server.files.get(evidence.id).equals(Buffer.from(fixtureFile.content))).toBe(true);
      }
    }
  });

  it('reruns without mutations and preserves edited case, stage and draft fields', async () => {
    await seedRegionalDemo(item.root, server);
    const firstCase = server.data.cases[0];
    firstCase.company = '用户修改后的单位'; firstCase.currentStep = 3;
    const firstDraft = server.data.documents[0];
    firstDraft.fields.title = '用户重新整理的事实'; firstDraft.revision = 2;
    const before = structuredClone(server.data);
    const count = server.mutations.length;
    expect(await seedRegionalDemo(item.root, server)).toMatchObject({ cases: 8, evidence: 16, documents: 8, consultations: 8, resumed: true });
    expect(server.data).toEqual(before);
    expect(server.mutations).toHaveLength(count);
  });

  it.each([
    ['/api/cases', 'POST'], ['/api/cases', 'PATCH'], ['/api/evidence', 'POST'], ['/api/documents', 'PUT'], ['/api/chat', 'POST'],
  ])('reconciles a lost successful %s %s response before resuming', async (path, method) => {
    server.loseNextResponse(path, method);
    await expect(seedRegionalDemo(item.root, server)).rejects.toThrow('response lost');
    expect(existsSync(join(item.root, '.regional-demo-import.lock'))).toBe(false);
    expect(await seedRegionalDemo(item.root, server)).toMatchObject({ cases: 8, evidence: 16, documents: 8, consultations: 8, resumed: true });
    expect(server.data.messages).toHaveLength(16);
    expect(new Set(server.data.cases.map((entry) => entry.company)).size).toBe(8);
  });

  it('refuses an unregistered nonempty account without mutations or a new progress journal', async () => {
    server.data.cases.push({ id: 'existing-user-case', company: '已有资料' });
    await expect(seedRegionalDemo(item.root, server)).rejects.toThrow('账户已有未登记资料');
    expect(server.mutations).toHaveLength(0);
    expect(existsSync(join(item.root, '.regional-demo-progress.json'))).toBe(false);
  });

  it('does not repeat an unresolved creation immediately, and resumes when the earlier request window has settled', async () => {
    const failed = { request: async (url, options) => {
      if (options.method === 'POST' && new URL(url).pathname === '/api/cases') throw new Error('network failed before response');
      return server.request(url, options);
    } };
    await expect(seedRegionalDemo(item.root, failed)).rejects.toThrow('network failed');
    await expect(seedRegionalDemo(item.root, server)).rejects.toThrow('尚未确认');
    expect(server.mutations).toHaveLength(0);
    const path = join(item.root, '.regional-demo-progress.json');
    const progress = JSON.parse(readFileSync(path));
    Object.values(progress.cases)[0].createAttemptedAt = Date.now() - 66_000;
    writeFileSync(path, JSON.stringify(progress), { mode: 0o600 });
    expect(await seedRegionalDemo(item.root, server)).toMatchObject({ cases: 8, consultations: 8 });
  });

  it('preserves an edited case whose successful creation response was lost instead of creating a second case', async () => {
    server.loseNextResponse('/api/cases', 'POST');
    await expect(seedRegionalDemo(item.root, server)).rejects.toThrow('response lost');
    server.data.cases[0].company = '成功创建后用户编辑过的单位';
    const count = server.mutations.length;
    await expect(seedRegionalDemo(item.root, server)).rejects.toThrow('未登记案件');
    expect(server.data.cases).toHaveLength(1);
    expect(server.mutations).toHaveLength(count);
  });

  it('refuses a different gateway identity before writing', async () => {
    server.data.synthetic.environmentId = randomUUID();
    await expect(seedRegionalDemo(item.root, server)).rejects.toThrow('身份');
    expect(server.mutations).toHaveLength(0);
  });

  it('refuses simultaneous import and can recover the progress after the first exits', async () => {
    let release;
    const blocker = new Promise((done) => { release = done; });
    let began;
    const started = new Promise((done) => { began = done; });
    const first = seedRegionalDemo(item.root, { request: async (...args) => { began(); await blocker; return server.request(...args); } });
    await started;
    await expect(seedRegionalDemo(item.root, server)).rejects.toThrow('正在导入');
    release();
    expect(await first).toMatchObject({ cases: 8, evidence: 16 });
  });

  it('refuses login mode and proxy or LAN environments before HTTP requests', async () => {
    const targets = [
      environment({ directEntry: false, persistentDemo: false }),
      environment({ bindIp: '192.168.10.8', allowCidrs: ['192.168.10.0/24'] }),
      environment({ publicOrigin: 'http://192.168.10.8', allowCidrs: ['192.168.10.0/24'] }),
    ];
    for (const target of targets) await expect(seedRegionalDemo(target.root, { request: () => { throw new Error('HTTP should not be reached'); } })).rejects.toThrow('仅可导入本机');
  });
});

it('rejects a TXT file changed after the fixture hash was published', () => {
  const directory = mkdtempSync(join(tmpdir(), 'anxin-fixture-validation-'));
  try {
    cpSync(new URL('../../fixtures/regional-demo/', import.meta.url), directory, { recursive: true });
    const { fixture } = verifyRegionalDemo();
    const path = join(directory, 'materials', fixture.cases[0].key, fixture.cases[0].evidence[0].name);
    writeFileSync(path, readFileSync(path) + 'altered bytes');
    expect(() => verifyRegionalDemo(pathToFileURL(directory + '/'))).toThrow('校验失败');
  } finally { rmSync(directory, { recursive: true }); }
});
