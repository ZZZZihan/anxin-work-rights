#!/usr/bin/env python3
"""Rebuild the technically curated public cases from captured source paragraphs.

Every extract is an exact substring of a referenced paragraph. Selection and
field classification are agent annotations, not legal-professional review.
"""
import json
from pathlib import Path

def require(condition, message='validation failed'):
    if not condition:
        raise ValueError(message)
HERE = Path(__file__).resolve().parent
SOURCES = {s['id']: s for s in json.loads((HERE / 'sources.json').read_text(encoding='utf-8'))}
LAW_RECORDS = json.loads((HERE.parent / 'laws' / 'laws.json').read_text(encoding='utf-8'))
LAW_TITLES = {}
for law_record in LAW_RECORDS:
    LAW_TITLES.setdefault(law_record['title'], []).append(law_record['id'])
A = 'case-src-nanyang-20230609-third'
B = 'case-src-spc-20250801-labor'
C = 'case-src-spc-20241223-wage'
D = 'case-src-spc-20240125-wage'
E = 'case-src-spc-20241223-guidance'
F = 'case-src-spc-20250416-fourth'
REL = 'employment_relationship'
WAGE = 'wage_arrears'

class Case:

    def __init__(self, sid, cid, title_ns, bounds, topics, tags):
        self.sid = sid
        self.value = dict(id=cid, source_id=sid, title=''.join((self.text(n) for n in title_ns)), topics=topics, case_group_id=cid, region=None, decision_date=None, source_refs=[self.ref(n) for n in range(bounds[0], bounds[1] + 1)], facts=[], claims=[], issues=[], issue_disclosure='not_explicit_in_source', evidence=[], outcome=None, reasoning=[], cited_rules=[], tags=tags, annotation_status='agent_curated_not_legal_expert_reviewed')

    def ref(self, n):
        return f'{self.sid}:p{n:04d}'

    def text(self, n):
        return SOURCES[self.sid]['paragraphs'][n - 1]['text']

    def span(self, n, start=None, end=None):
        text = self.text(n)
        i = text.index(start) if start else 0
        j = text.index(end, i + (len(start) if start else 0)) if end else len(text)
        return text[i:j].rstrip('，；')

    def item(self, field, n, kind, start=None, end=None):
        self.value[field].append(dict(text=self.span(n, start, end), kind=kind, refs=[self.ref(n)]))
        return self

    def fact(self, n, start=None, end=None):
        return self.item('facts', n, 'reported_fact', start, end)

    def claim(self, n, start=None, end=None):
        return self.item('claims', n, 'party_assertion', start, end)

    def issue(self, n, start=None, end=None):
        require('争议焦点' in self.span(n, start, end), 'source does not explicitly disclose the issue')
        self.value['issue_disclosure'] = 'reported_in_source'
        return self.item('issues', n, 'issue', start, end)

    def reason(self, n, start=None, end=None):
        return self.item('reasoning', n, 'reasoning', start, end)

    def found(self, n, start=None, end=None):
        return self.item('facts', n, 'adjudicated_fact', start, end)

    def outcome(self, n, start=None, end=None):
        self.value['outcome'] = dict(text=self.span(n, start, end), refs=[self.ref(n)])
        return self

    def decision(self, value, n):
        """Use only an expressly dated disposition in the selected case body."""
        from datetime import date
        parsed = date.fromisoformat(value)
        original = f'{parsed.year}年{parsed.month}月{parsed.day}日'
        require(original in self.text(n) and self.ref(n) in self.value['source_refs'], value)
        self.value['decision_date'] = value
        return self

    def evidence(self, material_type, n, start=None, end=None, treatment='mentioned'):
        self.value['evidence'].append(dict(material_type=material_type, description=self.span(n, start, end), treatment=treatment, has_original=False, refs=[self.ref(n)]))
        return self

    def rule(self, name, article, *ns):
        require(any((name in self.text(n) for n in ns)), name)
        if article:
            require(any((article in self.text(n) for n in ns)), article)
        candidates = LAW_TITLES.get(name, [])
        if len(candidates) == 1:
            law_id = candidates[0]
            link_note = '仅按法规正式名称关联已收录版本；案例未明示该法规版本，不能据此认定个案适用版本。'
        elif not candidates:
            law_id = None
            link_note = '未在当前法规样例中收录该规则；保留原文明示名称及条款，未判断个案适用版本。'
        else:
            law_id = None
            link_note = '该正式名称对应多个已收录版本，未确定唯一名称关联；未判断个案适用版本。'
        self.value['cited_rules'].append(dict(name=name, article=article, refs=[self.ref(n) for n in ns], law_id=law_id, link_basis='source_explicit', version_match='not_determined', link_note=link_note))
        return self
