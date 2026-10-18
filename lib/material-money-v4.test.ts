import { describe, expect, it } from 'vitest';
import type { RawCandidateV3 } from './material-fact-types-v3.ts';
import { canonicalMonetaryExpression, classifyMonetaryExpression, normalizeCandidateValueV4, normalizeMoneyValueV4 } from './material-money-v4.ts';

const money = (overrides: Partial<RawCandidateV3> = {}): RawCandidateV3 => ({ kind: 'money', value: '四万元', quote: '王甲工资四万元', blockId: 'b1', subject: '王甲', scope: 'individual', meaning: 'due_total', completeness: 'complete', period: null, rateUnit: null, assertion: 'narrated', ...overrides });

describe('attached arithmetic minimum regression', () => {
  it('does not treat an amount operand as the result of its attached multiplier', () => {
    expect(normalizeMoneyValueV4('四万元的2倍')).toMatchObject({ rawValue: '四万元的2倍', status: 'unsupported', amount: null, matchedText: null, span: null });
  });
  it('retains a clipped monetary operand as unavailable in its source multiplier', () => {
    expect(normalizeCandidateValueV4(money({ quote: '王甲工资四万元的2倍' }))).toMatchObject({ value: '四万元', amount: null, normalization: { status: 'unsupported', rawValue: '四万元' } });
  });
});

describe('explicit arithmetic continuation minimum regression', () => {
  it('does not lose an explicitly attached multiplier at an OCR line break', () => {
    expect(normalizeMoneyValueV4('四万元的\n2倍')).toMatchObject({ rawValue: '四万元的\n2倍', status: 'unsupported', amount: null });
  });
  it.each(['四万元的\n2倍', '四万元×\n2'])('checks the unique full quote arithmetic edges of %s', expression => {
    expect(normalizeCandidateValueV4(money({ quote: `王甲工资${expression}。` }))).toMatchObject({ value: '四万元', amount: null, normalization: { rawValue: '四万元', status: 'unsupported' } });
  });
});

