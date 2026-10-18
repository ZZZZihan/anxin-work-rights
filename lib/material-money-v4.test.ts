import { describe, expect, it } from 'vitest';
import type { RawCandidateV3 } from './material-fact-types-v3.ts';
import { canonicalMonetaryExpression, classifyMonetaryExpression, normalizeCandidateValueV4, normalizeMoneyValueV4 } from './material-money-v4.ts';

const money = (overrides: Partial<RawCandidateV3> = {}): RawCandidateV3 => ({ kind: 'money', value: '四万元', quote: '王甲工资四万元', blockId: 'b1', subject: '王甲', scope: 'individual', meaning: 'due_total', completeness: 'complete', period: null, rateUnit: null, assertion: 'narrated', ...overrides });

describe('v4 minimum Chinese-money regression', () => {
  it.each(['人民币四万元', '四万元', '四万零三元五角零分'])('parses strict lowercase amount %s', value => {
    expect(normalizeMoneyValueV4(value)).toMatchObject({ status: 'exact', amount: value.includes('三') ? '40003.50' : '40000.00' });
  });
  it('retains approximation on lowercase values', () => {
    expect(normalizeMoneyValueV4('工资约四万余元')).toMatchObject({ status: 'approximate', amount: null });
  });
});

describe('strict exact RMB spellings and original evidence', () => {
  it.each([
    ['人民币四万元', '40000.00'], ['四万元', '40000.00'], ['40000元', '40000.00'],
    ['工资四万元', '40000.00'], ['工资人民币四万元', '40000.00'], ['￥四万元', '40000.00'],
    ['一元', '1.00'], ['十元', '10.00'], ['一十元', '10.00'], ['十二元', '12.00'], ['一十二元', '12.00'],
    ['二十元', '20.00'], ['一百零一元', '101.00'], ['一千零一元', '1001.00'], ['一千零一十元', '1010.00'],
    ['两元', '2.00'], ['两百元', '200.00'], ['两千元', '2000.00'], ['两万元', '20000.00'], ['一千两百元', '1200.00'],
    ['四万零三元五角零分', '40003.50'], ['四万元整', '40000.00'], ['四万元正', '40000.00'],
    ['零元', '0.00'], ['〇元', '0.00'], ['零元零角零分', '0.00'], ['四元零角五分', '4.05'],
    ['四元零五分', '4.05'], ['四元五分', '4.05'], ['四元五角零分', '4.50'], ['四元零角', '4.00'],
    ['四元零分', '4.00'], ['四元两角两分', '4.22'], ['一亿零三万零五元', '100030005.00'],
    ['九千九百九十九亿九千九百九十九万九千九百九十九元九角九分', '999999999999.99'],
    ['工资13,381.90元', '13381.90'], ['工资66.32万元', '663200.00'], ['8000.000元', '8000.00'],
    ['人民币贰万捌仟元整', '28000.00'], ['零元伍分', '0.05'], ['40000', '40000.00'],
    ['工资约定为四万元', '40000.00'], ['2024年7月工资四万元', '40000.00'],
    ['二〇二四年七月工资四万元', '40000.00'], ['二十四人三个月工资共四万元', '40000.00'],
    ['2024-07-01至2024-07-31工资四万元', '40000.00'], ['工资起算后两倍工资四万元', '40000.00'],
  ])('parses %s exactly as %s', (value, amount) => {
    const normalized = normalizeMoneyValueV4(value);
    expect(normalized).toMatchObject({ rawValue: value, status: 'exact', amount });
    expect(Array.from(value).slice(normalized.span!.start, normalized.span!.end).join('')).toBe(normalized.matchedText);
  });

  it('uses Unicode code point offsets into the original value', () => {
    const value = '😀𠮷工资共计人民币四万零三元五角零分', normalized = normalizeMoneyValueV4(value);
    expect(normalized).toMatchObject({ status: 'exact', amount: '40003.50', matchedText: '人民币四万零三元五角零分', span: { start: 6, end: 18 } });
    expect(normalized.rawValue).toBe(value);
  });
});

