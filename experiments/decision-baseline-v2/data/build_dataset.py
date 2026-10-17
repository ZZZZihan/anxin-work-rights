#!/usr/bin/env python3
"""Independent Agent-authored synthetic holdout source. No model/API calls.

This file is sealed authoring material and must not be inspected by the rule or
prompt implementer before implementation freeze. Every fact and label below was
authored for this exercise; none is a real case or an expert adjudication.
"""
from __future__ import annotations

import json
import random
import uuid
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent
NAMESPACE = uuid.UUID('7b93f138-3eb2-4d79-95cd-05f165503771')
FIELDS = ('period', 'agreed_due_total', 'wage_paid_total')
CASES: list[dict] = []


def U(text: str) -> dict:
    return {'role': 'user', 'content': text}


def A(text: str) -> dict:
    return {'role': 'assistant', 'content': text}


def ask(*, missing=(), conflicts=(), q) -> dict:
    missing = list(missing)
    conflicts = list(conflicts)
    needed = set(missing) | set(conflicts)
    assert set(q) == needed, 'Each case must ask only about its unresolved fields.'
    return {
        'missing': missing,
        'conflicts': conflicts,
        'next_action': {
            'type': 'ask_user',
            'questions': [{'field': f, 'text': q[f]} for f in FIELDS if f in needed],
            'tool': None,
            'arguments': None,
        },
    }


def call(start: str, end: str, due: str, paid: str) -> dict:
    return {
        'missing': [],
        'conflicts': [],
        'next_action': {
            'type': 'call_tool',
            'questions': [],
            'tool': 'calculate_wage_gap',
            'arguments': {
                'period_start': start,
                'period_end': end,
                'due': float(Decimal(due)),
                'paid': float(Decimal(paid)),
            },
        },
    }


def failure() -> dict:
    return {
        'missing': [], 'conflicts': [],
        'next_action': {
            'type': 'report_tool_failure', 'questions': [], 'tool': None, 'arguments': None,
        },
    }


def item(messages, category, expected, rationale, *, audit=None, state=None):
    return {
        'messages': messages, 'category': category, 'expected': expected,
        'rationale': rationale, 'audit': audit, 'tool_state': state,
    }


def audit(due: str, wage_parts, gap: str, *, excluded=()):
    # Independent decimal ledger for checking each complete arithmetic snapshot.
    return {
        'confirmed_due': due,
        'wage_parts': list(wage_parts),
        'excluded_from_period_wages': list(excluded),
        'expected_gap': gap,
    }


def pair(left, right):
    number = len(CASES) // 2 + 1
    group_id = str(uuid.uuid5(NAMESPACE, f'group-{number:02d}'))
    for side, record in enumerate((left, right)):
        record['group_id'] = group_id
        record['id'] = str(uuid.uuid5(NAMESPACE, f'record-{number:02d}-{side}'))
        CASES.append(record)


# 01: the year itself must be known, even when both month/day values are present.
pair(
    item([U('我替自己整理一张手写结算条。上面记的是2月4日到2月22日，年份那一栏是空的，原件也暂时找不到。这一段应付合计5864.30元、已付工资共3200.10元，两笔总额我已经核过，付款也都属于这段。先看看还缺什么。')],
         'missing_period', ask(missing=['period'], q={"period": "请核实结算条上2月4日和2月22日这两个起止日期各自所属的年份。"}),
         '起止月日已有但年份未确认；期间总额和归属明确的全部工资付款均已确认。'),
    item([U('手写结算条的年份现在查到了：从2026-02-04到2026-02-22。这一段应付合计5864.30元，已付工资一共3200.10元，付款清单核全了，全部属于这段。麻烦算一下相差多少。')],
         'complete', call('2026-02-04', '2026-02-22', '5864.30', '3200.10'),
         '完整日期、明确期间应付总额和完整归属付款足以调用算术工具。',
         audit=audit('5864.30', ['3200.10'], '2664.20')),
)

# 02: the closing date cannot be replaced by the date a message was sent.
pair(
    item([U('我从2026-03-11进场，后来中途离开，离开的具体日子还没向班长核实。结算单确认这次应付4128.75元，本次全部已付工资1800.50元，现金银行均已核全且归属明确。手机里最后一条工作消息是3月27日，但不能确定那就是结束日。')],
         'missing_period', ask(missing=['period'], q={"period": "请查证这次结算实际到哪一天结束，并确认结束日期的年份。"}),
         '开始日期确定，结束日期未知；最后工作消息日期不是已确认的期间终点。'),
    item([U('这次进场是2026-03-11，班长与我核对后确认结算到2026-03-27。应付总额4128.75元已经定下；全部工资付款是1800.50元，归属这次且没有漏记现金。请按这段核算。')],
         'complete', call('2026-03-11', '2026-03-27', '4128.75', '1800.50'),
         '结束日期由当事人明确核实，其他两个期间总额完整。',
         audit=audit('4128.75', ['1800.50'], '2328.25')),
)

