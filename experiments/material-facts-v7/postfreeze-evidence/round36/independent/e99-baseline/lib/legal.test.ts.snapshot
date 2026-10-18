import { describe, expect, it } from 'vitest';
import { buildLegalGuidance } from './legal';

describe('buildLegalGuidance', () => {
  it('routes wage questions to official wage and arbitration sources', () => {
    const result = buildLegalGuidance('公司拖欠工资怎么办？');
    expect(result.content).toContain('第三十条');
    expect(result.sources.map((source) => source.url)).toContain(
      'https://www.npc.gov.cn/npc/c2/c183/c198/201905/t20190522_28233.html',
    );
  });

  it('does not make an outcome prediction', () => {
    const result = buildLegalGuidance('我被口头辞退了');
    expect(result.content).not.toMatch(/胜率|稳赢|一定能/);
    expect(result.content).toContain('需要结合');
  });

  it('describes the work injury route conservatively', () => {
    const result = buildLegalGuidance('上班时受伤了');
    expect(result.content).toContain('30 日');
    expect(result.content).toContain('所在地人社部门');
  });
});
