import type { LegalGuidance, LegalSource, WorkCase } from './types';

export const LEGAL_REVIEWED_AT = '2026-08-24';

export const OFFICIAL_SOURCES = {
  laborLaw44: {
    title: '《中华人民共和国劳动法》第四十四条',
    url: 'https://www.npc.gov.cn/c2/c30834/201905/t20190521_296651.html',
    detail: '全国人大：延时、休息日和法定休假日加班工资标准',
  },
  contractLaw: {
    title: '《中华人民共和国劳动合同法》',
    url: 'https://www.mohrss.gov.cn/xxgk2020/fdzdgknr/zcfg/fl/202011/t20201102_394622_wap.html',
    detail: '人社部：工资支付、解除劳动合同与赔偿规则',
  },
  arbitrationLaw: {
    title: '《劳动争议调解仲裁法》',
    url: 'https://www.npc.gov.cn/npc/c2/c183/c198/201905/t20190522_28233.html',
    detail: '全国人大：仲裁时效、申请和举证等程序规则',
  },
  injuryRules: {
    title: '《工伤保险条例》',
    url: 'https://xzfg.moj.gov.cn/front/law/detail?LawID=610',
    detail: '司法部法规库：工伤范围与认定申请期限',
  },
  service12333: {
    title: '全国人力资源和社会保障政务服务平台',
    url: 'https://12333.gov.cn/',
    detail: '官方服务平台；12333 可咨询所在地人社部门',
  },
} satisfies Record<string, LegalSource>;

export const QUICK_QUESTIONS = [
  '公司拖欠工资，我应该先准备什么？',
  '没有劳动合同，哪些材料可以证明劳动关系？',
  '被口头辞退后，下一步怎么留证？',
  '发生工伤后，认定申请有哪些期限？',
];

export function buildLegalGuidance(message: string, activeCase?: WorkCase): LegalGuidance {
  const query = message.trim();
  const context = activeCase
    ? `结合你当前的“${activeCase.company} · ${activeCase.type}”案件，`
    : '';

  if (/工伤|受伤|职业病/.test(query)) {
    return {
      content: `${context}先把就医记录、事故发生时间地点、现场照片、证人联系方式和劳动关系材料分别保存。单位通常应自事故伤害发生之日起 30 日内申请工伤认定；单位未申请时，职工、近亲属或工会可在条例规定期限内直接申请。不同地区受理材料可能有差异，建议同时向所在地人社部门或 12333 核实。\n\n这是一份办事路径提示，不是对个案结果的判断。`,
      sources: [OFFICIAL_SOURCES.injuryRules, OFFICIAL_SOURCES.service12333],
    };
  }

  if (/加班|调休|延时/.test(query)) {
    return {
      content: `${context}可以先按“日期—起止时间—工作内容—安排人—对应证据”整理加班清单，并保留考勤、排班、工作群消息、邮件和交付记录。劳动法第四十四条区分延时工作、休息日工作和法定休假日工作，对应的最低工资报酬标准分别为工资的 150%、200% 和 300%；休息日安排补休的处理与另外两类不同。\n\n计算前还需要确认工资基数、工时制度和当地口径。`,
      sources: [OFFICIAL_SOURCES.laborLaw44, OFFICIAL_SOURCES.service12333],
    };
  }

  if (/辞退|开除|解除|裁员/.test(query)) {
    return {
      content: `${context}先不要只依赖口头说法：保存解除通知、聊天记录、录音原文件、考勤和工资流水，并书面询问解除日期与理由。是否属于违法解除，需要结合合同、规章制度、解除程序和证据判断；若被认定违法解除，劳动合同法第八十七条规定按经济补偿标准的二倍支付赔偿金。\n\n建议把“单位说了什么、何时说、你是否继续提供劳动”写成时间线。`,
      sources: [OFFICIAL_SOURCES.contractLaw, OFFICIAL_SOURCES.arbitrationLaw],
    };
  }

  if (/工资|欠薪|提成|奖金|工资条|薪资/.test(query)) {
    return {
      content: `${context}先固定三类材料：劳动关系材料、约定工资标准的材料、实际欠付金额的计算表。劳动合同法第三十条要求用人单位及时足额支付劳动报酬；劳动争议申请仲裁一般有一年时效，但劳动关系存续期间因拖欠劳动报酬发生争议，法律另有时效规定。请尽快记录最后一次付款、每月应发和实发金额，并向所在地仲裁机构确认起算点。`,
      sources: [OFFICIAL_SOURCES.contractLaw, OFFICIAL_SOURCES.arbitrationLaw],
    };
  }

  if (/合同|劳动关系|没签|未签/.test(query)) {
    return {
      content: `${context}没有书面劳动合同不等于无法主张权利。可以从工资流水、工牌或工作证、考勤、排班、工作群与邮件、招聘录用记录、同事证言等方向形成相互印证的证据链。请保留原文件和完整上下文，不要只截取单张图片。\n\n下一步可把任职起止时间、岗位、工资约定和管理关系补充到案件说明中。`,
      sources: [OFFICIAL_SOURCES.contractLaw, OFFICIAL_SOURCES.arbitrationLaw],
    };
  }

  return {
    content: `${context}为了给出更可执行的路径，请补充：所在城市、入职与离职时间、争议金额、单位已作出的书面或口头决定，以及你手上已有的合同、工资流水、考勤和聊天记录。\n\n我会按“事实时间线—缺口证据—可选路径—需要核实的期限”继续帮你整理。涉及具体时效或重大金额时，请向所在地人社部门、劳动仲裁机构或专业律师核实。`,
    sources: [OFFICIAL_SOURCES.arbitrationLaw, OFFICIAL_SOURCES.service12333],
  };
}