describe('unsupported, non-exact and adjacent spellings never become zero', () => {
  it.each([
    ['一千一元', 'unsupported'], ['一万一元', 'unsupported'], ['一亿一元', 'unsupported'],
    ['四万三元', 'unsupported'], ['四万零零三元', 'unsupported'], ['四万零元', 'unsupported'],
    ['一百百元', 'unsupported'], ['百元', 'unsupported'], ['两十元', 'unsupported'], ['二十两元', 'unsupported'],
    ['二〇二四元', 'unsupported'], ['人民币四万万元', 'unsupported'], ['四万元元', 'unsupported'],
    ['四元五角六', 'unsupported'], ['四元五角五角', 'unsupported'], ['四元整五角', 'unsupported'],
    ['四元五分六分', 'unsupported'], ['四元五角伍分', 'unsupported'], ['四元零零分', 'unsupported'], ['零元零零分', 'unsupported'], ['四元五角零五分', 'unsupported'],
    ['一千万元伍分', 'unsupported'], ['伍仟元五角', 'unsupported'], ['4万元五角', 'unsupported'],
    ['一万亿元', 'unsupported'], ['1000000000000元', 'unsupported'], ['8000.005元', 'unsupported'], ['12,34元', 'unsupported'],
    ['-四万元', 'unsupported'], ['负 四万元', 'unsupported'], ['＋四万元', 'unsupported'],
    ['−四万元', 'unsupported'], ['人民币-四万元', 'unsupported'], ['美元四万元', 'unsupported'],
    ['USD40000元', 'unsupported'], ['四万日元', 'unsupported'], ['±四万元', 'unsupported'],
    ['四万元和五万元', 'multiple_amounts'], ['四万元及四万元', 'multiple_amounts'],
    ['四万元另付五千', 'multiple_amounts'], ['四万元另有五千', 'multiple_amounts'], ['四万元 五千', 'multiple_amounts'], ['五千和四万元', 'multiple_amounts'], ['四万元和500', 'multiple_amounts'], ['40000元五角', 'unsupported'],
    ['四万至五万元', 'range'], ['四万元到五万元', 'range'], ['四万—五万元', 'range'], ['40000元-五万元', 'range'],
    ['工资约四万余元', 'approximate'], ['四万元左右', 'approximate'], ['四万余元', 'approximate'],
    ['四万多元', 'approximate'], ['近四万元', 'approximate'], ['不低于四万元', 'approximate'], ['四万元起', 'approximate'],
    ['工资可能四万元', 'uncertain'], ['暂计四万元', 'uncertain'],
    ['工资未知', 'masked'], ['工资未提供', 'masked'], ['四万X元', 'masked'], ['工资?元', 'masked'],
    ['四万…元', 'masked'], ['四万__元', 'masked'], ['10%工资四万元', 'percentage'],
  ])('keeps %s unavailable (%s)', (value, status) => {
    expect(normalizeMoneyValueV4(value)).toMatchObject({ rawValue: value, status, amount: null, span: null, matchedText: null });
  });
  it('does not truncate overlong raw input', () => {
    const value = `四万元${'字'.repeat(4000)}`;
    expect(normalizeMoneyValueV4(value)).toMatchObject({ rawValue: value, status: 'unsupported', amount: null });
  });
});