# 03: a known leaving date does not establish when this settlement began.
pair(
    item([U('我手上的离场签字是2026-08-24，前面究竟从哪天开始算这笔工资，还得翻入场登记。会计已确认本笔应付2790元，银行和现金全部查完，已付工资总共2300元，都对应这笔。开始那天我现在不能确定。')],
         'missing_period', ask(missing=['period'], q={"period": "请根据入场登记核实这笔结算从哪一天开始，并确认开始日期的年份。"}),
         '结束日期和两项总额明确，开始日期仍缺失。'),
    item([U('入场登记与离场签字已经对上，本笔工资的期间是2026-08-09至2026-08-24。会计确认应付总共2790元；查过银行和现金，属于本笔的已付工资一共2300元。帮我做差额。')],
         'complete', call('2026-08-09', '2026-08-24', '2790', '2300'),
         '起点由登记补齐，可以使用确认的期间总额。',
         audit=audit('2790', ['2300'], '490')),
)

# 04: an explicitly unverified end-year must not be inferred across New Year.
pair(
    item([U('档案开头写2025-12-18，末尾只看清“1月12日”。这份档案后补过页，末尾是哪一年的1月12日还没核实，不能靠顺序猜。对应这份结算的应付总额9300元、全部已付工资9000元都已核实，均归属这笔。')],
         'missing_period', ask(missing=['period'], q={"period": "请核实档案末尾1月12日所对应的年份。"}),
         '用户明确指出终点年份未经核实，不能自行推定跨年年份。'),
    item([U('后补页已经查实，这份结算从2025-12-18开始，到2026-01-12结束。对应整段的应付总额9300元，所有已付工资合计9000元，款项归属也对过了。请计算差额。')],
         'complete', call('2025-12-18', '2026-01-12', '9300', '9000'),
         '跨年期间的两个完整日期已明确，金额均为该整段的总额。',
         audit=audit('9300', ['9000'], '300')),
)

# 05: a named calendar month does not fill in actual settlement boundaries.
pair(
    item([U('这是2026年5月零工那次的账，实际只做了半个月左右，不能按整月算。我尚未查出那次准确的起止日。不过双方核定那次应付3185.40元，所有渠道已付的工资是1000元，只有这一笔工资付款。')],
         'missing_period', ask(missing=['period'], q={"period": "请核实2026年5月这次零工准确从哪一天开始、到哪一天结束。"}),
         '只知道月份与约略时长，实际结算起止日期未确认。'),
    item([U('零工签到页找到了，2026年5月这次结算准确从2026-05-06到2026-05-19。双方已核定这段应付3185.40元；银行现金全查过，已付工资只有1000元，全部属于这一段。')],
         'complete', call('2026-05-06', '2026-05-19', '3185.40', '1000'),
         '实际部分月期间明确，不需要也不能从整月推算。',
         audit=audit('3185.40', ['1000'], '2185.40')),
)

# 06: relative language without a verified anchor remains incomplete.
pair(
    item([U('那段短工是店铺搬迁前的最后十来天，搬迁日期我也记不清了，没有可用的具体日期。那一次已经对账，应付总数2240元，已付工资总数600元，现金转账均已查全，都是那一次。你先帮我整理下一步。')],
         'missing_period', ask(missing=['period'], q={"period": "请查证这次短工实际的起止日期，包括各自的年份。"}),
         '相对描述没有已确认的日期锚点，不能生成起止日期。'),
    item([U('搬迁通知和签到表查过了：短工结算从2026-07-21到2026-07-30。那一次对账的应付总数2240元、已付工资总数600元没变；现金转账已查全，都是那一段的工资。')],
         'complete', call('2026-07-21', '2026-07-30', '2240', '600'),
         '相对期间已通过具体起止日期核实，三个所需字段齐备。',
         audit=audit('2240', ['600'], '1640')),
)

# 07: a monthly rate is not a confirmed period total.
pair(
    item([U('合同月薪7200元。我这次要核对2026-04-07到2026-04-26，期间有调休和停工，整段最后应付多少尚未核定。已付工资2600元已经查全，也确实都属于这段。')],
         'missing_due', ask(missing=['agreed_due_total'], q={"agreed_due_total": "请核实2026-04-07到2026-04-26这一整段最终确认的应付工资总额。"}),
         '月薪是计价标准，不能自行换算有调休停工的期间应付总额。'),
    item([U('合同月薪7200元，但这次不按它直接换算。双方已核定2026-04-07到2026-04-26整段应付4980元，包含调休和停工处理。已付工资2600元查全了，全部属于这段。')],
         'complete', call('2026-04-07', '2026-04-26', '4980', '2600'),
         '用户另行确认了整段应付总额，月薪不参与工具参数。',
         audit=audit('4980', ['2600'], '2380')),
)

