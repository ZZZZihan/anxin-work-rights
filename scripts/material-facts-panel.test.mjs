import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Execute the actual TSX component and its async callbacks. Hooks, fetch and
// timers are controlled boundaries; this suite does not claim React DOM or
// browser acceptance. Real-browser checks remain a separate integration gate.
const source = await readFile(process.env.ANXIN_FACT_PANEL_TEST_SOURCE
  || new URL('../components/MaterialFactsPanel.tsx', import.meta.url), 'utf8');
const hooksById = new Map();
globalThis.__anxinFactPanelTestHooks = hooksById;
let nextHarness = 0;
const url = value => 'data:text/javascript,' + encodeURIComponent(value);
const equal = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
const text = node => Array.isArray(node) ? node.map(text).join('')
  : node && typeof node === 'object' ? text(node.props?.children) : node == null || typeof node === 'boolean' ? '' : String(node);
function find(node, predicate) {
  if (Array.isArray(node)) return node.map(item => find(item, predicate)).find(Boolean);
  if (!node || typeof node !== 'object') return null;
  return predicate(node) ? node : find(node.props?.children, predicate);
}
const scope = { worker: '张三', employer: '合成公司', start: '2024-07-01', end: '2024-07-31' };
const calculation = generation => ({ due: '8000.00', paid: '0.00', gap: '8000.00', generation, receiptId: 'synthetic-receipt', at: '2026-10-18' });
function body(generation = 1, revision = 10, result = null, worker = scope.worker) {
  return {
    generation, revision, state: { generation, scope: { ...scope, worker }, scopeReview: null,
      confirmations: { due: null, paid: null }, materials: [], job: null, calculation: result },
    candidates: [], fields: { due: { values: [], status: 'unknown', confirmation: null },
      paid: { values: [], status: 'unknown', confirmation: null } },
    sources: [], backend: 'rules', configured: true, unresolved: [], canCalculate: true,
  };
}
const failure = (status, message) => ({ httpFailure: true, status, message });
const response = value => value.httpFailure
  ? { ok: false, status: value.status, json: async () => ({ error: value.message }) }
  : { ok: true, status: 200, json: async () => value };

