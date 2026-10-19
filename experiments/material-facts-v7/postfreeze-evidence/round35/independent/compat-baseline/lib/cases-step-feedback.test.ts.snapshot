// Invoke the actual rendered advance button handler with controlled React hook
// boundaries. Browser verification separately covers real mounting and toasts.
import { isValidElement, type ReactNode, type SetStateAction } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BootstrapData, WorkCase } from './types';
import Cases from '../components/views/Cases';

vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: () => {},
  useMemo: (factory: () => unknown) => factory(),
  useRef: <T>(initial: T) => ({ current: initial }),
  useState: <T>(initial: T) => [initial, vi.fn()],
}));

const fetchFixture = vi.fn();
const steps = ['整理事实', '固定证据', '沟通协商', '申请仲裁', '完成归档'];
const status = (step: number): WorkCase['status'] => step >= 4 ? 'completed' : step >= 3 ? 'arbitration' : step >= 2 ? 'negotiating' : 'collecting';
const fixture = (step = 0): WorkCase => ({
  id: 'synthetic-step-case', company: '合成阶段提醒单位', type: '欠薪争议', amount: 0,
  currentStep: step, status: status(step), nextAction: steps[step], deadline: null,
  location: '', description: '', createdAt: '2026-10-18T00:00:00Z', updatedAt: '2026-10-18T00:00:00Z',
});

type ElementProps = { children?: ReactNode; onClick?: () => Promise<void> };
function buttonHandler(node: ReactNode): (() => Promise<void>) | undefined {
  if (Array.isArray(node)) {
    for (const item of node) { const found = buttonHandler(item); if (found) return found; }
  }
  if (!isValidElement<ElementProps>(node)) return;
  if (node.type === 'button' && Array.isArray(node.props.children) && node.props.children.includes('完成本步')) return node.props.onClick;
  return buttonHandler(node.props.children);
}

function harness(workCase: WorkCase) {
  let data: BootstrapData | null = {
    user: { userId: 'synthetic-owner', displayName: '合成用户', email: 'owner@synthetic.test' },
    cases: [workCase], archivedCases: [], evidence: [], messages: [], documents: [],
  };
  const notify = vi.fn();
  const setData = vi.fn((next: SetStateAction<BootstrapData | null>) => { data = typeof next === 'function' ? next(data) : next; });
  const tree = Cases({ data, setData, notify, activeCaseId: workCase.id, setActiveCaseId: vi.fn(), navigate: vi.fn() });
  const advance = buttonHandler(tree);
  expect(advance).toBeTypeOf('function');
  return { advance: advance!, notify, setData, current: () => data?.cases[0] };
}

beforeEach(() => { fetchFixture.mockReset(); vi.stubGlobal('fetch', fetchFixture); });
afterEach(() => vi.unstubAllGlobals());

describe('case advance feedback', () => {
  it.each([0, 3])('keeps stage %i saved and reports unfinished remote cleanup in the same notification', async step => {
    const original = fixture(step), next = fixture(step + 1);
    fetchFixture.mockResolvedValue(Response.json({ case: next, processingCleanupPending: true }));
    const ui = harness(original);
    await ui.advance();
    expect(ui.current()).toEqual(next);
    expect(ui.setData).toHaveBeenCalledOnce();
    const saved = step === 3 ? '案件已标记完成' : '已进入“固定证据”阶段';
    expect(ui.notify).toHaveBeenCalledExactlyOnceWith(`${saved}；后台提取尚未确认停止，请检查识别服务。`);
    const [path, init] = fetchFixture.mock.calls[0];
    expect(path).toBe('/api/cases');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toMatchObject({ id: original.id, currentStep: step + 1, status: next.status });
  });

  it.each([false, undefined])('uses ordinary progress feedback when cleanup pending is %s', async pending => {
    fetchFixture.mockResolvedValue(Response.json({ case: fixture(1), ...(pending === undefined ? {} : { processingCleanupPending: pending }) }));
    const ui = harness(fixture());
    await ui.advance();
    expect(ui.current()?.currentStep).toBe(1);
    expect(ui.notify).toHaveBeenCalledExactlyOnceWith('已进入“固定证据”阶段。');
  });

  it('preserves the current stage and only reports the request error when PATCH fails', async () => {
    fetchFixture.mockResolvedValue(Response.json({ error: '合成更新失败，请重试。' }, { status: 503 }));
    const original = fixture(), ui = harness(original);
    await ui.advance();
    expect(ui.current()).toEqual(original);
    expect(ui.setData).not.toHaveBeenCalled();
    expect(ui.notify).toHaveBeenCalledExactlyOnceWith('合成更新失败，请重试。', 'error');
  });
});