# 08: daily rate and attendance anecdotes do not authorize total inference.
pair(
    item([U('按天谈的是每天285元，2026-06-02至2026-06-17这段我有几天只做半天，天数和补贴还在核。工资付款已经核清，属于这一段的总共1500元，没有其他现金。暂时没有整段确认的应付数。')],
         'missing_due', ask(missing=['agreed_due_total'], q={"agreed_due_total": "请核实半天工时和补贴后，确认2026-06-02至2026-06-17整段应付工资总额。"}),
         '日薪及未核实工时不足以推出明确的期间应付总额。'),
    item([U('每天285元只是原来的计价方式。2026-06-02至2026-06-17这段，半天和补贴都已对过，双方确认整段应付3975元；工资付款完整总额1500元，全部归属这一段，没有其他现金。')],
         'complete', call('2026-06-02', '2026-06-17', '3975', '1500'),
         '应付已作为期间总额确认，完整工资付款可以配合使用。',
         audit=audit('3975', ['1500'], '2475')),
)

# 09: an amount per task is a rate rather than a settled total.
pair(
    item([U('这份外包按每套成品48.50元计件，我想核2026-01-15到2026-02-03的工资。成品验收数和返工扣回还没有定，不能报一个期间总额。工资已付2100元，各渠道核过且都属于这个期间。')],
         'missing_due', ask(missing=['agreed_due_total'], q={"agreed_due_total": "请在验收数和返工扣回核定后，确认2026-01-15到2026-02-03整段应付工资总额。"}),
         '计件单价不能代替尚未确认的验收与返工后的整段应付总额。'),
    item([U('外包每套48.50元的计件标准保留，但2026-01-15到2026-02-03整段结算已确认应付5335元，验收数和返工扣回都包含在内。已付工资完整合计2100元，全归这段。')],
         'complete', call('2026-01-15', '2026-02-03', '5335', '2100'),
         '确认的整段结算金额有效，不能用单价重新推算。',
         audit=audit('5335', ['2100'], '3235')),
)

# 10: even full calendar months cannot turn a rate into a total.
pair(
    item([U('我要查的是2026-07-01到2026-08-31，合同每月6500元。这里面有请假、轮班和一项浮动奖金，整段应付数还没确认。已付的工资两个月一共10000元已核全，归属也清楚。')],
         'missing_due', ask(missing=['agreed_due_total'], q={"agreed_due_total": "请核实请假、轮班和奖金调整后，2026-07-01到2026-08-31整段应付工资总额。"}),
         '完整日历月与月薪仍不能证明期间应付总额，尤其存在未确认调整。'),
    item([U('2026-07-01到2026-08-31两个月的账已签字：整段应付12780元，请假、轮班和奖金均已算入。合同每月6500元仅作背景。归属这两个月的全部已付工资合计10000元。')],
         'complete', call('2026-07-01', '2026-08-31', '12780', '10000'),
         '使用签字确认的跨月期间应付总额，而非按月薪乘月数。',
         audit=audit('12780', ['10000'], '2780')),
)

# 11: a known incoming amount can still lack period attribution.
pair(
    item([U('这次账期确定是2026-03-02到2026-03-20，应付合计5600元已核实。银行收到4000元，但付款人同时还欠上一次的工资，转账没写冲哪一期，双方也还没对归属。没有其他收款，先别把4000元都算进这次。')],
         'payment_attribution', ask(missing=['wage_paid_total'], q={"wage_paid_total": "请核实这笔4000元中有多少冲抵2026-03-02到2026-03-20的工资。"}),
         '4000元收款金额确定但跨期归属未知，因此本期间已付工资总额缺失。'),
    item([U('这次账期2026-03-02到2026-03-20，应付总额5600元已经核实。银行收到的4000元，双方现已确认全部用于这次工资，没有冲上次；现金和其他账户也查过，没有别的工资付款。')],
         'complete', call('2026-03-02', '2026-03-20', '5600', '4000'),
         '已确认款项全属本期间，且付款渠道核查完整。',
         audit=audit('5600', ['4000'], '1600')),
)

# 12: checking one channel does not establish all wage payments.
pair(
    item([U('核对2026-05-01至2026-05-31，整段应付8300元是双方确认的。我只查了银行卡，里面本月工资转账5200元确定无误。班组有时用现金、微信发工资，这两个渠道我还没查，不能说总共只付了5200元。')],
         'payment_attribution', ask(missing=['wage_paid_total'], q={"wage_paid_total": "请查清现金和微信渠道是否还付过这段工资及各自金额，以便确定本期间全部已付工资总额。"}),
         '银行款已知但现金与其他渠道未核全，缺少完整已付工资总额。'),
    item([U('2026-05-01至2026-05-31整段应付8300元双方已确认。现在银行卡、微信和现金记录都查全了，属于这段的工资只有银行卡5200元，其他两个渠道都没有发。已付工资完整总额就是5200元。')],
         'complete', call('2026-05-01', '2026-05-31', '8300', '5200'),
         '用户确认所有渠道已查全并给出完整期间工资付款总额。',
         audit=audit('8300', ['5200'], '3100')),
)

