import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { daysUntil } from './client';

describe('deadline calendar days', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it.each(['2026-10-08T00:01:00+08:00', '2026-10-08T23:59:59+08:00'])('counts same, adjacent and later dates independently of the current hour (%s)', (clock) => {
    vi.stubEnv('TZ', 'Asia/Shanghai');
    vi.setSystemTime(new Date(clock));
    expect(new Date().getTimezoneOffset()).toBe(-480);
    expect(daysUntil('2026-10-08')).toBe(0);
    expect(daysUntil('2026-10-09')).toBe(1);
    expect(daysUntil('2026-10-07')).toBe(-1);
    expect(daysUntil('2026-10-20')).toBe(12);
  });

  it('uses the user local date when UTC falls on a different day', () => {
    vi.setSystemTime(new Date('2026-10-08T01:00:00Z'));
    vi.stubEnv('TZ', 'Pacific/Honolulu');
    expect(new Date().getDate()).toBe(7);
    expect(daysUntil('2026-10-08')).toBe(1);
    vi.stubEnv('TZ', 'Asia/Shanghai');
    expect(new Date().getDate()).toBe(8);
    expect(daysUntil('2026-10-08')).toBe(0);
  });

  it('handles year and leap-day boundaries', () => {
    vi.stubEnv('TZ', 'Asia/Shanghai');
    vi.setSystemTime(new Date('2026-12-31T12:00:00+08:00'));
    expect(daysUntil('2027-01-01')).toBe(1);
    vi.setSystemTime(new Date('2028-02-28T12:00:00+08:00'));
    expect(daysUntil('2028-02-29')).toBe(1);
    expect(daysUntil('2028-03-01')).toBe(2);
    vi.setSystemTime(new Date('2028-02-29T12:00:00+08:00'));
    expect(daysUntil('2028-03-01')).toBe(1);
  });

  it.each([
    ['2026-03-07T12:00:00-05:00', '2026-03-07', '2026-03-08', '2026-03-09'],
    ['2026-10-31T12:00:00-04:00', '2026-10-31', '2026-11-01', '2026-11-02'],
  ])('counts calendar dates across daylight-saving transitions (%s)', (clock, today, tomorrow, afterTomorrow) => {
    vi.stubEnv('TZ', 'America/New_York');
    vi.setSystemTime(new Date(clock));
    expect(new Date().getTimezoneOffset()).toBe(clock.includes('-05:00') ? 300 : 240);
    expect(daysUntil(today)).toBe(0);
    expect(daysUntil(tomorrow)).toBe(1);
    expect(daysUntil(afterTomorrow)).toBe(2);
  });

  it('rejects invalid and non-calendar date strings without normalizing them', () => {
    vi.setSystemTime(new Date('2026-10-08T00:00:00Z'));
    for (const value of [null, '', 'invalid', '2026-02-30', '2026-02-29', '2026-13-01', '2026-04-31', '2026-10-8', '2026-10-08T00:00:00Z', ' 2026-10-08']) {
      expect(daysUntil(value)).toBeNull();
    }
  });
});