cases = []

def save(case):
    require(case.value['outcome'], 'validation failed')
    cases.append(case.value)
c = Case(A, 'case-third-01-platform-truck', [15], (15, 27), [REL], ['网约货车司机', '合作协议', '劳动关系成立', '仲裁'])
c.fact(17, end='刘某认为').claim(19).claim(17, '某信息技术公司以双方书面约定', '刘某遂向')
c.issue(23).reason(24).reason(25).outcome(21)
c.evidence('合作协议', 17, end='刘某从事运输工作期间').evidence('终止协议', 17, '2021年3月2日，', '刘某认为')
c.rule('中华人民共和国劳动合同法', '第七条', 24).rule('关于维护新就业形态劳动者劳动保障权益的指导意见', '第十八条', 24).rule('关于确立劳动关系有关事项的通知', None, 24)
save(c)
c = Case(A, 'case-third-02-crowdsourced-courier', [28], (28, 40), [REL], ['众包骑手', '自主接单', '劳动关系不成立', '仲裁'])
c.fact(30).claim(32).issue(36).reason(37).reason(38).outcome(34)
c.evidence('网约配送协议', 30, end='从事餐饮外卖配送业务期间')
c.rule('关于发布智能制造工程技术人员等职业信息的通知', None, 37).rule('关于维护新就业形态劳动者劳动保障权益的指导意见', None, 37, 40)
save(c)
c = Case(A, 'case-third-03-station-outsourcing', [41], (41, 52), [REL], ['外卖配送', '外包', '实际劳动管理', '劳动关系成立', '仲裁'])
c.fact(43, end='2019年11月3日，').fact(43, '2019年11月3日，', '其要求').claim(45)
c.claim(43, '某货运代理公司以未与何某订立任何协议为由', '2019年12月19日，')
c.issue(49).reason(50).outcome(47)
c.evidence('配送业务承包协议', 43, '2019年5月27日，', '何某于2019年7月28日')
c.evidence('外卖配送服务协议', 43, '何某于2019年7月28日', '从事配送工作期间')
c.evidence('配送员管理规则', 43, '从事配送工作期间', '2019年11月3日，')
c.rule('关于维护新就业形态劳动者劳动保障权益的指导意见', None, 52)
save(c)
c = Case(A, 'case-third-04-registered-proprietor', [53], (53, 65), [REL], ['个体工商户', '项目承包协议', '劳动关系成立', '仲裁'])
c.fact(55, end='2020年12月10日，').fact(55, '2020年12月10日，', '孙某要求').claim(57)
c.claim(55, '某物流公司认为', '孙某遂向').issue(61).reason(62).reason(63).outcome(59)
c.evidence('劳动合同', 55, '某物流公司与孙某订立了', '从事配送工作期间')
c.evidence('服务协议和项目承包协议', 55, '某物流公司于2020年8月21日', '此后，孙某仍然')
c.rule('促进个体工商户发展条例', '第三十条第二款', 65)
save(c)
c = Case(A, 'case-third-05-streamer-agency', [66], (66, 78), [REL], ['网络主播', '经纪关系', '收益分成', '劳动关系不成立', '二审'])
c.fact(68, end='2019年3月31日，').claim(70).claim(68, '某文化传播公司以双方之间不存在劳动关系为由', '李某向仲裁委员会')
c.issue(74).reason(75).reason(76).outcome(72)
c.evidence('艺人独家合作协议', 68, end='从事直播活动后')
c.rule('关于确立劳动关系有关事项的通知', None, 76)
save(c)
c = Case(A, 'case-third-06-housekeeping-employee', [79], (79, 91), [REL], ['家政服务', '员工制', '劳动关系成立', '二审'])
c.fact(81, end='2020年1月10日，').fact(81, '2020年1月10日，', '要求某家政公司').claim(83)
c.claim(81, '请求确认与某家政公司', '仲裁委员会裁决').issue(87).reason(88).reason(89).outcome(85)
c.evidence('家政服务协议', 81, end='2019年11月1日，')
c.rule('关于确立劳动关系有关事项的通知', '第一条', 88).rule('关于促进家政服务业提质扩容的意见', None, 91)
save(c)
c = Case(B, 'case-spc-2025-mixed-employers', [21], (20, 27), [REL, WAGE], ['关联企业', '混同用工', '劳动关系成立', '欠发工资', '法院判决'])
c.fact(23, end='王某认为').claim(23, '王某认为', '某劳动人事争议仲裁委员会不予支持')
c.reason(25, end='审理法院判决支持').reason(27)
c.found(25, '某数字公司、某科技公司属关联企业', '王某难以确定实际用人单位')
c.found(25, '王某虽通过某科技公司名义应聘入职', '其有理由相信')
c.outcome(25, '审理法院判决支持')
c.evidence('营业执照记载', 23, end='某科技公司发布招聘启事')
c.evidence('工作地点名牌与工作沟通软件', 23, '工作期间，', '两公司均未与王某')
c.evidence('工资付款账户', 23, '王某工资系', '王某认为')
save(c)
c = Case(C, 'case-spc-2024-overseas-arrears', [41, 42], (40, 48), [REL, WAGE], ['海外务工', '劳动关系成立', '工资拖欠', '法院判决'])
c.fact(44, end='后某金属公司不服').claim(44, '后某金属公司不服')
c.reason(46, end='审理法院判令').found(46, '鉴于某冶金公司', '故不予支持').reason(48).outcome(46, '审理法院判令')
c.evidence('承包合同', 44, '某冶金公司（发包方）', '某金属公司招录')
c.evidence('劳务合同', 44, '某冶金公司为协助', '宫某等11人提交了')
c.evidence('考勤记录和情况说明', 46, '且宫某等11人提供的', '故不予支持', treatment='accepted')
save(c)
c = Case(C, 'case-spc-2024-anticipatory-wage-breach', [50, 51, 52], (49, 58), [WAGE], ['欠款担保约定', '预期违约', '工资拖欠', '法院判决'])
c.fact(54, end='王某于2022年3月').claim(54, '王某于2022年3月', '某投资公司在审理中').claim(54, '某投资公司在审理中')
c.reason(56, end='审理法院判令').reason(58)
c.outcome(56, '审理法院判令').evidence('欠款担保约定', 54, '双方于2020年12月', '2020年12月，某投资公司与王某')
c.rule('中华人民共和国民法典', '第五百七十八条', 58)
save(c)
c = Case(D, 'case-spc-2024-joint-project-wage', [48, 49], (47, 55), [WAGE], ['农民工', '违法分包', '联合体', '共同清偿', '执行完毕'])
c.fact(51, end='王某等人因工资长期').claim(51, '王某等人因工资长期')
c.reason(53, end='114名农民工的工资').reason(55)
c.outcome(53, '某工程技术公司、某电器公司、某市公路总公司自愿组成联合体', '审理法院针对本案')
c.rule('保障农民工工资支付条例', '第三十二条第一款', 55)
save(c)
c = Case(D, 'case-spc-2024-borrowed-contractor-license', [66, 67, 68], (65, 74), [WAGE], ['农民工', '挂靠', '工资欠条', '共同清偿', '法院判决'])
c.fact(70, end='卢某提起诉讼').claim(70, '卢某提起诉讼')
c.reason(72, end='判令刘某').reason(74).outcome(72, '判令刘某')
c.evidence('工资欠条', 70, '刘某向卢某出具', '后刘某支付')
c.evidence('劳务施工协议', 70, '刘某以某劳务公司名义', '刘某雇佣农民工')
c.rule('保障农民工工资支付条例', '第三十六条第二款', 72, 74)
save(c)
c = Case(D, 'case-spc-2024-platform-wage-payment', [76, 77], (75, 83), [WAGE], ['工资支付方式', '购物平台', '未足额支付', '法院判决'])
c.fact(79, end='杨某认为').claim(79, '杨某认为').reason(81, end='判令某培训中心').reason(83)
c.found(81, '杨某无法通过某购物平台足额领取工资', '某培训中心作为用人单位').outcome(81, '判令某培训中心')
save(c)
c = Case(D, 'case-spc-2024-wage-employer-burden', [95, 96, 97], (94, 103), [WAGE], ['农民工', '举证责任', '工资台账未提供', '仲裁'])
c.fact(99, end='因双方对唐某受伤当月').claim(99, '因双方对唐某受伤当月')
c.claim(101, '某建筑劳务公司虽然主张', '但未提供')
c.reason(101, end='遂认定唐某').reason(103).found(101, '遂认定唐某', '并根据双方均认可')
c.outcome(101, '裁决某建筑劳务公司支付')
c.evidence('劳动合同', 99, end='后唐某在工作中')
c.evidence('工资支付台账和清单', 101, '但未提供', '遂认定唐某', treatment='not_disclosed')
c.rule('中华人民共和国劳动争议调解仲裁法', '第六条', 101).rule('保障农民工工资支付条例', '第五十条', 101).rule('保障农民工工资支付条例', '第十五条', 103)
save(c)
c = Case(D, 'case-spc-2024-inspection-arbitration-evidence', [105, 106, 107], (104, 113), [WAGE], ['工资拖欠', '劳动监察', '调查笔录', '仲裁证据'])
c.fact(109, end='赖某对工资支付数额').claim(109, '赖某对工资支付数额')
c.reason(111, end='裁决某房地产公司').reason(113).outcome(111, '裁决某房地产公司')
c.evidence('劳动保障监察调查笔录', 111, '劳动人事争议仲裁委员会经开庭审理', '裁决某房地产公司', treatment='accepted')
c.rule('保障农民工工资支付条例', '第三条', 111)
c.rule('关于实施“护薪”行动全力做好拖欠农民工工资争议处理工作的通知', None, 113)
c.rule('人力资源社会保障部办公厅关于开展农民工工资争议速裁庭建设专项行动的通知', None, 113)
save(c)
# The original fourteen records above and all original paragraph IDs are kept.
# Additional cases from the same frozen articles follow; one original case is
# always one case_group_id, even when it includes arbitration and two judgments.
c = Case(C, 'case-spc-2024-platform-taxi-mediation', [32, 33], (31, 39), [WAGE, REL], ['网约车司机', '平台派单', '群体欠薪', '法院调解', '调解未作关系认定'])
c.fact(35, end='2024年，').claim(35, '2024年，', '案件审理过程中').outcome(37, end='为推动平台企业').reason(39)
save(c)
c = Case(C, 'case-spc-2024-unpaid-shareholder-capital', [69, 70], (68, 77), [WAGE], ['公司无财产', '股东未实缴', '追加申请', '工资清偿', '执行终结'])
c.fact(72).fact(73, end='执行法院及时约谈').outcome(75).reason(77)
c.evidence('工商档案', 73, end='执行法院及时约谈')
c.rule('最高人民法院关于民事执行中变更、追加当事人若干问题的规定', '第十七条', 77)
save(c)
c = Case(C, 'case-spc-2024-actual-controller-execution', [79, 80], (78, 86), [WAGE], ['实际控制人', '限制消费', '仲裁调解书', '工资清偿', '执行'])
c.fact(82).outcome(84, '在执行法院将文书送达').reason(86)
save(c)
c = Case(C, 'case-spc-2024-flexible-seizure-wages', [88, 89, 90], (87, 97), [WAGE], ['劳务报酬', '小微企业', '灵活查封', '分期和解', '执行完毕'])
c.fact(92).found(94, end='执行法官通过实地调查走访').reason(95, end='执行法官邀请').reason(97)
c.outcome(95, '陈某开办的某服饰公司正常经营')
save(c)
c = Case(C, 'case-spc-2024-shipyard-property-wages', [99, 100], (98, 106), [WAGE], ['群体欠薪', '仲裁保全', '财产处置', '工资清偿', '再就业'])
c.fact(102).outcome(104).reason(106)
save(c)
c = Case(C, 'case-spc-2024-execution-bankruptcy-wages', [108, 109], (107, 115), [WAGE], ['小微企业', '资不抵债', '执行转破产', '工资债权', '执行'])
c.fact(111, end='执行法院经调查走访').outcome(113, '最终，').reason(115)
save(c)
c = Case(D, 'case-spc-2024-bankruptcy-wage-guarantee', [39, 40], (38, 46), [WAGE], ['破产', '工资拖欠', '欠薪应急保障金', '再就业', '清偿'])
c.fact(42).outcome(44).reason(46)
c.rule('全国法院破产审判工作会议纪要', '第27条', 46)
save(c)
c = Case(D, 'case-spc-2024-retired-worker-payment-order', [57, 58], (56, 64), [WAGE], ['退休返聘', '劳务报酬', '支付令', '司法确认', '调解'])
c.fact(60, end='尹某等10人起诉').claim(60, '尹某等10人起诉').reason(62, end='为促进矛盾纠纷').reason(64)
c.outcome(62, '为促进矛盾纠纷')
save(c)
c = Case(D, 'case-spc-2024-online-overtime-pay', [85, 86, 87], (84, 93), [WAGE], ['线上加班', '微信内容', '延时加班费', '休息日加班', '法院判决'])
c.fact(89, end='李某认为').claim(89, '李某认为').reason(91, end='因李某的工作').reason(93)
c.found(91, '根据微信内容等确定李某存在三天休息日到岗事实', '判令某文化传媒公司')
c.outcome(91, '酌情确定某文化传媒公司')
c.evidence('劳动合同', 89, end='李某在2020年4月8日')
c.evidence('微信内容、考勤自述及工资标准', 91, '审理法院根据李某提交的', '酌情确定', treatment='accepted')
save(c)
c = Case(D, 'case-spc-2024-collective-wage-mediation', [115, 116], (114, 122), [WAGE], ['集体劳动争议', '协商解除', '工资拖欠', '部分调解', '速裁绿色通道'])
c.fact(118, end='李某等人向').claim(118, '李某等人向').outcome(120).reason(122)
save(c)
c = Case(D, 'case-spc-2024-electronic-evidence-support', [124, 125], (123, 131), [WAGE], ['餐饮欠薪', '电子证据', '证据固定', '检察支持起诉', '法院支持'])
c.fact(127, end='同年9月，').reason(131).outcome(129, '因关键证据得到查证及固定')
c.evidence('电子证据', 127, '因主要证据为电子证据', '区总工会评估案情后')
c.evidence('电子证据调查取证', 129, end='在取得关键证明并固定证据后')
save(c)
c = Case(D, 'case-spc-2024-construction-union-settlement', [133, 134], (132, 140), [WAGE], ['农民工', '装修工程', '多部门协商', '和解', '工资清偿'])
c.fact(136).outcome(138, '镇总工会联合镇司法所').reason(140)
c.evidence('工程施工装修项目合同', 136, end='某装修公司招用了')
save(c)
c = Case(D, 'case-spc-2024-online-mediation-confirmation', [142, 143], (141, 149), [WAGE], ['农民工', '工程完工欠薪', '网上调解', '司法确认', '履行完毕'])
c.fact(145).outcome(147).reason(149)
c.evidence('还款计划', 147, end='后经工会调解员调解')
save(c)
c = Case(D, 'case-spc-2024-union-hotline-wage-recovery', [151, 152], (150, 158), [WAGE], ['工会热线', '农民工', '调查核实', '部门协商', '工资清偿'])
c.claim(154, end='12351职工热线平台').fact(154, '12351职工热线平台').outcome(156).reason(158)
save(c)