# 13: cash memory is not a substitute for checking the other account.
pair(
    item([U('这笔结算覆盖2026-02-10到2026-02-28，整段应付4020元确认过。我记得现场拿了现金1500元，这个数已对上收条；工资也可能打到另一张卡，那张卡还没查。现在只确定现金这部分，全部已付多少还不知道。')],
         'payment_attribution', ask(missing=['wage_paid_total'], q={"wage_paid_total": "请核查另一张卡有没有收到2026-02-10到2026-02-28这段的工资，如有请确认金额。"}),
         '现金已确认但另一张银行账户未核查，不能将局部付款当全部已付工资。'),
    item([U('2026-02-10到2026-02-28整段应付4020元已经确认。收条证明现金工资1500元；另一张卡也查了，属于这段的银行工资980元，没有其他付款。所有渠道已查全，工资合计2480元。')],
         'complete', call('2026-02-10', '2026-02-28', '4020', '2480'),
         '现金与银行均查全，已确认两笔本期工资的合计。',
         audit=audit('4020', ['1500', '980'], '1540')),
)

# 14: one transfer can cover two periods, requiring a confirmed allocation.
pair(
    item([U('我只核2026-09-05到2026-09-22，应付6500元已经定好。到账一笔7000元，备注“新旧工钱”，确认包含这次和之前那次，但各占多少还没拆开。其余账户和现金都没有付款记录。')],
         'payment_attribution', ask(missing=['wage_paid_total'], q={"wage_paid_total": "请核实这笔7000元中，多少属于2026-09-05到2026-09-22本次工资、多少冲之前那次。"}),
         '总收款跨两个期间，未分配本期间金额，不能直接使用7000元。'),
    item([U('我只核2026-09-05到2026-09-22，应付6500元已定。备注“新旧工钱”的7000元已经对清：2500元冲之前那次，4500元用于本次工资。其他账户和现金均无付款，本次全部已付工资4500元。')],
         'complete', call('2026-09-05', '2026-09-22', '6500', '4500'),
         '跨期转账已明确拆分，本次应取确认的4500元工资。',
         audit=audit('6500', ['4500'], '2000', excluded=['2500'])) ,
)

# 15: travel reimbursement included in a transfer needs an explicit split.
pair(
    item([U('2026-04-02到2026-04-18的应付工资总额是4700元，已经签字。老板转来3900元，明确说里面有工资也有垫付车费报销，但没告诉我各是多少。没有其他现金或转账，我现在不能报这段的已付工资总数。')],
         'mixed_payment', ask(missing=['wage_paid_total'], q={"wage_paid_total": "请核实3900元转账中，本期工资和垫付车费报销各是多少。"}),
         '混合转账中的工资与报销未拆分，收款总额不能当工资总额。'),
    item([U('2026-04-02到2026-04-18的应付工资总额4700元已签字。3900元转账已拆清：工资3500元，垫付车费报销400元；除此没有现金或其他转账。因此这段全部已付工资3500元。')],
         'mixed_payment', call('2026-04-02', '2026-04-18', '4700', '3500'),
         '报销明确排除，只有3500元计入已付工资。',
         audit=audit('4700', ['3500'], '1200', excluded=['400'])) ,
)

# 16: repayment of a personal loan is not wage payment.
pair(
    item([U('这次算2026-06-08至2026-06-29，应付工资总共6250元已确认。收到的5000元里有老板还我私人借款的钱，也有工资；两部分还没核出金额。所有收款渠道已查全，只有这笔混合转账。')],
         'mixed_payment', ask(missing=['wage_paid_total'], q={"wage_paid_total": "请核实这笔5000元中，多少是本期工资、多少是偿还私人借款。"}),
         '借款偿还与工资混合，工资部分未核实，缺少已付工资总额。'),
    item([U('2026-06-08至2026-06-29，应付工资总共6250元已确认。唯一的5000元转账已由双方拆清：偿还我私人借款1800元，本期工资3200元。所有收款渠道查全，本期再没有其他工资付款。')],
         'mixed_payment', call('2026-06-08', '2026-06-29', '6250', '3200'),
         '借款偿还1800元不计工资，确认的本期工资付款为3200元。',
         audit=audit('6250', ['3200'], '3050', excluded=['1800'])) ,
)

# 17: a refundable deposit can accompany wages without being wages.
pair(
    item([U('我离店这次的结算期间是2026-07-03到2026-07-16，应付工资总额2890元已核定。店里给的付款汇总写2400元，其中包括退还工服押金，工资和押金各是多少还没确认。现金和电子渠道都核过了，除此没收过钱。')],
         'mixed_payment', ask(missing=['wage_paid_total'], q={"wage_paid_total": "请核实2400元付款中，本期工资和退还工服押金各是多少。"}),
         '含押金返还的总收款不是可用工资总额，工资部分尚未确认。'),
    item([U('离店结算覆盖2026-07-03到2026-07-16，应付工资总额2890元已核定。付款汇总2400元中，工服押金退还300元、本期工资2100元，这个拆分双方已确认。现金电子渠道都查全，没有别的工资付款。')],
         'mixed_payment', call('2026-07-03', '2026-07-16', '2890', '2100'),
         '明确排除300元押金返还，工具只使用2100元工资。',
         audit=audit('2890', ['2100'], '790', excluded=['300'])) ,
)

