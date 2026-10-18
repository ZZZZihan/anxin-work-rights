import { describe, expect, it } from 'vitest';
import type { FactSource } from './material-fact-types';
import type { CandidateNormalization, FactCandidateV3, RawCandidateV3 } from './material-fact-types-v3';
import { sourceMoneyHasUnsupportedCurrency } from './material-fact-currency-review';
import { reviewCandidateAgainstSource, reviewFactsAgainstSources } from './material-fact-source-review';
import { applyFactAction, buildFactView, emptyFactState, ingestCandidates, normalizeCandidateValue, prepareCalculation, validateCandidateOutput } from './material-facts-v3';
import { ingestCandidates as ingestV2, validateCandidateOutput as validateV2 } from './material-facts-v2';

const ACTOR = 'synthetic-currency-review', AT = '2026-10-18T00:00:00.000Z';
const entry = (value: string): RawCandidateV3 => ({ kind: 'money', value, quote: value, blockId: 'b1', subject: '王甲', scope: 'individual', meaning: 'due_total', completeness: 'complete', period: '2024年7月', rateUnit: null, assertion: 'narrated' });
const source = (text: string): FactSource => ({ id: 'currency-source', name: '合成币种裁剪反例', sha256: 'c'.repeat(64), analysisRevision: 1, ready: true, blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] });
function stateFor(literal: string, value = '8000') {
  const material = source(`😀王甲在甲公司2024年7月完整应付工资${literal}。`);
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [entry(value)] });
  let state = ingestCandidates(emptyFactState(1), material, { raw }, 'synthetic', ACTOR, AT);
  state = applyFactAction(state, { action: 'confirm_scope', scope: { worker: '王甲', employer: '甲公司', start: '2024-07-01', end: '2024-07-31' }, note: '独立核实主体和期间', verified: true }, [material], ACTOR, AT);
  return { material, raw, state };
}
function normalized(rawValue: string, start = 0, end = Array.from(rawValue).length): CandidateNormalization {
  return { rawValue, status: 'exact', amount: '8000.00', matchedText: Array.from(rawValue).slice(start, end).join(''), span: { start, end }, reason: '合成定位测试' };
}

describe('runtime currency guard at original monetary token edges', () => {
  it.each(['US$', 'HK$', 'S$', 'A$', 'C$', 'NZ$', 'NT$', 'R$', 'U.S.$', 'HK $', 'ＵＳ＄', 'Ｓ＄', 'JP ¥', 'J.P.¥'])('detects a qualified currency symbol %s on either edge', marker => {
    for (const literal of [`${marker}8000`, `8000${marker}`]) {
      const blockText = `金额${literal}。`, valueStart = blockText.indexOf('8000');
      expect(sourceMoneyHasUnsupportedCurrency({ blockText, valueStart }, normalized('8000')), literal).toBe(true);
    }
  });

  it.each(['澳大利亚元', '紐西蘭元', '马来西亚令吉', '瑞郎', '美分', '欧分', '港仙', '台元'])('detects the attached currency spelling %s', marker => {
    for (const literal of [`${marker}8000`, `8000${marker}`]) {
      const blockText = `金额${literal}。`, valueStart = blockText.indexOf('8000');
      expect(sourceMoneyHasUnsupportedCurrency({ blockText, valueStart }, normalized('8000')), literal).toBe(true);
    }
  });

  it.each([
    ['港元8000', '8000'], ['8000港元', '8000'], ['8000美元', '8000'], ['8000 USD', '8000'],
    ['USD8000', '8000'], ['8000usd', '8000'], ['8000 ＨＫＤ', '8000'], ['ＵＳＤ：8000', '8000'],
    ['8000（ＵＳＤ）', '8000'], ['8000元（美元）', '8000'], ['港幣：8000元', '8000元'],
    ['USD ￥8000', '8000'], ['8000元人民币（美元）', '8000'],
    ['＄8000', '8000'], ['8000﹩', '8000'], ['8000€', '8000'], ['£8000', '8000'],
    ['￦8000', '8000'], ['8000₹', '8000'], ['8000₽', '8000'], ['8000₨', '8000'], ['8000円', '8000'],
    ['JP¥8000', '8000'], ['8000新臺幣', '8000'], ['8000 NOK', '8000'], ['8000 dollars', '8000'],
    ['港元８０００', '８０００'], ['８０００ ＵＳＤ', '８０００'], ['８０００＄', '８０００'],
    ['美元捌仟元整', '捌仟元整'], ['捌仟元美金', '捌仟元'], ['八千港元', '八千'],
  ])('detects currency at %s while preserving literal %s', (literal, value) => {
    const blockText = `😀金额${literal}。`, valueStart = blockText.indexOf(value), n = normalized(value);
    const snapshot = JSON.stringify({ blockText, valueStart, n });
    expect(sourceMoneyHasUnsupportedCurrency({ blockText, valueStart }, n)).toBe(true);
    expect(JSON.stringify({ blockText, valueStart, n })).toBe(snapshot);
  });

  it.each([
    ['人民币8000元', '8000'], ['人民币8000元', '8000元'], ['8000人民币', '8000'],
    ['CNY8000', '8000'], ['8000 CNY', '8000'], ['RMB8000', '8000'], ['8000ＲＭＢ', '8000'],
    ['￥8000元', '8000'], ['¥8000', '8000'], ['CN¥8000', '8000'], ['8000CN¥', '8000'], ['8000元（人民币）', '8000'],
    ['前一笔USD，8000元', '8000'], ['8000元，另一笔USD', '8000'],
    ['美元\n8000元', '8000'], ['8000元\n美元', '8000'], ['美元；8000元', '8000'],
    ['美元\u20288000元', '8000'], ['8000元\u2029美元', '8000'], ['美元换成人民币8000元', '8000'],
    ['8000元；另一笔US$', '8000'], ['8000US\n$', '8000'],
  ])('keeps RMB and separate event controls: %s', (literal, value) => {
    const blockText = `金额${literal}。`;
    expect(sourceMoneyHasUnsupportedCurrency({ blockText, valueStart: blockText.indexOf(value) }, normalized(value))).toBe(false);
  });

  it('uses Unicode code point spans inside the untouched candidate value', () => {
    const value = '😀完整工资8000', n = normalized(value, Array.from('😀完整工资').length);
    const blockText = `首行。${value} ＵＳＤ。`;
    expect(sourceMoneyHasUnsupportedCurrency({ blockText, valueStart: blockText.indexOf(value) }, n)).toBe(true);
    expect(sourceMoneyHasUnsupportedCurrency({ blockText, valueStart: blockText.indexOf(value) }, { ...n, span: null })).toBe(false);
    expect(n.rawValue).toBe(value);
  });
});