c = Case(E, 'case-guidance-237-outsourced-courier', [25, 26], (24, 43), [REL], ['指导性案例237号', '外卖配送', '承揽合作协议', '劳动关系成立', '二审'])
c.fact(32).fact(33).issue(38).reason(39).reason(40).outcome(36).decision('2022-03-07', 36)
c.evidence('服务承揽合同', 32, end='该合同约定')
c.evidence('自由职业者合作协议和任务承揽协议', 33, '郎溪某服务公司与徐某申订立', '两份协议均约定')
c.evidence('排班表', 33, '徐某申在站点工作期间')
c.rule('中华人民共和国劳动法', '第16条', 42).rule('中华人民共和国劳动合同法', '第7条、第10条', 43)
c.rule('劳动和社会保障部关于确立劳动关系有关事项的通知', '第一条', 39)
save(c)
c = Case(E, 'case-guidance-238-registered-courier', [45, 46], (44, 65), [REL], ['指导性案例238号', '专送骑手', '个体工商户', '转包', '劳动关系成立', '一审生效'])
c.fact(53).fact(54).fact(55, end='因工伤认定问题').claim(55, '因工伤认定问题', '江苏省苏州市虎丘区劳动争议仲裁委员会裁决')
c.issue(59).reason(60).reason(61).reason(62).outcome(57).decision('2021-08-02', 57)
c.evidence('服务协议', 54, end='同年6月10日，')
c.evidence('项目转包协议', 54, '同年6月10日，', '同年6月13日，')
c.evidence('APP薪资账单和平台服务协议', 61, '其二，', '其三，', treatment='accepted')
c.rule('中华人民共和国劳动法', '第16条', 64).rule('中华人民共和国劳动合同法', '第7条、第10条', 65)
save(c)
c = Case(E, 'case-guidance-239-streamer-no-employment', [67], (66, 85), [REL], ['指导性案例239号', '网络主播', '经纪合同', '议价权', '劳动关系不成立', '二审'])
c.fact(73).fact(74).claim(75, end='北京市朝阳区劳动人事争议仲裁委员会裁决')
c.issue(79).reason(80).reason(81).reason(82).outcome(77).decision('2023-09-05', 77)
c.evidence('独家经纪合同', 73)
c.rule('中华人民共和国劳动合同法', '第7条', 84)
c.rule('最高人民法院关于适用〈中华人民共和国民事诉讼法〉的解释', '第90条', 85)
save(c)
c = Case(E, 'case-guidance-240-designated-driver-no-employment', [87, 88], (86, 107), [REL], ['指导性案例240号', '代驾司机', '自主接单', '必要运营管理', '劳动关系不成立', '二审'])
c.fact(94).fact(95).fact(96).claim(97, end='北京市石景山区劳动人事争议仲裁委员会裁决')
c.issue(101).reason(102).reason(103).reason(104).outcome(99).decision('2023-09-15', 99)
c.evidence('信息服务协议', 94, '平台中的')
c.rule('中华人民共和国劳动合同法', '第7条', 106)
c.rule('最高人民法院关于适用〈中华人民共和国民事诉讼法〉的解释', '第90条', 107)
save(c)
c = Case(F, 'case-fourth-02-pregnancy-wage-difference', [34], (34, 46), [WAGE], ['孕期', '调岗降薪', '项目津贴', '工资差额', '仲裁支持'])
c.fact(36, end='此后，某科技公司主张').claim(36, '此后，某科技公司主张', '赵某向仲裁委员会申请仲裁').claim(38)
c.issue(42).outcome(40).reason(43).reason(44).reason(46)
c.evidence('劳动合同', 36, end='2023年2月，')
c.rule('中华人民共和国妇女权益保障法', '第四十八条第一款', 43)
c.rule('女职工劳动保护特别规定', '第五条', 43).rule('女职工劳动保护特别规定', '第六条', 43)
save(c)
(HERE / 'cases.json').write_text(json.dumps(cases, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

# These labels describe the reported procedure, not an inferred legal outcome.
# Keep enforcement and dispute-resolution examples distinct from merits cases.
STAGES = {
    'case-third-01-platform-truck': 'arbitration',
    'case-third-02-crowdsourced-courier': 'arbitration',
    'case-third-03-station-outsourcing': 'arbitration',
    'case-third-04-registered-proprietor': 'arbitration',
    'case-third-05-streamer-agency': 'merits_judgment',
    'case-third-06-housekeeping-employee': 'merits_judgment',
    'case-spc-2025-mixed-employers': 'merits_judgment',
    'case-spc-2024-overseas-arrears': 'merits_judgment',
    'case-spc-2024-anticipatory-wage-breach': 'merits_judgment',
    'case-spc-2024-joint-project-wage': 'merits_and_execution',
    'case-spc-2024-borrowed-contractor-license': 'merits_judgment',
    'case-spc-2024-platform-wage-payment': 'merits_judgment',
    'case-spc-2024-wage-employer-burden': 'arbitration',
    'case-spc-2024-inspection-arbitration-evidence': 'arbitration',
    'case-spc-2024-platform-taxi-mediation': 'mediation',
    'case-spc-2024-unpaid-shareholder-capital': 'execution',
    'case-spc-2024-actual-controller-execution': 'execution',
    'case-spc-2024-flexible-seizure-wages': 'execution',
    'case-spc-2024-shipyard-property-wages': 'execution',
    'case-spc-2024-execution-bankruptcy-wages': 'execution_and_bankruptcy',
    'case-spc-2024-bankruptcy-wage-guarantee': 'bankruptcy',
    'case-spc-2024-retired-worker-payment-order': 'payment_order_and_mediation',
    'case-spc-2024-online-overtime-pay': 'merits_judgment',
    'case-spc-2024-collective-wage-mediation': 'mediation_and_arbitration_referral',
    'case-spc-2024-electronic-evidence-support': 'merits_judgment',
    'case-spc-2024-construction-union-settlement': 'coordinated_settlement',
    'case-spc-2024-online-mediation-confirmation': 'mediation_and_judicial_confirmation',
    'case-spc-2024-union-hotline-wage-recovery': 'administrative_coordination',
    'case-guidance-237-outsourced-courier': 'merits_judgment',
    'case-guidance-238-registered-courier': 'merits_judgment',
    'case-guidance-239-streamer-no-employment': 'merits_judgment',
    'case-guidance-240-designated-driver-no-employment': 'merits_judgment',
    'case-fourth-02-pregnancy-wage-difference': 'arbitration',
}
MERITS_STAGES = {'arbitration', 'merits_judgment', 'merits_and_execution'}
EXECUTION_STAGES = {'execution', 'execution_and_bankruptcy', 'bankruptcy'}
LIMITATIONS = {
    'case-spc-2024-platform-taxi-mediation': '原文仅披露调解和履行结果，未作劳动关系实体认定；劳动关系主题仅表示当事人曾提出该请求，不能标注成立或不成立。',
    'case-spc-2024-unpaid-shareholder-capital': '追加被执行人申请后股东付款，劳动者撤回追加申请；不能标注法院已经作出追加股东裁定或实体连带责任判决。',
    'case-spc-2024-actual-controller-execution': '对实际控制人与主要负责人采取限制消费措施；不能据此标注其承担工资债务的实体责任。',
    'case-spc-2024-flexible-seizure-wages': '执行依据为经司法确认的调解协议，原文称劳动报酬；不据此确认劳动关系成立。',
    'case-spc-2024-shipyard-property-wages': '记录仲裁保全、仲裁调解书后的财产处置与工资兑现；不补写劳动关系或责任主体实体认定。',
    'case-spc-2024-retired-worker-payment-order': '退休返聘劳务报酬案例，程序包含支付令、诉前调解及诉讼调解；不得据此确认劳动关系或假定已全部履行。',
    'case-spc-2024-collective-wage-mediation': '32人调解付款、12人撤诉、4人进入速裁通道；原文没有披露4人的最终裁决，不补写其结果。',
    'case-spc-2024-electronic-evidence-support': '仅公开电子证据固定过程，未公开电子材料原件；首次仲裁请求未获支持不等于原文明示某项证据被排除。',
    'case-spc-2024-construction-union-settlement': '以工会和多部门协调达成和解，未披露仲裁裁决或法院实体判决。',
    'case-spc-2024-online-mediation-confirmation': '司法确认与协议履行结果不等于法院就劳动关系或清偿责任作实体判决。',
    'case-spc-2024-union-hotline-wage-recovery': '工会核查与多部门协商后清偿工资，未披露仲裁裁决或法院实体判决。',
}
require(set(STAGES) == {case['case_group_id'] for case in cases}, 'coverage stage mapping is incomplete')
coverage_entries = []
for case in cases:
    stage = STAGES[case['case_group_id']]
    limitations = ['官方典型案例公开叙述，非完整卷宗；材料描述不等于取得原始证据；Agent 核读未经过法律专业人员审核。']
    if stage in EXECUTION_STAGES:
        limitations.append('仅用于执行、破产程序事实和清偿结果阅读，不用于劳动关系或工资责任的实体认定监督。')
    if case['case_group_id'] in LIMITATIONS:
        limitations.append(LIMITATIONS[case['case_group_id']])
    if stage not in MERITS_STAGES and stage not in EXECUTION_STAGES:
        limitations.append('仅用于对应调解、协商或督促程序阅读，不作为劳动关系或清偿责任的实体裁判结论。')
    coverage_entries.append(dict(
        case_group_id=case['case_group_id'], topics=case['topics'],
        scenario='、'.join(case['tags']),
        source_id=case['source_id'], source_url=SOURCES[case['source_id']]['url'],
        stage=stage, merits_supervision_eligible=stage in MERITS_STAGES,
        limitations=limitations,
    ))
coverage = dict(
    schema_version=1,
    scope='欠薪（含加班工资、劳务报酬清偿）及劳动关系确认的官方公开案例阅读样例；非训练或评测效果证明。',
    annotation_status='agent_curated_not_legal_expert_reviewed',
    selection_policy='保留原14例；补充既有冻结汇编中的相关非刑事案例及两项最高人民法院官网来源；不按主题或程序拆分同一原始案例。',
    exclusions=['纯刑事拒不支付劳动报酬定罪案例', '与欠薪或劳动关系确认无关的工伤、竞业限制等案例'],
    cases=coverage_entries,
    uncovered=[
        '没有当事人授权的真实私有案卷、原始劳动合同、银行流水、聊天截图或考勤附件，不能验证私有材料抽取能力。',
        '没有扫描件或图片证据，不能验证 OCR、版式恢复或跨材料对应关系。',
        '官方典型案例为目的性选择，不能代表劳动争议发生率、地区分布、裁判胜率或线上用户分布。',
        '未披露案件裁判地区时保持 null；除4例明示裁判日期外其余日期为 null，不能完成全国地域与历史适用版本覆盖。',
        '没有逐项工资计算底稿和完整庭审质证过程，不能作为金额计算、证据真实性或证据充分性的标准答案。',
        '未取得通用开放许可；公开访问与当前项目授权不等于可对外再分发或商业训练。',
    ],
)
(HERE / 'coverage.json').write_text(json.dumps(coverage, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('cases=', len(cases), 'wage=', sum((WAGE in c['topics'] for c in cases)), 'relationship=', sum((REL in c['topics'] for c in cases)))