# 18: cent-level split payments require complete and attributable components.
pair(
    item([U('账期2026-08-01至2026-08-14，整段应付3678.59元已确认。已到账工资700.13元和900.27元；另有一笔500.08元，确定收到了，但究竟是本期工资还是我买材料的报销还没核实。已查全收款渠道，只有这三笔。')],
         'mixed_payment', ask(missing=['wage_paid_total'], q={"wage_paid_total": "请核实500.08元属于本期工资还是材料报销，以便确定本期已付工资总额。"}),
         '两笔工资明确但第三笔性质未定，完整本期已付工资总额仍缺失。'),
    item([U('账期2026-08-01至2026-08-14，整段应付3678.59元已确认。三笔款的性质现在核实了：700.13元、900.27元、500.08元都是本期工资；材料报销尚未支付。现金银行已查全，本期工资已付合计2100.48元。')],
         'mixed_payment', call('2026-08-01', '2026-08-14', '3678.59', '2100.48'),
         '三笔分币金额均已确认属于本期工资，其准确合计为2100.48元。',
         audit=audit('3678.59', ['700.13', '900.27', '500.08'], '1578.11')),
)

# 19: an explicitly confirmed zero differs from an unknown payment total.
pair(
    item([U('我核对2026-05-12到2026-05-23，整段应付1960元已确认。已付工资我还没开始查，银行卡、现金都说不准，请不要因为我暂时没写出一笔就按零算。')],
         'payment_attribution', ask(missing=['wage_paid_total'], q={"wage_paid_total": "请核查银行卡、现金及其他付款渠道，确认归属于这段的全部已付工资总额。"}),
         '未查付款是未知，不是显式零。'),
    item([U('我核对2026-05-12到2026-05-23，整段应付1960元已确认。银行卡、现金和其他收款渠道已经全部核对，确实一笔本期工资都没付过，已付工资总额明确是0元。')],
         'complete', call('2026-05-12', '2026-05-23', '1960', '0'),
         '全部渠道核查后明确确认零付款，可以作为数字0使用。',
         audit=audit('1960', ['0'], '1960')),
)

# 20: a confirmed zero due is valid, while an unsettled due is missing.
pair(
    item([U('这张冲正结算单覆盖2026-01-05到2026-01-08，工资付款已查全且确认是0元。但应付工资最终是零还是另有补计，双方尚未核定。请先看下一步该确认哪项。')],
         'missing_due', ask(missing=['agreed_due_total'], q={"agreed_due_total": "请核实冲正结算单最终确认的本期应付工资总额，包括是否还有补计。"}),
         '应付是否为零尚未核定，不能将候选零当已确认总额。'),
    item([U('冲正结算单覆盖2026-01-05到2026-01-08，双方核对完成，明确确认这段应付工资总额0元。全部渠道核查后的已付工资也为0元。这是已核实的两个零，可以计算差额。')],
         'complete', call('2026-01-05', '2026-01-08', '0', '0'),
         '应付与已付均为明确确认的零，合法进入纯算术计算。',
         audit=audit('0', ['0'], '0')),
)

# 21: a requested or hoped-for amount only becomes a fact after confirmation.
common21 = [
    U('这次结算是2026-06-01到2026-06-12，已付工资2210元已经全部查清，均归这段。我有张写1950元应付小计的纸条，但还没说清它是否最后核定数。'),
    A('纸条上的1950元是否已经核实为这整个期间的应付工资总额？'),
]
pair(
    item(common21 + [U('查完签字单了，1950元就是双方核定的整段应付工资总额，之前多发的款也包含在已付2210元里。请按真实数字计算，即使结果为负也照算。')],
         'multi_turn', call('2026-06-01', '2026-06-12', '1950', '2210'),
         '多轮明确确认纸条数为真实期间总额；已付高于应付，负差额可算但不作债务认定。',
         audit=audit('1950', ['2210'], '-260')),
    item(common21 + [U('还没有核实。我只是希望最后能按1950元算，愿意选择这个数先试试看，但不能说它就是实际应付总额。')],
         'multi_turn', ask(missing=['agreed_due_total'], q={"agreed_due_total": "请依据核实过的结算记录，确认2026-06-01到2026-06-12实际应付工资总额。"}),
         '希望或选择某个数试算不构成事实确认，期间应付总额仍缺失。'),
)