describe('conservative monetary comparison keys preserve limits', () => {
  it('equates exact RMB spellings', () => {
    expect(new Set(['人民币四万元', '四万元', '40000元'].map(canonicalMonetaryExpression))).toEqual(new Set(['exact:40000.00']));
  });
  it.each(['工资', '劳务费', '劳动报酬', ''])('allows only a finite wage suffix: %s', suffix => {
    expect(canonicalMonetaryExpression(`约115万元${suffix}`)).toBe(canonicalMonetaryExpression('约一百一十五万元'));
    expect(canonicalMonetaryExpression(`约115万元${suffix}`)).toBe('approximate:约:1150000.00:');
  });
  it('never merges exact, approximate, range, upper, lower, uncertain or different qualifier words', () => {
    const values = ['115万元', '约115万元', '至少115万元', '不超过115万元', '115万元以上', '115万元以下', '可能115万元', '大约115万元'];
    const keys = values.map(canonicalMonetaryExpression);
    expect(keys.every(Boolean)).toBe(true);
    expect(new Set(keys).size).toBe(values.length);
    expect(canonicalMonetaryExpression('115万元至116万元')).toBeNull();
  });
  it.each(['约115万元工资和补偿', '工资约115万元', '约115万元另付五千元', '未知', '0元至1元', '约115万元奖金'])('does not guess a comparison key for %s', value => {
    expect(canonicalMonetaryExpression(value)).toBeNull();
  });
  it.each(['人民币四十二万余元', '四十二万余元', '人民币420000余元', '四十二万余元工资'])('compares a finite RMB prefix and inner approximation without making %s exact', value => {
    expect(canonicalMonetaryExpression(value)).toBe('approximate::420000.00::inner=余');
    expect(normalizeMoneyValueV4(value)).toMatchObject({ status: 'approximate', amount: null });
  });
  it.each(['人民币约四十二万余元', '约人民币四十二万余元', '约420000余元'])('retains every qualifier in %s', value => {
    expect(canonicalMonetaryExpression(value)).toBe('approximate:约:420000.00::inner=余');
    expect(canonicalMonetaryExpression(value)).not.toBe(canonicalMonetaryExpression('四十二万余元'));
    expect(canonicalMonetaryExpression(value)).not.toBe(canonicalMonetaryExpression('约四十二万元'));
    expect(normalizeMoneyValueV4(value).amount).toBeNull();
  });
  it('normalizes only a finite currency prefix on simple approximate expressions', () => {
    expect(canonicalMonetaryExpression('人民币近四十二万元')).toBe(canonicalMonetaryExpression('近人民币四十二万元'));
    expect(canonicalMonetaryExpression('人民币四十二万元左右')).toBe(canonicalMonetaryExpression('四十二万元左右'));
    expect(canonicalMonetaryExpression('四十二万余元')).not.toBe(canonicalMonetaryExpression('四十二万多元'));
  });
});

describe('independent exact-money false-positive probes', () => {
  it.each(['四点五元', '人民币四点五元', '四万加上五千元', '四万另加五千元', '一又二分之一元'])('does not select a tail amount from unsupported Chinese numeric context: %s', value => {
    const normalized = normalizeMoneyValueV4(value);
    expect(normalized.amount).toBeNull();
    expect(canonicalMonetaryExpression(value)).toBeNull();
  });
  it.each([
    ['四万元', '王甲工资四万元 五角'], ['四万元', '王甲工资十 四万元'],
    ['四万元', '王甲工资四万元/月'], ['四万元', '王甲工资四万元/天'], ['四万元', '王甲工资四万元美元'],
  ])('does not upgrade clipped value %s in %s to an exact total', (value, quote) => {
    expect(normalizeCandidateValueV4(money({ value, quote })).amount).toBeNull();
  });
  it.each([
    ['五元', '王甲工资四点五元'], ['一元', '王甲工资一又二分之一元'],
    ['五千元', '王甲工资四万加上五千元'], ['五千元', '王甲工资四万另加五千元'],
  ])('also rejects unsupported numeric context outside the clipped value %s in %s', (value, quote) => {
    expect(normalizeCandidateValueV4(money({ value, quote })).amount).toBeNull();
  });
});