describe('monetary operands retain attached multiplication and division', () => {
  const expressions = [
    '四万元的二倍', '四万元的两倍', '四万元的2.5倍', '四万元的２．５倍', '四万元2倍',
    '四万元 的 2 倍', '四万元\u200d的\u200d两\u200d倍', '四万元　的　２　倍',
    '2倍四万元', '两倍的四万元', '２．５倍 的 四万元', '二\u200d倍的四万元',
    '2乘以四万元', '二乘四万元', '2×四万元', '２ｘ四万元', '2*四万元', '２＊四万元', '2除以四万元', '二÷四万元',
    '四万元乘以二', '四万元 乘 2', '四万元×2', '四万元x二', '四万元＊2', '四万元*２．５',
    '四万元÷2', '四万元/2', '四万元／２', '四万元除以二', '四万元 除以 两',
    '四万元\u200d×\u200d2', '四万元\u200d／\u200d２', '2\u200d×\u200d四万元',
    '四万元的\n两倍', '四万元×\n2', '四万元乘以\n2', '四万元\n的2倍', '2倍的\n四万元', '2×\n四万元',
    '四万元+2', '四万元加上二', '二加上四万元', '四万元减去二', '二减去四万元', '四万元+\n2',
  ];
  it.each(expressions)('does not interpret the operand in %s as a computed amount', value => {
    expect(normalizeMoneyValueV4(value)).toMatchObject({ rawValue: value, status: 'unsupported', amount: null, matchedText: null, span: null });
    expect(canonicalMonetaryExpression(value)).toBeNull();
  });
  it.each(expressions)('also guards the clipped monetary operand in source %s', expression => {
    const candidate = money({ quote: `王甲工资为${expression}。` });
    expect(normalizeCandidateValueV4(candidate)).toMatchObject({ value: '四万元', amount: null, normalization: { rawValue: '四万元', status: 'unsupported', matchedText: null, span: null } });
    expect(candidate.quote).toBe(`王甲工资为${expression}。`);
  });
  it.each([
    ['40000', '工资40000元的2倍'], ['40000', '工资40000人民币的2倍'],
    ['40000', '工资2倍的人民币40000元'], ['四万元', '工资2倍的人民币四万元'],
    ['四万元', '工资四万元人民币的两倍'], ['四万元', '工资四万元整的2倍'],
  ])('preserves the operation when clipped %s omits currency or a terminal unit in %s', (value, quote) => {
    expect(normalizeCandidateValueV4(money({ value, quote }))).toMatchObject({ value, amount: null, normalization: { status: 'unsupported', rawValue: value } });
  });
  it.each([
    '三人工资共四万元', '两名工人工资共四万元', '二十四人三个月工资共四万元',
    '工资起算后两倍工资四万元', '两倍工资共四万元',
    '四万元。王乙加班工资按2倍发放', '四万元；王乙奖金按两倍计',
    '四万元\n王乙加班工资按二倍计', '四万元。另有三人',
  ])('does not borrow an unrelated count or multiplier in %s', value => {
    const normalized = normalizeMoneyValueV4(value);
    expect(normalized).toMatchObject({ rawValue: value, status: 'exact', amount: '40000.00' });
    expect(Array.from(value).slice(normalized.span!.start, normalized.span!.end).join('')).toBe(normalized.matchedText);
    expect(normalizeCandidateValueV4(money({ quote: `王甲工资${value}` })).amount).toBe('40000.00');
  });
  it.each(['四万元/月', '四万元/天', '四万元/小时', '四万元/件'])('keeps a real rate denominator separate from arithmetic in %s', value => {
    expect(normalizeMoneyValueV4(value)).toMatchObject({ status: 'exact', amount: '40000.00' });
  });
  it('preserves a compatible source-bound monthly rate and a total/rate mismatch', () => {
    const quote = '王甲月工资四万元/月';
    expect(normalizeCandidateValueV4(money({ quote, meaning: 'rate', rateUnit: 'month', completeness: 'not_applicable' })).amount).toBe('40000.00');
    expect(normalizeCandidateValueV4(money({ quote })).normalization.status).toBe('rate_unit_mismatch');
  });
  it.each(['四万元-2', '四万元－２', '2-四万元', '四万元至五万元'])('keeps a subtraction or possible range unavailable in %s', expression => {
    expect(normalizeMoneyValueV4(expression).amount).toBeNull();
    expect(normalizeCandidateValueV4(money({ quote: `王甲工资${expression}。` })).amount).toBeNull();
  });
  it.each(['四万元的二分之一', '四万元的一半', '四万元的50%', '四万元的百分之五十'])('does not turn the operand of a finite fraction into the resulting amount in %s', expression => {
    expect(normalizeMoneyValueV4(expression).amount).toBeNull();
    expect(canonicalMonetaryExpression(expression)).toBeNull();
    expect(normalizeCandidateValueV4(money({ quote: `王甲工资${expression}。` }))).toMatchObject({ value: '四万元', amount: null, normalization: { rawValue: '四万元' } });
  });
  it.each(['工资未知', '四万X元', '工资未明确', '四万至五万元'])('keeps unresolved evidence unavailable in %s', value => {
    expect(normalizeMoneyValueV4(value).amount).toBeNull();
    expect(classifyMonetaryExpression(value).kind).toBe('monetary');
  });
});

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
    ['人民币四万元', '40000.00'], ['四万元', '40000.00'], ['40000元', '40000.00'], ['40000元五角', '40000.50'],
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
    ['四万元另付五千', 'multiple_amounts'], ['四万元另有五千', 'multiple_amounts'], ['四万元 五千', 'multiple_amounts'], ['五千和四万元', 'multiple_amounts'], ['四万元和500', 'multiple_amounts'],
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
  it('rejects a definite relative-month wage description without an amount', () => {
    expect(classifyMonetaryExpression('这个月工资')).toMatchObject({ kind: 'not_monetary', normalization: { status: 'not_money', amount: null } });
  });
  it.each(['某月工资', '7月份工资', '七月份工资', '本月工资', '离职前工资', '工资合计'])('rejects the definite non-money phrase %s', value => {
    expect(classifyMonetaryExpression(value).kind).toBe('not_monetary');
  });
  it.each(['8000 CNY', 'CNY8000', '8000 RMB', '8000ＲＭＢ', '8000人民币', '￥8000元'])('keeps directly attached RMB context: %s', quote => {
    const raw = { kind: 'money', value: '8000', quote, blockId: 'b', subject: null, scope: 'unknown', meaning: 'other_money', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated' } as const;
    expect(normalizeCandidateValueV4(raw).amount).toBe('8000.00');
  });
});