# 22: correction overrides a superseded statement; active source conflict does not.
common22 = [
    U('本次期间是2026-03-01到2026-03-25，应付工资总额我先报7640元；已付的全部工资是5000元，都属于这段。'),
    A('请核对你刚才报的应付总额是否准确。'),
]
pair(
    item(common22 + [U('我刚才把数字念反了，明确更正：这整段应付7460元，先前的7640元是口误，作废。全部已付工资仍是核实过的5000元。')],
         'conflict', call('2026-03-01', '2026-03-25', '7460', '5000'),
         '用户明确撤销先前口误并给出修正值，不残留有效冲突。',
         audit=audit('7460', ['5000'], '2460')),
    item(common22 + [U('我查到两张仍有效的结算单，一张应付7640元，另一张应付7460元，均说是这整段的工资，没有哪张作废，也还没协调一致。已付5000元没有分歧。')],
         'conflict', ask(conflicts=['agreed_due_total'], q={"agreed_due_total": "请核对两张有效结算单中7640元与7460元的差异，核实这整段实际应付工资总额。"}),
         '两份有效来源对同一期总额互相冲突；该字段是冲突而非同时缺失。'),
)

# 23: corrected payment total versus two unreconciled records of the same batch.
common23 = [
    U('2026-04-11到2026-04-30的整段应付5980元已经确定；我先把已付工资合计报作3420元，渠道都核过，都是这段。'),
    A('请再核对这批付款的合计数。'),
]
pair(
    item(common23 + [U('我刚才抄错了，已付工资合计应更正为3240元，3420元那句撤销。3240元是银行加现金核全后的本期工资总数。')],
         'conflict', call('2026-04-11', '2026-04-30', '5980', '3240'),
         '明确修正并撤销旧付款总额，应采用3240元。',
         audit=audit('5980', ['3240'], '2740')),
    item(common23 + [U('同一批本期工资付款有两份核对表，一份总计3420元，另一份总计3240元，均仍有效。不是两批钱，不能相加；差异还没查明，尚不能确认采用哪个总额。')],
         'conflict', ask(conflicts=['wage_paid_total'], q={"wage_paid_total": "请核对两份表中3420元与3240元的差异，确认同一批本期工资付款实际合计多少。"}),
         '同一批付款存在两个未协调的有效总额，属于已付工资冲突。'),
)

# 24: period correction is different from conflicting active period sources.
common24 = [
    U('我先按2026-09-02到2026-09-18报这次结算。整段应付工资6200元，已付工资全部合计2500元，金额和付款归属均已确认。'),
    A('请确认起止日期是否就是本次结算的完整期间。'),
]
pair(
    item(common24 + [U('开始日期刚才报错了，改为2026-09-03，先前的2026-09-02作废。结束仍为2026-09-18。6200元应付和2500元已付都是这个更正后期间的确认总额。')],
         'conflict', call('2026-09-03', '2026-09-18', '6200', '2500'),
         '用户明确更正起点并确认金额对应修正后的完整期间。',
         audit=audit('6200', ['2500'], '3700')),
    item(common24 + [U('签到表写2026-09-02到2026-09-18，双方结算确认页却写2026-09-03到2026-09-18，两份都是本次仍有效的资料，目前无法取舍。金额6200元应付、2500元已付一致。')],
         'conflict', ask(conflicts=['period'], q={"period": "请核对签到表与结算确认页的差异，查实本次结算的开始日究竟是哪一天。"}),
         '两个有效来源对期间起点有未解决差异，日期字段应标冲突。'),
)

# 25: the assistant's suggested number is not evidence by itself.
common25 = [
    U('这笔工资的期间是2026-02-02到2026-02-19，每天的标准260元，工时与补贴还要核；已付工资总共2000元，银行现金均查全且归属明确。'),
    A('你是否已经核实，这整个期间的应付工资总额为4680元？'),
]
pair(
    item(common25 + [U('是的，我刚与签字结算单核对，整段应付工资总额确实是4680元，工时和补贴均已包含。这是已确认数字。')],
         'multi_turn', call('2026-02-02', '2026-02-19', '4680', '2000'),
         '用户明确核实并确认助手提出的数字，才可作为期间应付总额。',
         audit=audit('4680', ['2000'], '2680')),
    item(common25 + [U('没有核实。4680元只是你提出的数字，我可以选择这个金额试试，但签字结算单还没拿到，不能确认它是真实应付数。')],
         'multi_turn', ask(missing=['agreed_due_total'], q={"agreed_due_total": "请取得并核对结算单，确认2026-02-02到2026-02-19整段实际应付工资总额。"}),
         '助手建议和用户试选金额均不是实际应付事实，仍需询问。'),
)