describe('candidate source qualifier and role boundaries', () => {
  it.each([
    ['王甲工资四万元', '四万元', 'exact'], ['王甲工资约四万元', '四万元', 'approximate'],
    ['王甲工资四万元左右', '四万元', 'approximate'], ['王甲工资四万元/月以上', '四万元', 'rate_unit_mismatch'],
    ['王甲工资四万至五万元', '五万元', 'range'], ['王甲工资四万元到五万元', '四万元', 'range'],
    ['王甲工资四万元或五万元', '四万元', 'uncertain'], ['王甲工资可能四万元', '四万元', 'uncertain'],
    ['王甲工资四万元，另付四万元', '四万元', 'uncertain'], ['王甲工资十四万元', '四万元', 'unsupported'],
    ['王甲工资四万元五角', '四万元', 'unsupported'], ['王甲工资负四万元', '四万元', 'unsupported'],
    ['王甲工资USD四万元', '四万元', 'unsupported'], ['王甲工资四万元', '五万元', 'uncertain'],
    ['王甲工资约五万元，另一笔四万元', '四万元', 'exact'],
  ])('keeps context binding in %s', (quote, value, status) => {
    const normalized = normalizeCandidateValueV4(money({ value, quote }));
    expect(normalized.normalization).toMatchObject({ rawValue: value, status });
    expect(normalized.amount).toBe(status === 'exact' ? '40000.00' : null);
  });
  it('preserves date and rate-role protections', () => {
    expect(normalizeCandidateValueV4(money({ kind: 'date', value: '二〇二四年七月', quote: '二〇二四年七月', meaning: 'wage_period', completeness: 'not_applicable' })).normalization.status).toBe('not_money');
    expect(normalizeCandidateValueV4(money({ value: '四万元/月', quote: '工资四万元/月' })).normalization.status).toBe('rate_unit_mismatch');
    expect(normalizeCandidateValueV4(money({ value: '四万元/天', quote: '工资四万元/天', meaning: 'rate', completeness: 'not_applicable', rateUnit: 'month' })).normalization.status).toBe('rate_unit_mismatch');
  });
  it.each([
    ['工资40000元', '40000', 'exact'], ['工资人民币40000', '40000', 'exact'], ['工资￥40000', '40000', 'exact'],
    ['工资40000元整', '40000', 'exact'], ['工资40000', '40000', 'unsupported'],
    ['工资400000元', '40000', 'unsupported'], ['工资40000元五角', '40000', 'unsupported'],
    ['工资人民币40000.50元', '40000', 'unsupported'],
  ])('allows a bare value only with an intact source currency anchor: %s', (quote, value, status) => {
    expect(normalizeCandidateValueV4(money({ value, quote })).normalization.status).toBe(status);
  });
});

describe('three-way classification does not require ASCII digits', () => {
  it.each(['四万元', '人民币四万元', '约四万元', '四万至五万元', '工资未知', '工资未提供', '尚欠X元', '工资?元', '美元四万元'])('recognizes monetary %s', value => {
    expect(classifyMonetaryExpression(value).kind).toBe('monetary');
  });
  it.each(['二〇二四年七月', '2024年7月', '2024-07-01', '每月十五日', '三人', '两名', '五个人', '二十四名工人', '三个月', '工作三十分钟', '工资按月发放', '工资', '2020年12月基本工资', '2019年11月至2020年12月的其他工资', '二〇二〇年十二月基本工资', ''])('positively recognizes non-monetary %s', value => {
    expect(classifyMonetaryExpression(value)).toMatchObject({ kind: 'not_monetary', normalization: { status: 'not_money', amount: null } });
  });
  it.each(['未知', '四万', '没有进一步说明', '若干', '未明确'])('retains undetermined %s', value => {
    expect(classifyMonetaryExpression(value).kind).toBe('undetermined');
    expect(classifyMonetaryExpression(value).normalization.amount).toBeNull();
  });
});

describe('v7 integration compatibility and definite wage descriptions', () => {
  it.each(['某月工资', '7月份工资', '七月份工资', '本月工资', '离职前工资', '工资合计'])('rejects the definite non-money phrase %s', value => {
    expect(classifyMonetaryExpression(value).kind).toBe('not_monetary');
  });
  it.each(['8000 CNY', 'CNY8000', '8000 RMB', '8000ＲＭＢ', '8000人民币', '￥8000元'])('keeps directly attached RMB context: %s', quote => {
    const raw = { kind: 'money', value: '8000', quote, blockId: 'b', subject: null, scope: 'unknown', meaning: 'other_money', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated' } as const;
    expect(normalizeCandidateValueV4(raw).amount).toBe('8000.00');
  });
});
