import { describe, expect, it } from 'vitest';
import type { RawCandidateV3 } from './material-fact-types-v3';
import { canonicalMonetaryExpression, normalizeCandidateValueV4, normalizeMoneyValueV4 } from './material-money-v4';

const candidate = (value: string, quote: string): RawCandidateV3 => ({ kind: 'money', value, quote, blockId: 'b1', subject: null, scope: 'unknown', meaning: 'due_total', completeness: 'unknown', period: null, rateUnit: null, assertion: 'narrated' });

describe('independent exact-money false-positive probes', () => {
  it.each(['四点五元', '人民币四点五元', '四万加上五千元', '四万另加五千元', '一又二分之一元'])('does not select a tail amount from unsupported Chinese numeric context: %s', value => {
    const normalized = normalizeMoneyValueV4(value);
    expect(normalized.amount).toBeNull();
    expect(canonicalMonetaryExpression(value)).toBeNull();
  });

  it.each([
    ['四万元', '王甲工资四万元 五角'],
    ['四万元', '王甲工资十 四万元'],
    ['四万元', '王甲工资四万元/月'],
    ['四万元', '王甲工资四万元/天'],
    ['四万元', '王甲工资四万元美元'],
  ])('does not upgrade clipped value %s in %s to an exact total', (value, quote) => {
    expect(normalizeCandidateValueV4(candidate(value, quote)).amount).toBeNull();
  });
});