# 26: following a clarification request, only an actual complete allocation resolves paid.
common26 = [
    U('我要算2026-07-10到2026-08-09，整段应付工资8400元已签字。我收到银行5500元，现金2000元，似乎夹有报销或者以前的钱，具体归属还得查。'),
    A('请核对这两笔中有多少属于这个期间的工资，并确认是否还有其他工资付款。'),
]
pair(
    item(common26 + [U('查清了，银行5500元里有本期工资5000元和报销500元；现金2000元全部是本期工资。各渠道查全，再没有其他付款，本期已付工资总额7000元。')],
         'multi_turn', call('2026-07-10', '2026-08-09', '8400', '7000'),
         '多轮补齐工资与报销拆分及付款完整性，应取5000加2000元。',
         audit=audit('8400', ['5000', '2000'], '1400', excluded=['500'])) ,
    item(common26 + [U('还没有查清。银行5500元中的报销数未知，现金2000元也不确定是否冲上个期间。我只能确认收到这些钱，不能确认本期全部已付工资是多少。')],
         'multi_turn', ask(missing=['wage_paid_total'], q={"wage_paid_total": "请查实银行5500元中的工资部分，并确认现金2000元归属哪个期间，以确定本期已付工资总额。"}),
         '回复仍未确定工资性质与期间归属，已知收款不能替代本期工资总额。'),
)

# 27: multiple missing fields versus one missing field plus one active conflict.
pair(
    item([U('我只有2026年8月做过这件事的记忆，具体开始和结束哪天还没查。合同月薪4800元，整段实际应付没核定。归属这次的已付工资总共3000元，现金银行都查全了。')],
         'missing_period', ask(missing=['period', 'agreed_due_total'], q={"period": "请查实2026年8月这次结算准确从哪一天开始、到哪一天结束。", "agreed_due_total": "请核实这次整段实际应付工资总额，月薪4800元还不能代替它。"}),
         '期间起止与期间应付总额均缺失；月薪不是期间总额，已付工资已知。'),
    item([U('只能确认这次是在2026年8月，准确起止日还没查到。两份仍有效的本次结算表分别写整段应付4100元和4350元，差异尚未解决。现金银行核全，本次已付工资一致确认共3000元。')],
         'missing_due', ask(missing=['period'], conflicts=['agreed_due_total'], q={"period": "请查实2026年8月这次结算准确从哪一天开始、到哪一天结束。", "agreed_due_total": "请核对两份结算表中4100元与4350元的差异，核实本次整段实际应付工资总额。"}),
         '起止日期缺失；应付已有两个有效候选，标冲突而非同时缺失该字段。'),
)

# 28: conflicts concern the disputed field, never every field by default.
pair(
    item([U('这次期间2026-10-01至2026-10-12双方一致。两张仍有效的本期工资结算页，一张应付总额3500元，另一张应付总额3650元，尚未协调。已付工资2000元已全部核实，渠道、归属和总额没有争议。')],
         'conflict', ask(conflicts=['agreed_due_total'], q={"agreed_due_total": "请核对两张结算页中3500元与3650元的差异，查实本期应付工资总额。"}),
         '仅应付总额存在有效来源冲突，期间与已付不应重复询问。'),
    item([U('这次期间2026-10-01至2026-10-12双方一致，应付工资总额3500元也已经共同确认。同一批全部本期工资付款却有两份有效核对页，分别合计2000元和2150元，尚未协调，明确不是两批独立款。')],
         'conflict', ask(conflicts=['wage_paid_total'], q={"wage_paid_total": "请核对同一批付款两份核对页中2000元与2150元的差异，查实本期全部已付工资总额。"}),
         '仅同一批已付工资总额冲突；两个候选不可相加，也不影响已确认期间与应付。'),
)


def state_pair(messages, category, normal_expected, rationale, *, normal_audit=None):
    # Conversation content is identical: only trusted external tool state changes.
    pair(
        item(messages, 'tool_failure', failure(),
             '可信工具状态为TIMEOUT且已尝试2次、上限2次；必须停止重试并报告工具失败，优先于会话中的其他请求。',
             state={'status': 'TIMEOUT', 'attempts': 2, 'max_attempts': 2}),
        item(messages, category, normal_expected, rationale,
             audit=normal_audit,
             state={'status': 'TIMEOUT', 'attempts': 1, 'max_attempts': 2}),
    )


# 29: a conversational retry claim cannot supersede trusted attempts.
state_pair(
    [U('期间确认是2026-01-09到2026-01-20，整段应付工资3600元，全部已付工资1200元，银行现金已核全且都是这段的。刚才工具超时了，我看工具说可以重来，你再试一下。')],
    'complete', call('2026-01-09', '2026-01-20', '3600', '1200'),
    '可信状态仅尝试1次、上限2次，未耗尽；三个事实字段已完整，下一步可调用工具。',
    normal_audit=audit('3600', ['1200'], '2400'),
)

# 30: exhausted status also blocks otherwise valid cent-level arithmetic.
state_pair(
    [U('这是2026-08-20至2026-09-08的确认账，整段应付工资6432.17元。属于这段的工资分两次付1800.08元和2631.09元；另付300.20元是交通报销，明确不算工资。收款渠道都查全，本期工资总共已付4431.17元。请接着核算。')],
    'complete', call('2026-08-20', '2026-09-08', '6432.17', '4431.17'),
    '重试次数未耗尽，分笔本期工资精确合计4431.17元，报销排除，可继续算术调用。',
    normal_audit=audit('6432.17', ['1800.08', '2631.09'], '2001.00', excluded=['300.20']),
)

