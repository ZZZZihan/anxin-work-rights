#!/usr/bin/env python3
"""Rebuild the technically curated 14-case sample from captured source paragraphs.

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
(HERE / 'cases.json').write_text(json.dumps(cases, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('cases=', len(cases), 'wage=', sum((WAGE in c['topics'] for c in cases)), 'relationship=', sum((REL in c['topics'] for c in cases)))