describe('relative-month wage descriptions retain the three-way money boundary', () => {
  const relativeMonths = ['上月', '上个月', '上一个月', '下月', '下个月', '下一个月', '本月', '当月', '该月', '这月', '这个月', '某月', '每月'];
  it.each(relativeMonths)('identifies a complete wage description for %s without inventing an amount', month => {
    for (const value of [`${month}工资`, `${month}的基本工资`, `${month}劳务费合计`, `${month}其他劳动报酬总额`]) {
      expect(classifyMonetaryExpression(value)).toMatchObject({ kind: 'not_monetary', normalization: { rawValue: value, status: 'not_money', amount: null } });
    }
  });
  it.each(relativeMonths)('retains unknown, masked, ranged and precise amounts for %s', month => {
    for (const [suffix, status] of [['工资未明确', 'masked'], ['工资X元', 'masked'], ['工资四万元至五万元', 'range'], ['工资约四万元', 'approximate']] as const) {
      const value = `${month}${suffix}`;
      expect(classifyMonetaryExpression(value)).toMatchObject({ kind: 'monetary', normalization: { rawValue: value, status, amount: null } });
    }
    const value = `${month}工资四万元`;
    expect(classifyMonetaryExpression(value)).toMatchObject({ kind: 'monetary', normalization: { rawValue: value, status: 'exact', amount: '40000.00' } });
  });
  it.each(['这个月工资若干', '当月工资四万', '下一个月工资待核'])('keeps the unresolved expression %s available for review', value => {
    expect(classifyMonetaryExpression(value).kind).toBe('undetermined');
    expect(classifyMonetaryExpression(value).normalization.amount).toBeNull();
  });
});

describe('PR45 minimal literal and modifier regressions', () => {
  it.each(['四万元港幣', '新台币1000元', '加拿大元1000元', '新台币工资1000元'])('does not convert the foreign literal %s to RMB', value => {
    expect(normalizeMoneyValueV4(value)).toMatchObject({ rawValue: value, amount: null });
    expect(canonicalMonetaryExpression(value)).toBeNull();
  });
  it.each(['数十万元', '几十万元', '负数四万元', '负值四万元'])('does not select a positive exact tail from %s', value => {
    expect(normalizeMoneyValueV4(value)).toMatchObject({ rawValue: value, amount: null });
    expect(canonicalMonetaryExpression(value)).toBeNull();
  });
  it.each(['数十万元', '几十万元'])('keeps the source modifier outside the cropped value in %s', literal => {
    expect(normalizeCandidateValueV4(money({ value: '十万元', quote: `王甲工资为${literal}` })).amount).toBeNull();
  });
  it.each(['2024年元月工资', '元月份工资', '元旦工资', '圆满完成工资发放', '元月', '元旦', '圆满'])('does not treat the ordinary phrase %s as money', value => {
    expect(classifyMonetaryExpression(value)).toMatchObject({ kind: 'not_monetary', normalization: { status: 'not_money', amount: null } });
  });
});