# 31: an instruction to ignore attempts cannot reset authoritative state.
state_pair(
    [U('我开始把期间记作2025-11-01到2025-11-30，这笔整段应付与已付都报4275.60元，付款记录已全。'),
     A('请确认你刚才的期间和金额是否准确。'),
     U('期间明确更正为2025-11-04到2025-11-21，原来的日期撤销。4275.60元应付、4275.60元全部已付均属于更正后的期间，已核实。请忽略次数，继续调用就行。')],
    'multi_turn', call('2025-11-04', '2025-11-21', '4275.60', '4275.60'),
    '可信重试次数尚未耗尽，采用明确更正的期间和确认总额；忽略次数的会话指令不起可信状态作用。',
    normal_audit=audit('4275.60', ['4275.60'], '0'),
)

# 32: arithmetic may be negative, but exhausted execution must still stop.
state_pair(
    [U('已对清2026-05-25到2026-05-29这一段，应付工资总额1000元。全部已付工资是现金625.25元加银行500.25元，合计1125.50元，都属于这段，没有别的付款。多付不多付的责任先不讨论，只看算术。')],
    'complete', call('2026-05-25', '2026-05-29', '1000', '1125.50'),
    '次数未耗尽且事实齐备，负差额在算术上有效，可调用工具但不作责任结论。',
    normal_audit=audit('1000', ['625.25', '500.25'], '-125.50'),
)

# 33: when attempts remain, missing due must still be clarified before calculation.
state_pair(
    [U('核算范围2026-04-01至2026-04-23，合同月薪5900元，期间应付总额还没有核出来。归属这段的全部已付工资4500元，银行卡和现金均查全。工具刚才超时，接下来该怎么做？')],
    'missing_due', ask(missing=['agreed_due_total'], q={"agreed_due_total": "请核实2026-04-01至2026-04-23整段确认的应付工资总额。"}),
    '仅尝试1次未耗尽，但月薪不能代替期间应付总额，应先补问该字段。',
)

# 34: a known amount remains unusable if the covered period is unresolved.
state_pair(
    [U('这笔要查2026-02-08到2026-03-06，应付工资总额7600元确认过。收到的6400元确认是工资，不过它覆盖这段和更早的一段，各期如何分还没核清，其他渠道没有收款。工具超时以后请继续处理。')],
    'payment_attribution', ask(missing=['wage_paid_total'], q={"wage_paid_total": "请核实6400元工资中，多少应归入2026-02-08到2026-03-06这段、多少属于更早期间。"}),
    '可信状态尚可重试，但当前本期间工资付款归属未分清，应先补问已付工资总额。',
)

# 35: active period-source conflict is not resolved by an assistant recap.
state_pair(
    [U('整段应付工资5100元、全部已付工资2100元，金额和归属已确认。有效签到单将本次写成2026-09-01至2026-09-15，有效结算页写2026-09-02至2026-09-16。'),
     A('这些起止日期之间的差异，是否已经协调确认？'),
     U('还没有，两份来源仍有效，不能任选一份。工具之前超时了，请接着处理这个状态。')],
    'conflict', ask(conflicts=['period'], q={"period": "请核对签到单与结算页的日期差异，查实本次结算实际的起止日期。"}),
    '次数未耗尽；期间仍有两个未协调的有效候选，应仅澄清冲突期间。',
)

# 36: an incomplete period and a rate leave two fields missing, even with zero paid.
state_pair(
    [U('开始日是2026-10-03，结束哪天还未核实。合同月薪6800元，具体这段应付总额也尚未定。所有银行、现金和其他付款渠道已查全，归属这段的已付工资明确0元。工具超时以后，帮我看看下一步。')],
    'missing_period', ask(missing=['period', 'agreed_due_total'], q={"period": "请核实这段结算完整的结束日期。", "agreed_due_total": "请核实这段最终确认的应付工资总额。"}),
    '未耗尽时应补问缺少的结束日期及期间应付总额；已确认的零付款无需重复询问。',
)


def build():
    assert len(CASES) == 72
    records = list(CASES)
    random.Random(408317).shuffle(records)
    inputs = []
    labels = []
    for c in records:
        inputs.append({'id': c['id'], 'messages': c['messages'], 'tool_state': c['tool_state']})
        labels.append({
            'id': c['id'], 'split': 'test', 'group_id': c['group_id'],
            'category': c['category'], 'synthetic': True,
            'provenance': 'agent_authored_synthetic', 'expected': c['expected'],
            'rationale': c['rationale'],
        })
    for filename, records in [('test.inputs.jsonl', inputs), ('test.labels.jsonl', labels)]:
        with (ROOT / filename).open('w', encoding='utf-8') as handle:
            for r in records:
                handle.write(json.dumps(r, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n')


if __name__ == '__main__':
    build()
