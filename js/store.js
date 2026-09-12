/**
 * 数据层 — 所有 mock 数据集中管理
 * 后续替换为 API 调用即可
 */

export const user = {
  name: '王海涛',
  statsActive: 2,
  statsWinRate: '87%',
  statsEvidence: 12,
};

export const cases = [
  {
    id: 1,
    icon: '💰',
    type: '欠薪追讨',
    company: '天津辰光互联科技有限公司',
    amount: 25500,
    status: 'active',
    statusLabel: '进行中',
    currentStep: 3,
    nextAction: '尽快提交仲裁申请书',
    deadline: '6月11日',
  },
  {
    id: 2,
    icon: '❌',
    type: '违法辞退赔偿',
    company: '天津津达商贸有限公司',
    amount: 42000,
    status: 'pending',
    statusLabel: '待完善',
    currentStep: 1,
    nextAction: '待上传劳动合同',
    deadline: '已发起 6月1日',
  },
  {
    id: 3,
    icon: '⏰',
    type: '加班费争议',
    company: '廊坊嘉乐餐饮服务有限公司',
    amount: 12400,
    status: 'done',
    statusLabel: '已结案',
    currentStep: 5,
    nextAction: '案件已结案',
    deadline: '结案 2024-03-22',
  },
];

export const caseSteps = ['证据整理', '文书准备', '提交仲裁', '开庭审理', '裁决执行'];

export const evidence = {
  uploaded: [
    { icon: '💰', name: '银行工资流水（近12个月）',  meta: '3份 · 2024-01-15 上传 · AI识别：月均¥8,500', status: 'ok' },
    { icon: '💬', name: '微信聊天记录截图',        meta: '4份 · 包含欠薪承诺对话',                      status: 'ok' },
    { icon: '📋', name: '考勤记录打印件',          meta: '2份 · 2023-06至2023-12',                    status: 'warn' },
  ],
  missing: [
    { icon: '📝', name: '劳动合同原件',      meta: '重要程度：★★★★★',               status: 'miss', tip: '请上传劳动合同原件扫描件' },
    { icon: '📨', name: '离职/解除合同通知',  meta: '重要程度：★★★★☆',               status: 'miss', tip: '请上传离职证明或被辞退通知' },
    { icon: '🪪', name: '劳动关系辅助证明',   meta: '工牌/工作邮件/工作群截图',        status: 'warn', tip: '可补充：工牌、工作邮件、工作群截图等' },
  ],
  completeness: 75,
};

export const docTypes = [
  { icon: '⚖️', name: '仲裁申请书',    desc: '最常用' },
  { icon: '📋', name: '民事起诉状',    desc: '仲裁后上诉' },
  { icon: '📁', name: '证据目录',      desc: '附件清单' },
  { icon: '🏥', name: '工伤认定申请',  desc: '工伤专用' },
];

export const docForm = {
  applicant: { name: '王海涛', idCard: '120101197***0026', phone: '138****8888' },
  respondent: { company: '天津辰光互联科技有限公司', legalRep: '刘建国' },
  claim: { text: '裁决被申请人支付拖欠工资 ¥25,500', date: '2024年6月8日' },
  lawRefs: [
    '《劳动合同法》第三十条：用人单位应当按时足额支付劳动报酬，不得克扣或无故拖欠。',
    '《劳动争议调解仲裁法》第二条：用人单位与劳动者因劳动报酬发生的争议，适用本法。',
  ],
};

export const aiReplies = {
  '欠薪': `根据《劳动合同法》第30条，用人单位必须按时足额支付工资。你的情况建议：\n\n<strong>第一步：固定证据</strong>\n• 银行流水（证明工资水平）\n• 聊天记录（老板承认欠薪的截图）\n• 考勤记录\n\n<strong>第二步：申请劳动仲裁</strong>\n• 仲裁时效：1年内\n• 费用：免费\n• 胜诉率：此类案件约89%\n\n你被拖欠了多少个月、金额大概是多少？`,
  '辞退': `违法辞退属于《劳动合同法》第87条规定的情形，公司须支付<strong>2倍经济补偿金（赔偿金）</strong>。\n\n计算方式：\n月工资 × 工作年限 × 2\n\n<strong>关键证据清单：</strong>\n• 劳动合同\n• 被辞退通知（书面或截图）\n• 工资流水\n\n你在该公司工作了多久？这影响赔偿金额。`,
  '加班费': `根据《劳动法》第44条：\n• 工作日加班：1.5倍工资\n• 周末加班：2倍工资\n• 法定节假日：3倍工资\n\n<strong>证据重点：</strong>\n• 考勤记录/打卡记录\n• 钉钉/企微加班审批截图\n• 工资条（无加班费体现）\n\n仲裁时效1年，建议尽快行动。你每月大概加班多少小时？`,
  '工伤': `工伤认定按《工伤保险条例》第14条执行。<strong>48小时内</strong>是关键窗口。\n\n认定条件（符合其一）：\n• 工作时间和场所发生事故\n• 上下班途中交通事故（非本人主责）\n• 职业病\n\n<strong>即刻要做的：</strong>\n1. 保存事故现场照片\n2. 索要医院诊断证明\n3. 向用人单位申请工伤申报\n4. 1年内向社保部门申请认定\n\n请描述一下事故发生的经过。`,
};

export const defaultReply = '我理解你的问题。请提供更多详情，例如：公司名称所在地、工作年限、涉及金额等，我来帮你制定具体的维权方案。\n\n或者你可以直接点击下方快捷按钮，告诉我具体遇到了什么问题。';