describe('runtime foreign currency crop regression through source review and suggestions', () => {
  it.each([
    ['8000港元', '8000'], ['8000美元', '8000'], ['8000 USD', '8000'], ['USD8000元', '8000元'],
    ['8000US$', '8000'], ['8000HK$', '8000'], ['8000S$', '8000'], ['8000A$', '8000'],
    ['港幣8000元', '8000元'], ['8000元（ＵＳＤ）', '8000元'], ['8000 ＨＫＤ', '8000'],
    ['USD ￥8000', '8000'], ['8000元人民币（美元）', '8000'],
    ['8000﹩', '8000'], ['＄8000', '8000'], ['8000￦', '8000'], ['8000円', '8000'],
    ['美元捌仟元整', '捌仟元整'], ['捌仟元美金', '捌仟元'], ['8000元（新臺幣）', '8000元'],
  ])('withholds RMB suggestion when value crops source currency: %s', (literal, value) => {
    const { material, raw, state } = stateFor(literal, value), snapshot = JSON.stringify(state);
    const original = state.materials[0].candidates[0] as FactCandidateV3;
    // Keep this pre-review assertion: the frozen extraction contract stays unchanged.
    expect(original.amount).toBe('8000.00');
    expect(buildFactView(state, [material]).fields.due.values).toEqual(['8000.00']);
    const reviewed = reviewFactsAgainstSources(state, [material]);
    const candidate = reviewed.materials[0].candidates[0] as FactCandidateV3;
    expect(candidate.amount).toBeNull();
    expect(candidate.normalization.status).toBe('unsupported');
    expect(candidate.reviewIssues.map(issue => issue.code)).toContain('source_amount_context_mismatch');
    expect(candidate.value).toBe(value);
    expect(candidate.quote).toBe(value);
    expect(candidate.representation).toEqual(original.representation);
    expect(reviewed.materials[0].raw).toBe(raw);
    expect(buildFactView(reviewed, [material]).fields.due.values).toEqual([]);
    expect(reviewed.confirmations).toEqual(state.confirmations);
    expect(JSON.stringify(state)).toBe(snapshot);
    expect(reviewFactsAgainstSources(reviewed, [material])).toEqual(reviewed);
  });

  it.each(['rate', 'other_money'] as const)('does not retain an RMB amount for cropped regional dollar suffixes in %s', meaning => {
    for (const marker of ['US$', 'HK$', 'S$', 'A$', 'U.S.$', 'ＨＫ＄', 'NT$', 'R$']) {
      const material = source(`王甲在甲公司2024年7月${meaning === 'rate' ? '月薪' : '交通补贴'}8000${marker}。`);
      const representation: RawCandidateV3 = { ...entry('8000'), meaning, completeness: 'not_applicable', rateUnit: meaning === 'rate' ? 'month' : null };
      const raw = JSON.stringify({ schemaVersion: 3, candidates: [representation] });
      const original = validateCandidateOutput(raw, material).candidates[0], snapshot = JSON.stringify(original);
      expect(original.amount, marker).toBe('8000.00');
      const reviewed = reviewCandidateAgainstSource(original, material) as FactCandidateV3;
      expect(reviewed.amount, marker).toBeNull();
      expect(reviewed.normalization.status, marker).toBe('unsupported');
      expect(reviewed.reviewIssues.map(issue => issue.code), marker).toContain('source_amount_context_mismatch');
      expect(reviewed.value).toBe('8000');
      expect(reviewed.quote).toBe('8000');
      expect(reviewed.representation).toEqual(representation);
      expect(JSON.stringify(original)).toBe(snapshot);
    }
  });

  it.each([
    ['rate', '人民币8000元'], ['rate', '8000人民币'],
    ['other_money', '人民币8000元'], ['other_money', '8000人民币'],
  ] as const)('keeps the RMB counterpart available for %s: %s', (meaning, literal) => {
    const material = source(`王甲在甲公司2024年7月${meaning === 'rate' ? '月薪' : '交通补贴'}${literal}。`);
    const representation: RawCandidateV3 = { ...entry('8000'), meaning, completeness: 'not_applicable', rateUnit: meaning === 'rate' ? 'month' : null };
    const raw = JSON.stringify({ schemaVersion: 3, candidates: [representation] });
    const original = validateCandidateOutput(raw, material).candidates[0];
    const reviewed = reviewCandidateAgainstSource(original, material) as FactCandidateV3;
    expect(reviewed.amount).toBe('8000.00');
    expect(reviewed.normalization.status).toBe('exact');
    expect(reviewed.reviewIssues).toEqual([]);
  });

  it.each(['人民币8000元', '8000元', '￥8000元', 'CNY8000元', '8000 CNY', '8000ＲＭＢ'])('retains ordinary RMB hints: %s', literal => {
    const { material, state } = stateFor(literal);
    const reviewed = reviewFactsAgainstSources(state, [material]);
    const candidate = reviewed.materials[0].candidates[0] as FactCandidateV3;
    expect(candidate.amount).toBe('8000.00');
    expect(candidate.normalization.status).toBe('exact');
    expect(candidate.reviewIssues).toEqual([]);
    expect(buildFactView(reviewed, [material]).fields.due.values).toEqual(['8000.00']);
  });

  it.each(['８０００港元', '八千美元'])('never upgrades already unavailable fullwidth or Chinese shorthand: %s', literal => {
    const value = literal.replace(/港元|美元/u, '');
    const { material, state } = stateFor(literal, value);
    expect(state.materials[0].candidates[0].amount).toBeNull();
    const reviewed = reviewFactsAgainstSources(state, [material]);
    expect(reviewed.materials[0].candidates[0].amount).toBeNull();
    expect(buildFactView(reviewed, [material]).fields.due.values).toEqual([]);
  });

  it('preserves explicit human confirmation and calculation authority when a currency hint is blocked', () => {
    const { material, raw } = stateFor('8000 USD');
    let { state } = stateFor('8000 USD');
    const candidateId = state.materials[0].candidates[0].id;
    for (const [field, amount] of [['due', '9000'], ['paid', '0']] as const) {
      state = applyFactAction(state, { action: 'confirm_amount', field, amount, note: '本人独立核实人民币总额并已核对外币候选差异', reviewedCandidateIds: [candidateId], complete: true, verified: true }, [material], ACTOR, AT);
    }
    const reviewed = reviewFactsAgainstSources(state, [material]);
    expect(reviewed.materials[0].candidates[0].amount).toBeNull();
    expect(reviewed.materials[0].raw).toBe(raw);
    expect(reviewed.confirmations).toEqual(state.confirmations);
    expect(prepareCalculation(reviewed, [material])).toEqual({ dueCents: 900000, paidCents: 0, generation: 1 });
  });

  it('applies the runtime guard to historical v2 without rewriting its original representation', () => {
    const material = source('王甲在甲公司2024年7月完整应付工资8000 USD。');
    const raw = JSON.stringify({ schemaVersion: 2, candidates: [entry('8000')] });
    const state = ingestV2(emptyFactState(1), material, validateV2(raw, material), 'v2', ACTOR, AT);
    expect(state.materials[0].candidates[0].amount).toBe('8000.00');
    const reviewed = reviewFactsAgainstSources(state, [material]), candidate = reviewed.materials[0].candidates[0];
    expect(candidate.amount).toBeNull();
    expect(Object.hasOwn(candidate, 'normalization')).toBe(false);
    expect(reviewed.materials[0].raw).toBe(raw);
    expect((candidate as unknown as { representation: RawCandidateV3 }).representation).toEqual(entry('8000'));
  });

  it('keeps frozen candidate normalization output intact while adding the runtime constraint', () => {
    const original = normalizeCandidateValue(entry('8000'));
    const { material, state } = stateFor('8000 USD');
    reviewFactsAgainstSources(state, [material]);
    expect(normalizeCandidateValue(entry('8000'))).toEqual(original);
    expect(original.amount).toBe('8000.00');
  });
});