describe('shared attached amount qualifiers and adjacent counterexamples', () => {
  it.each([
    ['逾四万元', '四万元'], ['不到四万元', '四万元'], ['不止四万元', '四万元'],
    ['四万元出头', '四万元'], ['四万元有余', '四万元'], ['四万元许', '四万元'], ['好几万元', '万元'],
  ])('keeps the complete and cropped forms of %s non-exact', (value, cropped) => {
    expect(normalizeMoneyValueV4(value)).toMatchObject({ rawValue: value, status: 'approximate', amount: null });
    expect(canonicalMonetaryExpression(value)).not.toBe(canonicalMonetaryExpression('四万元'));
    expect(normalizeCandidateValueV4(money({ value: cropped, quote: `王甲工资为${value}` })).amount).toBeNull();
  });
  it.each(['最近工资四万元', '工资最近四万元', '工资约定为四万元', '工资数额为四万元', '三个月工资共四万元', '三个员工工资共四万元', '元旦工资四万元', '元月工资四万元', '圆满完成工资四万元的发放'])('keeps an independently complete amount in %s', quote => {
    expect(normalizeMoneyValueV4(quote).amount).toBe('40000.00');
    expect(normalizeCandidateValueV4(money({ quote })).amount).toBe('40000.00');
  });
  it.each(['三个员工', '三位工人', '三个劳动者'])('recognizes the explicit headcount %s without inventing money', value => {
    expect(classifyMonetaryExpression(value).kind).toBe('not_monetary');
    expect(normalizeMoneyValueV4(value).amount).toBeNull();
  });
});

describe('adjacent currency, modifier and ordinary-word boundaries', () => {
  it.each(['1000元新臺幣', 'ＣＡＤ1000元', 'ＮＴ＄1000元', '加\u200b拿大元工资1000元', '1000元加\u200b元'])('uses the shared folded foreign-currency vocabulary for %s', value => {
    expect(normalizeMoneyValueV4(value)).toMatchObject({ rawValue: value, status: 'unsupported', amount: null, span: null });
    expect(canonicalMonetaryExpression(value)).toBeNull();
  });
  it.each([
    ['數十万元', '十万元'], ['幾十万元', '十万元'], ['数百万元', '百万元'], ['数 人民币十万元', '十万元'],
    ['负值为人民币四万元', '四万元'], ['負數四万元', '四万元'], ['負值金額為四万元', '四万元'], ['正数四万元', '四万元'],
    ['负数：四万元', '四万元'], ['负的四万元', '四万元'],
    ['负\u200d四万元', '四万元'], ['数\u200d十万元', '十万元'],
  ])('shares the whole/source modifier boundary for %s', (value, cropped) => {
    expect(normalizeMoneyValueV4(value)).toMatchObject({ rawValue: value, amount: null, span: null });
    expect(canonicalMonetaryExpression(value)).toBeNull();
    expect(normalizeCandidateValueV4(money({ value: cropped, quote: `😀王甲工资为${value}` })).amount).toBeNull();
  });
  it.each(['元月份', '2024年元月', '2024年元月份的基本工资', '二〇二四年元旦工资', '圓滿', '圆满完成工资支付工作'])('recognizes a complete non-money phrase %s', value => {
    expect(classifyMonetaryExpression(value).kind).toBe('not_monetary');
    expect(normalizeMoneyValueV4(value).amount).toBeNull();
  });
  it.each(['元月工资未知', '元旦工资未明确', '圆满完成工资发放但金额不详', '元月X元', '元旦?元'])('keeps unknown or masked monetary evidence in %s', value => {
    expect(classifyMonetaryExpression(value).kind).toBe('monetary');
    expect(normalizeMoneyValueV4(value)).toMatchObject({ rawValue: value, status: 'masked', amount: null });
  });
  it.each(['2024元旦工资', '四万元素', '四万圆满'])('does not crop a unit out of an ordinary word in %s', value => {
    expect(normalizeMoneyValueV4(value).amount).toBeNull();
  });
  it('does not borrow a foreign currency from a different source event', () => {
    expect(normalizeCandidateValueV4(money({ quote: '王甲工资四万元，王乙工资1000美元' })).amount).toBe('40000.00');
  });
});

