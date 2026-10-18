import { describe, expect, it } from 'vitest';
import { isRecord, statusForStep, validAmount, validDate } from './validation';

describe('case input contract', () => {
  it('rejects coercion and unsafe monetary values', () => {
    for (const value of ['not-a-number', Infinity, NaN, -1, 1.2, {}, null, true, 1_000_000_001]) expect(validAmount(value)).toBe(false);
    for (const value of ['', 0, '12480', 1_000_000_000]) expect(validAmount(value)).toBe(true);
  });
  it('checks calendar dates including leap days', () => {
    for (const value of ['bad-date', '2026-02-29', '2026-04-31', '2026-13-01']) expect(validDate(value)).toBe(false);
    for (const value of ['2028-02-29', '2026-10-08', '', null]) expect(validDate(value)).toBe(true);
  });
  it('rejects non-object request bodies', () => {
    for (const value of [null, [], 1, 'text']) expect(isRecord(value)).toBe(false);
    expect(isRecord({})).toBe(true);
  });
  it('defines a single status for each work stage', () => {
    expect([0, 1, 2, 3, 4].map(statusForStep)).toEqual(['collecting', 'collecting', 'negotiating', 'arbitration', 'completed']);
  });
});