async function mount(initial = body()) {
  const id = ++nextHarness, slots = [], effects = [], timers = new Map(), notifications = [], posts = [];
  let cursor = 0, tree, timerId = 0, version = 'first', current = initial, releasePost, releaseGet, holdNextGet = false;
  const originalFetch = globalThis.fetch, originalWindow = globalThis.window;
  const hooks = {
    useState(initialValue) {
      const index = cursor++;
      slots[index] ??= { value: typeof initialValue === 'function' ? initialValue() : initialValue };
      return [slots[index].value, value => { slots[index].value = typeof value === 'function' ? value(slots[index].value) : value; }];
    },
    useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
    useCallback(callback, deps) {
      const index = cursor++;
      if (!slots[index] || !equal(deps, slots[index].deps)) slots[index] = { callback, deps };
      return slots[index].callback;
    },
    useEffect(callback, deps) {
      const index = cursor++;
      if (!slots[index] || !equal(deps, slots[index].deps)) {
        const previous = slots[index];
        slots[index] = { deps, cleanup: previous?.cleanup };
        effects.push(() => { slots[index].cleanup?.(); slots[index].cleanup = callback(); });
      }
    },
  };
  hooksById.set(id, hooks);
  const mocks = {
    react: `export const {useState,useRef,useCallback,useEffect}=globalThis.__anxinFactPanelTestHooks.get(${id});`,
    'react/jsx-runtime': 'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="fragment";',
    'lucide-react': 'export const Calculator=()=>null,Check=Calculator,Info=Calculator,LoaderCircle=Calculator,RefreshCw=Calculator,ScanText=Calculator,Undo2=Calculator;',
    '@/lib/material-facts-v3': 'export const getCandidateRepresentation=()=>null,isV2Candidate=()=>false,isV3Candidate=()=>false;',
    '@/lib/material-fact-coverage-review': 'export const getReviewedExtractionCoverage=()=>null;',
  };
  let js = ts.transpileModule(source, { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
  } }).outputText;
  for (const [name, mock] of Object.entries(mocks)) {
    js = js.replaceAll(JSON.stringify(name), JSON.stringify(url(mock))).replaceAll("'" + name + "'", JSON.stringify(url(mock)));
  }
  js = js.replace(/^import ['"].*\.css['"];$/gm, '');
  const { default: Component } = await import(url(js));
  const settle = async () => { await new Promise(resolve => setImmediate(resolve)); };
  globalThis.window = {
    setTimeout(callback, delay) { timers.set(++timerId, { callback, delay }); return timerId; },
    clearTimeout(key) { timers.delete(key); },
  };
  globalThis.fetch = async (_path, init) => {
    if (init?.method === 'POST') {
      posts.push(JSON.parse(init.body));
      return await new Promise(resolve => { releasePost = value => resolve(response(value)); });
    }
    if (holdNextGet) {
      holdNextGet = false;
      return await new Promise(resolve => { releaseGet = value => resolve(response(value)); });
    }
    const value = current;
    return response(value);
  };
  const render = () => {
    cursor = 0;
    tree = Component({ caseId: 'synthetic-case', evidenceVersion: version, onOpenSource() {}, notify(...args) { notifications.push(args); } });
    for (const effect of effects.splice(0)) effect();
  };
  const zeroTimers = async () => {
    for (const [key, timer] of [...timers]) if (timer.delay === 0) { timers.delete(key); timer.callback(); }
    await settle(); render();
  };
  const lookup = predicate => { const found = find(tree, predicate); assert(found, 'Expected component control'); return found; };
  render(); await zeroTimers();
  return {
    get text() { return text(tree); },
    get alert() { return text(find(tree, node => node.props?.role === 'alert')); },
    get calculateDisabled() { return lookup(node => node.type === 'button' && text(node).includes('按已确认事实计算差额')).props.disabled; },
    notifications, posts,
    section(label) { return lookup(node => node.type === 'section' && node.props['aria-label'] === label); },
    lookup,
    async change(control, value) { control.props.onChange({ target: { value, checked: value } }); render(); },
    async clickCalculate() {
      const control = lookup(node => node.type === 'button' && text(node).includes('按已确认事实计算差额'));
      assert.equal(control.props.disabled, false); control.props.onClick(); await settle(); render();
    },
    async submit(form) { form.props.onSubmit({ preventDefault() {} }); await settle(); render(); },
    async refresh(value) { current = value; version += '-changed'; render(); await zeroTimers(); },
    async holdRefresh() { holdNextGet = true; version += '-changed'; render(); await zeroTimers(); assert(releaseGet, 'Expected a pending GET'); },
    async manualRefresh(value) {
      current = value;
      lookup(node => node.type === 'button' && text(node).includes('重新读取状态')).props.onClick();
      await settle(); render();
    },
    async respond(value) { assert(releasePost); releasePost(value); await settle(); render(); },
    async respondFailure(status, message = `synthetic POST failure ${status}`) { assert(releasePost); releasePost(failure(status, message)); await settle(); render(); },
    async failGet(status, message = `synthetic GET failure ${status}`) { assert(releaseGet); releaseGet(failure(status, message)); await settle(); render(); },
    dispose() { for (const slot of slots) slot?.cleanup?.(); hooksById.delete(id); globalThis.fetch = originalFetch; globalThis.window = originalWindow; },
  };
}

const staleCases = [
  ['lower generation and revision', body(2, 20), body(1, 11, calculation(1))],
  ['same generation and lower revision', body(1, 20), body(1, 11, calculation(1))],
  ['lower generation even with higher revision', body(2, 1), body(1, 99, calculation(1))],
];
for (const [name, fresh, stale] of staleCases) {
  test(`late calculation response cannot restore old results: ${name}`, async () => {
    const app = await mount();
    try {
      await app.clickCalculate();
      await app.refresh(fresh);
      assert(app.text.includes(`材料版本 ${fresh.generation} · 确认版本 ${fresh.revision}`));
      await app.respond(stale);
      assert(app.text.includes(`材料版本 ${fresh.generation} · 确认版本 ${fresh.revision}`));
      assert(!app.text.includes('synthetic-receipt'));
      assert.deepEqual(app.notifications, []);
    } finally { app.dispose(); }
  });
}

for (const value of [body(1, 11, calculation(1)), body(2, 1, calculation(2))]) {
  test(`accepts a current mutation response generation=${value.generation}, revision=${value.revision}`, async () => {
    const app = await mount();
    try {
      await app.clickCalculate(); await app.respond(value);
      assert(app.text.includes(`材料版本 ${value.generation} · 确认版本 ${value.revision}`));
      assert(app.text.includes('synthetic-receipt'));
      assert.equal(app.notifications.length, 1);
    } finally { app.dispose(); }
  });
}

test('a stale scope response preserves the local scope draft and emits no success notice', async () => {
  const app = await mount();
  const form = () => find(app.section('核算范围确认'), node => node.type === 'form');
  try {
    await app.change(find(form(), node => node.type === 'input' && node.props.value === scope.worker), '本地劳动者草稿');
    await app.change(find(form(), node => node.type === 'textarea'), '本地范围核实依据草稿');
    await app.change(find(form(), node => node.type === 'input' && node.props.type === 'checkbox'), true);
    await app.submit(form());
    assert.equal(app.posts[0].action, 'confirm_scope');
    await app.refresh(body(2, 1, null, '最新服务劳动者'));
    await app.respond(body(1, 99, null, '旧响应劳动者'));
    assert(app.text.includes('材料版本 2 · 确认版本 1'));
    assert.equal(find(form(), node => node.type === 'input' && node.props.type === 'text').props.value, '本地劳动者草稿');
    assert.equal(find(form(), node => node.type === 'textarea').props.value, '本地范围核实依据草稿');
    assert.deepEqual(app.notifications, []);
  } finally { app.dispose(); }
});

test('a stale amount confirmation cannot clear the amount or explanation draft', async () => {
  const app = await mount();
  const form = () => find(app.section('完整金额确认'), node => node.type === 'form');
  try {
    await app.change(find(form(), node => node.type === 'input' && node.props.type === 'text'), '8123');
    await app.change(find(form(), node => node.type === 'textarea'), '完整金额核实草稿');
    await app.change(find(form(), node => node.type === 'input' && node.props.type === 'checkbox'), true);
    await app.change(find(form(), node => node.type === 'input' && node.props.type === 'checkbox' && !node.props.checked), true);
    await app.submit(form());
    assert.equal(app.posts[0].action, 'confirm_amount');
    await app.refresh(body(2, 1)); await app.respond(body(1, 99));
    assert(app.text.includes('材料版本 2 · 确认版本 1'));
    assert.equal(find(form(), node => node.type === 'input' && node.props.type === 'text').props.value, '8123');
    assert.equal(find(form(), node => node.type === 'textarea').props.value, '完整金额核实草稿');
    assert.deepEqual(app.notifications, []);
  } finally { app.dispose(); }
});

test('an older manual GET does not reset reviewed draft checks or replace the displayed version', async () => {
  const app = await mount(body(2, 20));
  const form = () => find(app.section('完整金额确认'), node => node.type === 'form');
  try {
    const complete = () => find(form(), node => node.type === 'input' && node.props.type === 'checkbox');
    await app.change(complete(), true);
    await app.manualRefresh(body(1, 99, calculation(1)));
    assert(app.text.includes('材料版本 2 · 确认版本 20'));
    assert.equal(complete().props.checked, true);
    assert(!app.text.includes('synthetic-receipt'));
    assert.deepEqual(app.notifications, []);
  } finally { app.dispose(); }
});

for (const status of [409, 500]) {
  for (const fresh of [body(2, 1), body(1, 20)]) {
    test(`a late POST ${status} cannot add an error or lock a newer GET generation=${fresh.generation}, revision=${fresh.revision}`, async () => {
      const app = await mount();
      try {
        await app.clickCalculate();
        await app.refresh(fresh);
        assert(app.text.includes(`材料版本 ${fresh.generation} · 确认版本 ${fresh.revision}`));
        await app.respondFailure(status);
        assert(app.text.includes(`材料版本 ${fresh.generation} · 确认版本 ${fresh.revision}`));
        assert.equal(app.alert, '');
        assert.equal(app.calculateDisabled, false);
        assert.deepEqual(app.notifications, []);
      } finally { app.dispose(); }
    });
  }
}

for (const status of [409, 500]) {
  test(`a current POST ${status} still reports the failure and preserves the amount draft`, async () => {
    const app = await mount();
    const form = () => find(app.section('完整金额确认'), node => node.type === 'form');
    try {
      await app.change(find(form(), node => node.type === 'input' && node.props.type === 'text'), '8123');
      await app.change(find(form(), node => node.type === 'textarea'), '未保存完整金额核实草稿');
      await app.change(find(form(), node => node.type === 'input' && node.props.type === 'checkbox'), true);
      await app.change(find(form(), node => node.type === 'input' && node.props.type === 'checkbox' && !node.props.checked), true);
      await app.submit(form());
      await app.respondFailure(status);
      assert.equal(find(form(), node => node.type === 'input' && node.props.type === 'text').props.value, '8123');
      assert.equal(find(form(), node => node.type === 'textarea').props.value, '未保存完整金额核实草稿');
      if (status === 409) {
        assert(app.alert.includes('材料或确认记录已更新'));
        assert(app.alert.includes('保存已暂停'));
        assert.equal(app.calculateDisabled, true);
      } else {
        assert(app.alert.includes('synthetic POST failure 500'));
        assert(!app.alert.includes('保存已暂停'));
        assert.equal(app.calculateDisabled, false);
      }
      assert.deepEqual(app.notifications, []);
    } finally { app.dispose(); }
  });
}

for (const status of [409, 500]) {
  test(`a GET ${status} started before a newer POST success cannot overwrite its status`, async () => {
    const app = await mount();
    try {
      await app.clickCalculate();
      await app.holdRefresh();
      await app.respond(body(1, 11, calculation(1)));
      assert(app.text.includes('材料版本 1 · 确认版本 11'));
      assert(app.text.includes('synthetic-receipt'));
      await app.failGet(status);
      assert(app.text.includes('材料版本 1 · 确认版本 11'));
      assert(app.text.includes('synthetic-receipt'));
      assert.equal(app.alert, '');
      assert.equal(app.calculateDisabled, false);
      assert.equal(app.notifications.length, 1);
    } finally { app.dispose(); }
  });
}