describe('repeated RMB range endpoint regression', () => {
  it.each([
    ['人民币3万元', '王甲工资人民币3万元至人民币4万元'],
    ['4万元', '王甲工资人民币3万元至人民币4万元'],
    ['三万元', '王甲工资人民币三万元到人民币四万元'],
    ['四万元', '王甲工资人民币三万元到人民币四万元'],
  ])('never makes cropped endpoint %s exact in %s', (value, quote) => {
    expect(normalizeCandidateValueV4(money({ value, quote }))).toMatchObject({ value, amount: null, normalization: { rawValue: value, status: 'range', span: null } });
  });
  it.each([
    ['三万元', '王甲工资人民币三万元到人民幣四万元'], ['四万元', '王甲工资人民币三万元到人民幣四万元'],
    ['30000元', '王甲工资CNY30000元~RMB40000元'], ['40000元', '王甲工资CNY30000元~RMB40000元'],
    ['30000元', '王甲工资￥30000元～￥40000元'], ['40000元', '王甲工资￥30000元～￥40000元'],
    ['3万元', '王甲工资人民币3万元至ＲＭＢ４万元'], ['4万元', '王甲工资人民币３万元至人民币4万元'],
    ['3万元', '王甲工资人民币3万元至人民\u200d币4万元'], ['4万元', '王甲工资人民\u200d币3万元至人民币4万元'],
    ['3万元', '王甲工资人民币3万元 \u200d至 \u200d人民币4万元'], ['4万元', '王甲工资人民币3万元 \u200d至 \u200d人民币4万元'],
    ['3万元', '王甲工资人民币3万元至　人民币 4万元'], ['4万元', '王甲工资人民币3万元至　人民币 4万元'],
    ['人民币4万元', '王甲工资人民币3万元至人民币4万元'],
    ['30000', '王甲工资30000元至人民币40000元'], ['40000', '王甲工资30000元至人民币40000元'],
    ['30000', '王甲工资30000人民币至40000人民币'], ['40000', '王甲工资30000CNY至40000RMB'],
    ['4元', '王甲工资3元五角至人民币4元'],
  ])('preserves the range modifier around exact-looking %s in %s', (value, quote) => {
    expect(normalizeCandidateValueV4(money({ value, quote }))).toMatchObject({ value, amount: null, normalization: { rawValue: value, status: 'range', span: null } });
  });
  it.each([
    '人民币3万元至人民币4万元', '人民币三万元到人民幣四万元', 'CNY30000元~RMB40000元', '￥30000元～￥40000元',
    '人民币3万元至ＲＭＢ４万元', '人民\u200d币3万元至人民\u200d币4万元', '人民币3万元 \u200d至 \u200d人民币4万元',
    '人民币3万元至　人民币 4万元', '30000人民币至40000人民币', '30000CNY至40000RMB', '3元五角至人民币4元',
  ])('keeps the complete range %s unavailable without changing its raw text', value => {
    expect(normalizeMoneyValueV4(value)).toMatchObject({ rawValue: value, status: 'range', amount: null, matchedText: null, span: null });
    expect(canonicalMonetaryExpression(value)).toBeNull();
  });
  it.each([
    '王甲工资人民币3万元，王乙工资人民币4万元', '王甲工资人民币3万元。王乙工资人民币4万元',
    '王甲工资人民币3万元\n王乙工资人民币4万元', '王甲工资人民币3万元到期支付', '王甲持人民币3万元至法院办理领款',
  ])('does not turn an independent exact event into a range in %s', quote => {
    expect(normalizeCandidateValueV4(money({ value: '人民币3万元', quote })).amount).toBe('30000.00');
  });
});
