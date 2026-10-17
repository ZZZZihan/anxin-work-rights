#!/usr/bin/env python3
"""Author a fresh synthetic holdout from the public v3 business contract only.

No imports or reads from any model, implementation, prompt, historical dataset,
historical result, or training artifact are used here.
"""
from __future__ import annotations

from collections import Counter
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import random

ROOT = Path(__file__).resolve().parent
FIELDS = ("period", "agreed_due_total", "wage_paid_total")
INPUTS, LABELS, PROVENANCE = [], [], []
PAIR_INDEX = []


def money(value):
    return format(Decimal(str(value)), ".2f")


def span(start, end):
    return {"start": start, "end": end}


def cn_period(value):
    if value is None:
        return "尚未确定起止日期的同一段工资期间"
    if isinstance(value, list):
        return "或".join(cn_period(item) for item in value)
    return f"{value['start']} 至 {value['end']}"


class Case:
    def __init__(self, pair, variant, category, context, final, attempt=None):
        self.pair, self.variant, self.category = pair, variant, category
        self.id = f"v3t{(pair - 1) * 2 + (1 if variant == 'a' else 2):03d}"
        self.bundle = {"case_id": self.id, "sources": [], "events": []}
        self.last = {}
        self.current_period = None
        followups = (
            "好，我先按这一次结算记录。之后核过哪些项目，可以继续补充。",
            "明白。起止日期、应付和已付的核对记录，可以接着放在一起。",
            "我记下工作背景了，你继续说这次结算后来核到哪一步。",
            "这次先围绕这一段工资整理，后续的对账情况也请接着说。",
            "收到，相关总额和期间的补充记录可以继续提供。",
            "好的，先把这段情况留住，再补充后来是否有核实或修正。",
            "我了解这次工作的背景了，接着看你后续核对的结果。",
            "这段结算先单独记下来，你可以继续说后面的账目情况。",
            "知道了，已有记录之外，后来确认或变更的内容也一起保留。",
            "收到。请继续补充这段结算当时留下的记录。",
            "我先记下这些背景，后续对账记录可以接着补上。",
            "好，把这次的情况单独整理，后来核清的内容也请一起留住。",
        )
        self.messages = [
            {"role": "user", "content": context},
            {"role": "assistant", "content": followups[(pair - 1) % len(followups)]},
            {"role": "user", "content": final},
        ]
        self.tool_state = None if attempt is None else {
            "status": "TIMEOUT", "attempts": attempt, "max_attempts": 2,
        }
        self.origins = []

    def event(self, field, value, status="confirmed", meaning=None,
              complete=True, text=None, source_kind=None, note=""):
        if meaning is None:
            meaning = "period" if field == "period" else "period_wage_total"
        if field != "period" and value is not None:
            value = [money(item) for item in value] if isinstance(value, list) else money(value)
        eid = f"e{len(self.bundle['events']) + 1}"
        sid = f"s{len(self.bundle['sources']) + 1}"
        scope = None if field == "period" else self.current_period
        kind = source_kind or ("confirmation" if status == "confirmed" else "evidence")
        if text is None:
            if field == "period":
                if status == "unknown":
                    text = "记录：本段工资的起止日期目前没有得到确认。"
                elif status == "conflict":
                    text = f"期间记录不一致，分别写作 {cn_period(value)}，尚未确定哪一段适用。"
                elif status == "candidate":
                    text = f"登记表暂写工资期间为 {cn_period(value)}，当事人尚未确认起止日期。"
                else:
                    text = f"受控确认记录：当事人在此情境中确认工资期间为 {cn_period(value)}。"
            else:
                period_event = next((e for e in self.bundle["events"] if e["id"] == scope), None)
                period_value = period_event["value"] if period_event else None
                period_desc = cn_period(period_value)
                field_desc = "应付" if field == "agreed_due_total" else "已付"
                if status == "unknown":
                    text = f"记录：{period_desc} 的完整{field_desc}工资总额目前未知。"
                elif status == "conflict":
                    text = f"{period_desc} 的完整{field_desc}工资总额出现相互冲突的记录：" + "、".join(f"{v} 元" for v in value) + "，冲突尚未解除。"
                elif status == "confirmed":
                    text = f"受控确认记录：当事人在此情境中确认 {period_desc} 的本期完整{field_desc}工资总额为 {value} 元。"
                else:
                    meaning_desc = {
                        "period_wage_total": "本期工资总额候选",
                        "monthly_rate": "每月工资费率",
                        "mixed_payment": "含工资及其他款项的混合金额",
                        "unattributed_payment": "尚未明确归属哪一期工资的款项",
                    }[meaning]
                    completeness = "记录自称覆盖全部款项" if complete else "现有记录还不完整"
                    text = f"{period_desc} 的资料记有 {value} 元，属于{meaning_desc}；{completeness}，尚未通过受控渠道确认本期完整{field_desc}总额。"
        src = {"id": sid, "kind": kind, "text": text,
               "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest()}
        event = {
            "id": eid, "field": field, "status": status, "value": value,
            "scope": scope, "meaning": meaning, "complete": complete,
            "supersedes": self.last.get(field),
            "refs": [{"source_id": sid, "start": 0, "end": len(text), "quote": text}],
        }
        self.bundle["sources"].append(src)
        self.bundle["events"].append(event)
        self.last[field] = eid
        if field == "period":
            self.current_period = eid
        self.origins.append({
            "event_id": eid, "field": field, "source_id": sid,
            "source_kind": kind, "status_in_input": status, "value_in_input": value,
            "scope_in_input": scope, "meaning_in_input": meaning,
            "complete_in_input": complete, "supersedes_in_input": event["supersedes"],
            "synthetic_origin": note or "为本次新留出情境独立编写的模拟记录；不是历史样本、真实材料或真实用户确认。",
            "support": "引用覆盖整条源文本；日期和金额均以与事件值一致的明确字面值列出。" if value is not None else "未知或撤回记录无数值；该状态不表示数值为零。",
        })
        return eid

    def all(self, period, due, paid):
        self.event("period", period)
        self.event("agreed_due_total", due)
        self.event("wage_paid_total", paid)
        return self

    def finish(self, missing=(), conflicts=(), call=None, terminal=False, rationale=""):
        if terminal:
            expected = {"missing": [], "conflicts": [], "next_action": {
                "type": "report_tool_failure", "questions": [], "tool": None, "arguments": None,
            }}
        elif call is not None:
            period, due, paid = call
            expected = {"missing": [], "conflicts": [], "next_action": {
                "type": "call_tool", "questions": [], "tool": "calculate_wage_gap",
                "arguments": {"period_start": period["start"], "period_end": period["end"],
                              "due": float(Decimal(money(due))), "paid": float(Decimal(money(paid)))},
            }}
        else:
            questions = []
            for field in FIELDS:
                if field not in missing and field not in conflicts:
                    continue
                latest = next((e for e in reversed(self.bundle["events"]) if e["field"] == field), None)
                stale = latest is not None and field != "period" and latest["scope"] != self.current_period
                if field == "period" and field in conflicts:
                    question = "请核实相互冲突的工资期间，确认目前适用的开始日期和结束日期。"
                elif field == "period":
                    question = "请核实这段工资期间的开始日期和结束日期，确认目前适用的是哪一段。"
                else:
                    noun = "应付" if field == "agreed_due_total" else "已付"
                    if field in conflicts:
                        question = f"请核实当前期间相互冲突的{noun}工资记录，确认哪一个才是本期完整{noun}工资总额。"
                    elif stale:
                        question = f"工资期间已经改变，请重新核实当前期间完整的{noun}工资总额；旧期间的确认不能直接沿用。"
                    elif latest is not None and latest["meaning"] == "monthly_rate":
                        question = f"目前记录的是每月费率，请确认当前整段期间完整的{noun}工资总额是多少。"
                    elif latest is not None and latest["meaning"] == "mixed_payment":
                        question = f"请区分工资与其他款项，并确认归属于当前期间工资的完整{noun}总额。"
                    elif latest is not None and latest["meaning"] == "unattributed_payment":
                        question = f"请核实这些款项归属于哪段工资期间，并确认当前期间完整的{noun}工资总额。"
                    else:
                        question = f"请核实并确认当前这段期间完整的{noun}工资总额是多少。"
                questions.append({"field": field, "text": question})
            expected = {"missing": list(missing), "conflicts": list(conflicts), "next_action": {
                "type": "ask_user", "questions": questions, "tool": None, "arguments": None,
            }}
        INPUTS.append({"id": self.id, "messages": self.messages,
                       "tool_state": self.tool_state, "fact_bundle": self.bundle})
        LABELS.append({"id": self.id, "group_id": f"v3g{self.pair:02d}",
                       "category": self.category, "expected": expected, "rationale": rationale})
        current_states = {}
        for field in FIELDS:
            latest = next((e for e in reversed(self.bundle["events"]) if e["field"] == field), None)
            state = "unknown" if latest is None else latest["status"]
            if latest is not None and field != "period" and latest["scope"] != self.current_period:
                state = "stale"
            current_states[field] = {
                "effective_status": state, "latest_event_id": None if latest is None else latest["id"],
                "source_explanation": "无事件，因此没有确认来源，按未知处理。" if latest is None else (
                    "记录绑定旧期间，当前不可沿用；原来源仍保留。" if state == "stale" else
                    "当前值/状态来自本字段最后一条有效追加记录及其完整引文，受控确认均为合成模拟。"),
            }
        PROVENANCE.append({
            "id": self.id, "group_id": f"v3g{self.pair:02d}", "synthetic": True,
            "real_user_confirmation": False, "real_evidence": False, "expert_annotation": False,
            "authorship": "全新 Agent 编写的合成工资情境；仅模拟受控确认接口的记录。",
            "field_origins": {field: [o for o in self.origins if o["field"] == field] for field in FIELDS},
            "current_field_status": current_states,
            "absent_fields": [field for field in FIELDS if field not in self.last],
            "source_channel_semantics": "confirmation 是 fixture 中模拟受控渠道的显式类型，不由文本关键词判断；evidence 仅提供候选、冲突、未知出处。",
        })
        return self


def pair_note(number, category, change):
    PAIR_INDEX.append({"group_id": f"v3g{number:02d}", "category": category,
                       "ids": [f"v3t{number * 2 - 1:03d}", f"v3t{number * 2:03d}"],
                       "business_change": change})


def make_case(g, v, cat, context, final):
    return Case(g, v, cat, context, final, None if g <= 16 else (1 if g <= 32 else 2))


def build():
    # Each expected decision below is explicitly authored, not inferred from a model.
    # 1-6: unknown/candidate/explicit-zero contrasts: one eligible and one ask each.
    p = span("2025-02-03", "2025-02-26")
    ctx = "我在一家室内植物店做过短期盘点，那段留岗安排比较特殊，工资账想单独理一下。"
    a = make_case(1, "a", "unknown_zero", ctx, "确认页面里那段的应付写明是0.00元，店里已经转来的87.40元也核过了。")
    a.all(p, "0.00", "87.40").finish(call=(p, "0.00", "87.40"), rationale="期间及两项完整总额均经模拟受控确认；明确应付零不是未知，负差额也允许计算。")
    b = make_case(1, "b", "unknown_zero", ctx, "期间和已经转来的87.40元核过了，应付栏一直空着，我当时没说它是零。")
    b.event("period", p); b.event("wage_paid_total", "87.40")
    b.finish(missing=["agreed_due_total"], rationale="应付字段从未有事件，不能把空白替代为0.00。")
    pair_note(1, "unknown_zero", "完整应付总额明确确认零，与完全没有应付记录对照。")

    p = span("2025-03-07", "2025-03-29"); ctx = "我在社区烘焙间上晚班，账本上的应付已经核清，到账情况补充如下。"
    a = make_case(2, "a", "unknown_zero", ctx, "我还不知道有没有人代我领过款，已付情况暂时没核实。")
    a.event("period", p); a.event("agreed_due_total", "4367.28"); a.event("wage_paid_total", None, "unknown")
    a.finish(missing=["wage_paid_total"], rationale="已付未知不是已付零，必须核实本期完整已付。")
    b = make_case(2, "b", "unknown_zero", ctx, "我把现金、银行卡和代领都对过了，确认这段工资一分未付，已付总额0.00元。")
    b.all(p, "4367.28", "0.00").finish(call=(p, "4367.28", "0.00"), rationale="已付明确确认0.00且覆盖所有支付渠道；全部事实已确认。")
    pair_note(2, "unknown_zero", "本期已付由未知变成覆盖所有渠道的明确零确认。")

    p = span("2025-04-02", "2025-04-21"); ctx = "展架安装项目已结束，期间和实收款在核对页里都没有异议。"
    a = make_case(3, "a", "unknown_candidate", ctx, "计件汇总上的应付6382.15元，我刚在受控核对页确认了是整段合计。")
    a.all(p, "6382.15", "3510.00").finish(call=(p, "6382.15", "3510.00"), rationale="候选数额已升级为覆盖本期的可信完整总额确认。")
    b = make_case(3, "b", "unknown_candidate", ctx, "计件汇总上看起来是6382.15元，我还没核对里面有没有少记项目。")
    b.event("period", p); b.event("agreed_due_total", "6382.15", "candidate", complete=True); b.event("wage_paid_total", "3510.00")
    b.finish(missing=["agreed_due_total"], rationale="应付金额虽明确可见，仍是未经确认的候选。")
    pair_note(3, "unknown_candidate", "同一完整应付候选数额是否得到受控确认。")

    p = span("2025-05-11", "2025-05-30"); ctx = "我替书店做仓储理货，双方已经把这段完整应付定为5228.66元。"
    a = make_case(4, "a", "unknown_candidate", ctx, "银行卡上看到一笔2087.35元，可能是这段工资，但我还没确认有没有现金那一部分。")
    a.event("period", p); a.event("agreed_due_total", "5228.66"); a.event("wage_paid_total", "2087.35", "candidate", complete=False)
    a.finish(missing=["wage_paid_total"], rationale="可见转账并非已确认的完整本期工资已付总额。")
    b = make_case(4, "b", "unknown_candidate", ctx, "我已确认现金没有另付，那笔2087.35元就是这段全部已付工资。")
    b.all(p, "5228.66", "2087.35").finish(call=(p, "5228.66", "2087.35"), rationale="所有渠道完整核对后的本期已付已确认。")
    pair_note(4, "unknown_candidate", "单笔已付候选与完整已付总额确认对照。")

    p = span("2025-06-04", "2025-06-23"); ctx = "我在活动场馆做设备值守。应付和已付的整段金额分别是6841.90元、4822.30元，都通过核对页确认过。"
    a = make_case(5, "a", "period_confirmation", ctx, "我把排班表又看了一遍，这个起止范围也已经确认。")
    a.all(p, "6841.90", "4822.30").finish(call=(p, "6841.90", "4822.30"), rationale="期间和两项完整总额均已确认且作用于同一期间事件。")
    b = make_case(5, "b", "period_confirmation", ctx, "起止日期是登记员先填的，我还没确认过那两天是否算在里面。")
    b.event("period", p, "candidate"); b.event("agreed_due_total", "6841.90"); b.event("wage_paid_total", "4822.30")
    b.finish(missing=["period"], rationale="两项总额绑定当前期间事件，但期间本身仍为候选。")
    pair_note(5, "period_confirmation", "相同起止范围仅是候选，与已通过受控渠道确认对照。")

    p = span("2025-07-13", "2025-07-31"); ctx = "我是清洁队的临时替班人员，那次结算是整段一笔，已经核实应付3976.54元、已付1480.20元。"
    a = make_case(6, "a", "period_confirmation", ctx, "结算单只说那次替班，具体从哪天到哪天我还没找到依据。")
    a.event("period", None, "unknown"); a.event("agreed_due_total", "3976.54"); a.event("wage_paid_total", "1480.20")
    a.finish(missing=["period"], rationale="两项金额绑定当前未知期间事件，尚须确认期间；未知期间不等于可以省略。")
    b = make_case(6, "b", "period_confirmation", ctx, "我补查完交接记录，核对页现在已经确认了这次替班的起止日期。")
    b.all(p, "3976.54", "1480.20").finish(call=(p, "3976.54", "1480.20"), rationale="当前期间和两项完整总额均为已确认状态。")
    pair_note(6, "period_confirmation", "同一段结算的期间未知，与起止日期确认对照；金额均绑定各自当前期间事件。")

    # 7-10: a rate is not an authorized period total.
    monthly = [
        (7, span("2025-01-16", "2025-03-08"), "仓库夜间看护", "7316.40", "5200.00", "a"),
        (8, span("2025-08-19", "2025-09-12"), "花市摊位搬运", "5682.75", "4105.35", "b"),
        (9, span("2025-10-03", "2025-11-06"), "会务器材保养", "8867.20", "3726.18", "a"),
        (10, span("2025-12-09", "2026-01-24"), "社区洗衣点值守", "6429.83", "2957.60", "b"),
    ]
    for g, p, work, due, paid, call_variant in monthly:
        if g == 8:
            whole = span("2025-08-01", "2025-08-31")
            partial = span("2025-08-19", "2025-08-31")
            for v in ("a", "b"):
                c = make_case(8, v, "monthly_vs_period",
                              "我原来按整月做花市摊位搬运，整月那份工资确认过。后来换班，这回只整理交接后的不足月一段。",
                              "新起止范围和这段已付2105.35元确认了，应付还只留着旧的整月确认5682.75元。" if v == "a" else
                              "新范围的应付也单独核准了，本段完整应付3476.81元在受控页面重新确认，已付2105.35元没有变化。")
                c.event("period", whole); c.event("agreed_due_total", "5682.75")
                c.event("period", partial); c.event("wage_paid_total", "2105.35")
                if v == "b": c.event("agreed_due_total", "3476.81")
                c.finish(call=(partial, "3476.81", "2105.35") if v == "b" else None,
                         missing=[] if v == "b" else ["agreed_due_total"],
                         rationale="新不足月期间的完整应付有单独受控确认，当前三项事实完整。" if v == "b" else
                         "旧整月总额确认绑定旧范围，已stale；不能自行按天折算或挪到不足月期间。")
            pair_note(8, "monthly_vs_period", "整月确认被不足月新期间取代后，是否单独重新确认了新期间的完整应付；不是单纯出现月薪数字。")
            continue
        if g == 10:
            full_month = span("2025-12-01", "2025-12-31")
            for v in ("a", "b"):
                c = make_case(10, v, "monthly_vs_period",
                              "我在社区洗衣点值守，这次结算恰好是一整个月。月基本工资之外还有夜间值守工资，以及缺班的工资调整。",
                              "资料里月基本工资6429.83元，夜间工资691.42元、缺班调整413.27元都列了，但整月完整应付还没有确认。" if v == "a" else
                              "这些项目后来统一核准，我已单独确认本月完整应付6707.98元；本月完整已付2957.60元也核过了。")
                c.event("period", full_month)
                c.event("agreed_due_total", "6429.83", "candidate", "monthly_rate", False,
                        text=f"{cn_period(full_month)} 的工资明细列出每月基本工资 6429.83 元、夜间值守工资 691.42 元、缺班工资调整 413.27 元；月基本工资不是这些项目结算后的完整应付总额，完整总额尚未经受控确认。")
                c.event("wage_paid_total", "2957.60")
                if v == "b": c.event("agreed_due_total", "6707.98")
                c.finish(call=(full_month, "6707.98", "2957.60") if v == "b" else None,
                         missing=[] if v == "b" else ["agreed_due_total"],
                         rationale="另行受控确认了涵盖变动工资项目的完整整月应付；模型不自行汇总授权。" if v == "b" else
                         "即使期间恰好一个整月，月基本工资也不等于含变动项目的完整应付；分项齐全不构成总额确认。")
            pair_note(10, "monthly_vs_period", "恰好整月仍含变动工资项目，是否在月费率及分项之外新增完整应付总额确认。")
            continue
        for v in ("a", "b"):
            ok = v == call_variant
            field = "wage_paid_total" if g == 9 else "agreed_due_total"
            ctx = f"我做{work}，这次按登记的整段期间整理工资，期间已经确认。"
            final = ("这回填的是整段工资的完整总额，我在核对页确认过，不是按月费率。" if ok
                     else "表里那项只是按月写的数字，跨月和不满月究竟合多少，我还没确认。")
            c = make_case(g, v, "monthly_vs_period", ctx, final)
            c.event("period", p)
            if field == "agreed_due_total":
                c.event(field, due, "confirmed" if ok else "candidate",
                        meaning="period_wage_total" if ok else "monthly_rate", complete=ok)
                c.event("wage_paid_total", paid)
            else:
                c.event("agreed_due_total", due)
                c.event(field, paid, "confirmed" if ok else "candidate",
                        meaning="period_wage_total" if ok else "monthly_rate", complete=ok,
                        text=None if ok else f"工资发放表按每月 {money(paid)} 元登记，未确认 {cn_period(p)} 的完整已付工资总额。")
            c.finish(call=(p, due, paid) if ok else None, missing=[] if ok else [field],
                     rationale="三项事实均为本期完整确认，可以执行。" if ok else "月度费率不是该跨期区间的完整总额，不能自行乘月数或折算。")
        pair_note(g, "monthly_vs_period", f"{field} 中同一可见金额是月度费率，或经受控渠道确认为本期完整总额。")

    # 11-16: attribution, components, and completeness.
    p = span("2026-02-05", "2026-02-27"); ctx = "我在小型印刷作坊做装订，老板的一笔转款里混着工资和我垫的纸张款。"
    for v in ("a", "b"):
        c = make_case(11, v, "mixed_payment", ctx,
                      "到账6843.26元里的非工资部分已经核对，受控记录确认本期完整已付工资是6179.82元。" if v == "a" else "到账一共6843.26元，我还没拆出纸张垫款是多少。")
        c.event("period", p); c.event("agreed_due_total", "7594.47")
        c.event("wage_paid_total", "6843.26", "candidate", "mixed_payment", False,
                text=f"转款资料：{cn_period(p)} 相关到账为 6843.26 元，包含本期工资及纸张垫付款，工资占比未确认。")
        if v == "a": c.event("wage_paid_total", "6179.82")
        c.finish(call=(p, "7594.47", "6179.82") if v == "a" else None, missing=[] if v == "a" else ["wage_paid_total"],
                 rationale="拆分之后有独立的本期完整工资已付总额确认。" if v == "a" else "混合到账不可直接当作工资已付总额。")
    pair_note(11, "mixed_payment", "混合转账后是否增加独立的本期工资总额确认。")

    p = span("2026-03-02", "2026-03-25"); ctx = "我给一处家庭旅馆洗床品，收到的合并款可能还带着上一段结算。"
    for v in ("a", "b"):
        c = make_case(12, v, "cross_period_payment", ctx,
                      "5841.93元这笔钱到底有多少属于本期，我还在查。" if v == "a" else "合并款分属两期已经核清，本期完整已付工资确认是4098.77元。")
        c.event("period", p); c.event("agreed_due_total", "6972.61")
        c.event("wage_paid_total", "5841.93", "candidate", "unattributed_payment", True,
                text=f"合并转款记为 5841.93 元，可能同时用于 {cn_period(p)} 与前一期工资，本期归属金额未确认。")
        if v == "b": c.event("wage_paid_total", "4098.77")
        c.finish(call=(p, "6972.61", "4098.77") if v == "b" else None, missing=[] if v == "b" else ["wage_paid_total"],
                 rationale="跨期分配完成后另有本期完整已付确认。" if v == "b" else "合并付款归属尚未确认，不能全额扣入本期。")
    pair_note(12, "cross_period_payment", "跨期合并转款是否已得到当前期间的独立工资总额确认。")

    p = span("2026-04-06", "2026-04-28"); ctx = "商场临时陈列结束了，转账资料里既有工资，也有出差垫款，完整应付确认是8127.49元。"
    for v in ("a", "b"):
        c = make_case(13, v, "mixed_completeness", ctx, "转款截图已经齐了，但工资和垫款还没分开。" if v == "a" else "目前只找回一部分截图，工资和垫款也还没分开。")
        c.event("period", p); c.event("agreed_due_total", "8127.49")
        c.event("wage_paid_total", "6435.08", "candidate", "mixed_payment", v == "a")
        c.finish(missing=["wage_paid_total"], rationale="即使混合转账资料齐全，也仍缺本期工资成分及完整工资总额的受控确认。" if v == "a" else "混合款的成分和记录完整性均未解决。")
    pair_note(13, "mixed_completeness", "混合款记录是否完整；两者仍缺工资成分与受控总额确认。")

    p = span("2026-05-03", "2026-05-22"); ctx = "我替影棚做布景拆装，完整应付为9068.73元，已经确认。已付资料是两张现金签收条。"
    for v in ("a", "b"):
        c = make_case(14, v, "split_total_confirmation", ctx, "两张分别是1286.17元和2389.26元，登记合计3675.43元；我确认截图已经全了，但还没在核对页确认总额。" if v == "a" else "两张分别是1286.17元和2389.26元，登记合计3675.43元；可能还有另一张没找到。")
        c.event("period", p); c.event("agreed_due_total", "9068.73")
        c.event("wage_paid_total", "3675.43", "candidate", complete=v == "a",
                text=f"{cn_period(p)} 的签收条列出 1286.17 元、2389.26 元，登记合计 3675.43 元；" + ("登记称资料齐全，但该完整总额尚未经受控确认。" if v == "a" else "资料可能缺页，该完整总额尚未经受控确认。"))
        c.finish(missing=["wage_paid_total"], rationale="已知分笔和候选合计不能代替独立的可信完整总额确认。")
    pair_note(14, "split_total_confirmation", "相同分笔候选合计的资料完整性改变，均未新增可信总额确认。")

    old = span("2026-06-01", "2026-06-14"); p = span("2026-06-16", "2026-06-29"); ctx = "我在水族店连续做过两段替岗，眼下整理后面一段，不能把前一段款项直接挪过来。"
    for v in ("a", "b"):
        c = make_case(15, v, "cross_period_scope", ctx, "那个2748.39元只确认过前一段的归属，当前段还没重新核实。" if v == "a" else "当前段的资料也写了2748.39元，但这一次归属还只是待核候选。")
        c.event("period", old); c.event("wage_paid_total", "2748.39")
        c.event("period", p); c.event("agreed_due_total", "4319.84")
        if v == "b": c.event("wage_paid_total", "2748.39", "candidate", "unattributed_payment", False)
        c.finish(missing=["wage_paid_total"], rationale="旧期间确认已过期。" if v == "a" else "当前期间出现新的未归属候选，仍未确认本期完整已付总额。")
    pair_note(15, "cross_period_scope", "只有旧期间已付确认，与新增当前期间未归属候选对照。")

    p = span("2026-07-04", "2026-07-26"); ctx = "二手家具仓的那段用工已经确认期间，已付工资也确认是3978.42元，应付说明却写得比较混乱。"
    for v in ("a", "b"):
        c = make_case(16, v, "due_semantics", ctx, "应付表上的7274.15元还混着材料费，工资部分没有单列确认。" if v == "a" else "应付表上的7274.15元可能属于另一段维修活，归属没确认。")
        c.event("period", p)
        c.event("agreed_due_total", "7274.15", "candidate", "mixed_payment" if v == "a" else "unattributed_payment", False)
        c.event("wage_paid_total", "3978.42")
        c.finish(missing=["agreed_due_total"], rationale="应付候选存在非工资成分。" if v == "a" else "应付候选尚未归属于当前期间。")
    pair_note(16, "due_semantics", "应付候选的不确定性来自混合成分，或来自期间归属。")

    # 17-21: explicit unresolved conflicts and their resolution.
    p = span("2024-08-06", "2024-08-24"); ctx = "我在旧书整理点做分拣，两份应付汇总写得不一样；期间和已付1642.73元没有争议。"
    for v in ("a", "b"):
        c = make_case(17, v, "due_conflict", ctx, "5741.28元和5893.64元两份记录还在争论，暂时没有统一。" if v == "a" else "后续在受控核对页解决了这个差异，确认完整应付是5893.64元。")
        c.event("period", p); c.event("agreed_due_total", ["5741.28", "5893.64"], "conflict"); c.event("wage_paid_total", "1642.73")
        if v == "b": c.event("agreed_due_total", "5893.64")
        c.finish(call=(p, "5893.64", "1642.73") if v == "b" else None, conflicts=[] if v == "b" else ["agreed_due_total"],
                 rationale="新的受控确认明确解除前一应付冲突。" if v == "b" else "应付有两个相互冲突的完整总额，不可任选一个。")
    pair_note(17, "due_conflict", "追加可信确认，明确解除应付总额冲突。")

    p = span("2024-09-09", "2024-09-27"); ctx = "我做过短期窗帘安装，完整应付7286.39元核过了；现金签收和银行卡统计对已付说法不同。"
    for v in ("a", "b"):
        c = make_case(18, v, "paid_conflict", ctx, "签收补记已经完成，我在受控页面重新确认完整已付4827.16元。" if v == "a" else "一份统计是4659.32元，另一份是4827.16元，还没核定。")
        c.event("period", p); c.event("agreed_due_total", "7286.39"); c.event("wage_paid_total", ["4659.32", "4827.16"], "conflict")
        if v == "a": c.event("wage_paid_total", "4827.16")
        c.finish(call=(p, "7286.39", "4827.16") if v == "a" else None, conflicts=[] if v == "a" else ["wage_paid_total"],
                 rationale="后续受控确认已明确取代已付冲突。" if v == "a" else "已付冲突未解除，不能凭记录先后自行选择。")
    pair_note(18, "paid_conflict", "同一已付冲突是否被后续受控确认明确解决。")

    old = span("2024-10-04", "2024-10-19"); pa = span("2024-10-03", "2024-10-19"); pb = span("2024-10-04", "2024-10-21")
    ctx = "我在古镇咖啡铺帮忙，最初那段期间和工资总额确认过，后来双方发现交接日记法不一致。"
    for v in ("a", "b"):
        c = make_case(19, v, "period_conflict_scope", ctx, "现在出现两个起止范围，暂时没确定哪个才适用。" if v == "a" else "起止范围后来重新确认了，但两项金额还只是旧期间那次确认。")
        c.all(old, "5136.92", "2387.54"); c.event("period", [pa, pb], "conflict")
        if v == "b": c.event("period", pb)
        c.finish(missing=["agreed_due_total", "wage_paid_total"], conflicts=["period"] if v == "a" else [],
                 rationale="当前期间冲突且旧金额scope已过期，须核实期间与两项总额。" if v == "a" else "期间冲突已解决，但不得把旧期间两项总额绑定到新期间。")
    pair_note(19, "period_conflict_scope", "只解除期间冲突，金额未重新确认，因此旧总额仍过期。")

    p = span("2024-11-07", "2024-11-28"); ctx = "我给小型画廊做开幕布置，期间明确，应付出现两种结算口径。"
    for v in ("a", "b"):
        c = make_case(20, v, "conflict_and_unknown", ctx, "两份应付是6481.77元和6738.24元，已付我也还没核清。" if v == "a" else "两份应付仍没统一；不过已付总额3142.96元已在受控页面确认。")
        c.event("period", p); c.event("agreed_due_total", ["6481.77", "6738.24"], "conflict")
        c.event("wage_paid_total", None if v == "a" else "3142.96", "unknown" if v == "a" else "confirmed")
        c.finish(missing=["wage_paid_total"] if v == "a" else [], conflicts=["agreed_due_total"],
                 rationale="应付冲突与已付未知必须分别覆盖。" if v == "a" else "已付已确认，无须重复索取；剩余应付冲突须核实。")
    pair_note(20, "conflict_and_unknown", "应付冲突保持不变，仅已付从未知变为已确认。")

    p = span("2024-12-02", "2024-12-23"); ctx = "我帮一处运动器材门店做年末包装，期间确认了，已付两份统计互相对不上。"
    for v in ("a", "b"):
        c = make_case(21, v, "multiple_conflicts", ctx, "应付暂记7938.41元尚未确认，已付则有2468.12元和2731.67元两种说法。" if v == "a" else "后来应付又找到8126.59元的另一份记录，也没解决；已付两种说法仍在。")
        c.event("period", p)
        c.event("agreed_due_total", "7938.41" if v == "a" else ["7938.41", "8126.59"], "candidate" if v == "a" else "conflict")
        c.event("wage_paid_total", ["2468.12", "2731.67"], "conflict")
        c.finish(missing=["agreed_due_total"] if v == "a" else [],
                 conflicts=["wage_paid_total"] if v == "a" else ["agreed_due_total", "wage_paid_total"],
                 rationale="应付候选属于missing，已付冲突属于conflicts，两者都要追问。" if v == "a" else "两项完整总额都存在未解决冲突，不能只追问其中之一。")
    pair_note(21, "multiple_conflicts", "应付从单个未确认候选变为显式冲突，已付冲突保持不变。")

    # 22-25: append-only withdrawal/correction and period invalidation.
    p = span("2026-01-05", "2026-01-23"); ctx = "我在展览货运点做装卸，原来确认的应付是4871.63元，已付为2614.92元。"
    for v in ("a", "b"):
        c = make_case(22, v, "withdraw_and_reconfirm", ctx, "原应付里漏了一项，我撤回原确认，新总额暂时不知道。" if v == "a" else "原应付确认先撤回，后来核清了，新的完整应付5039.28元已重新确认。")
        c.all(p, "4871.63", "2614.92")
        c.event("agreed_due_total", None, "unknown", source_kind="confirmation",
                text=f"受控撤回记录：撤回 {cn_period(p)} 完整应付工资总额的上一条确认，新的完整应付总额未知。")
        if v == "b": c.event("agreed_due_total", "5039.28")
        c.finish(call=(p, "5039.28", "2614.92") if v == "b" else None, missing=[] if v == "b" else ["agreed_due_total"],
                 rationale="撤回之后已有新值的可信确认，按新确认计算。" if v == "b" else "撤回应付确认后未知，不能沿用旧值或替换为零。")
    pair_note(22, "withdraw_and_reconfirm", "撤回旧应付确认之后，是否重新确认了修正后的完整总额。")

    p = span("2026-02-01", "2026-02-18"); ctx = "我在社区餐饮备餐间做过一段，完整应付7649.52元，已付最初确认3418.76元。"
    for v in ("a", "b"):
        c = make_case(23, v, "corrected_candidate", ctx, "补录后完整已付应是3576.89元，我已经重新确认。" if v == "a" else "补录稿写3576.89元，但我还没确认这次修改。")
        c.all(p, "7649.52", "3418.76")
        c.event("wage_paid_total", "3576.89", "confirmed" if v == "a" else "candidate",
                text=None if v == "a" else f"修正稿：{cn_period(p)} 的完整已付工资总额候选为 3576.89 元，明确取代上一条记录；修改内容尚未受控确认。")
        c.finish(call=(p, "7649.52", "3576.89") if v == "a" else None, missing=[] if v == "a" else ["wage_paid_total"],
                 rationale="修正值已确认并明确取代旧确认。" if v == "a" else "新候选取代旧已付确认后，不能回退使用旧已确认数额。")
    pair_note(23, "corrected_candidate", "取代旧已付确认的修正金额，是否完成受控确认。")

    old = span("2026-03-04", "2026-03-19"); p = span("2026-03-04", "2026-03-22"); ctx = "我在乐器维修工作室做整理，结算期间后来延了三天。原先总额只对应旧结束日期。"
    for v in ("a", "b"):
        c = make_case(24, v, "period_change_partial_reconfirm", ctx, "新结束日期确认了，两项金额尚未按新期间核过。" if v == "a" else "新期间的完整应付6871.46元重新确认了，已付还只有旧期间的数。")
        c.all(old, "6239.18", "4102.57"); c.event("period", p)
        if v == "b": c.event("agreed_due_total", "6871.46")
        c.finish(missing=["agreed_due_total", "wage_paid_total"] if v == "a" else ["wage_paid_total"],
                 rationale="期间事件改变使旧两项金额均stale。" if v == "a" else "应付已重新绑定当前期间；只有旧已付仍stale。")
    pair_note(24, "period_change_partial_reconfirm", "期间延长后，只重新确认应付，或两项金额均未重新确认。")

    old = span("2026-04-02", "2026-04-17"); p = span("2026-04-01", "2026-04-18"); ctx = "我在文创市集做帐篷管理，原期间的确认发现可能把进撤场日漏掉了。"
    for v in ("a", "b"):
        c = make_case(25, v, "period_withdraw_candidate", ctx, "原期间确认已撤回，我暂时还不知道正确范围。" if v == "a" else "原期间确认撤回后，找到一个新的起止范围，但它还只是待核草稿。")
        c.all(old, "5386.71", "2198.63")
        c.event("period", None, "unknown", source_kind="confirmation", text="受控撤回记录：撤回上一条工资期间确认；本段正确的开始日期和结束日期当前未知。")
        if v == "b": c.event("period", p, "candidate")
        c.finish(missing=list(FIELDS), rationale="期间撤回或仍为候选，且旧两项金额绑定旧事件，均须重新核实。")
    pair_note(25, "period_withdraw_candidate", "撤回期间后保持未知，或补充一个尚未确认的新期间候选；旧金额均失效。")

    # 26-29: all-confirmed exact decimal pairs, including separately confirmed split totals.
    p = span("2024-02-07", "2024-02-25"); ctx = "我在地毯清洗点做短工，金额都精确到分，没有整元取整的约定。"
    for v in ("a", "b"):
        due = "6927.31" if v == "a" else "6927.32"
        c = make_case(26, v, "decimal_due_revision", ctx, "完整应付确认6927.31元，完整已付4289.17元。" if v == "a" else "复核补了一分钱，应付新的完整总额6927.32元已确认，已付仍4289.17元。")
        c.all(p, "6927.31", "4289.17")
        if v == "b": c.event("agreed_due_total", due)
        c.finish(call=(p, due, "4289.17"), rationale="精确到分的当前完整总额均确认；应使用当前值保留一分钱差异。")
    pair_note(26, "decimal_due_revision", "应付总额通过新确认增加一分钱。")

    p = span("2024-03-08", "2024-03-29"); ctx = "我在陶艺工坊做窑房辅助，款是分两次到的；分笔资料之外，整段完整总额也另外确认过。"
    for v in ("a", "b"):
        paid = "4368.59" if v == "a" else "4368.60"
        second = "2640.13" if v == "a" else "2640.14"
        c = make_case(27, v, "decimal_split_confirmed_total", ctx, f"第一笔1728.46元，第二笔{second}元；核对页单独确认本期完整已付是{paid}元，完整应付7851.26元。")
        c.event("period", p); c.event("agreed_due_total", "7851.26")
        c.event("wage_paid_total", paid, "candidate", complete=True,
                text=f"分笔资料：{cn_period(p)} 的两笔为 1728.46 元和 {second} 元；登记合计 {paid} 元。")
        c.event("wage_paid_total", paid)
        c.finish(call=(p, "7851.26", paid), rationale="不是让模型分笔求和授权；存在独立受控确认的完整已付总额，分位差异必须保留。")
    pair_note(27, "decimal_split_confirmed_total", "第二笔及另行确认的完整已付总额均增加一分钱。")

    p = span("2024-04-05", "2024-04-26"); ctx = "我在户外用品档口做缝补，整段应付确认是11599.09元，这次付款也逐项核对完成了。"
    for v in ("a", "b"):
        paid = "11598.99" if v == "a" else "11599.19"
        c = make_case(28, v, "decimal_sign_boundary", ctx, f"本期完整已付确认{paid}元，收款记录精确到分。")
        c.all(p, "11599.09", paid).finish(call=(p, "11599.09", paid), rationale="完整事实确认，精确差额跨过零不改变执行资格，不得裁零。")
    pair_note(28, "decimal_sign_boundary", "已付跨越应付边界，使精确差额从正一角变为负一角。")

    p = span("2024-05-06", "2024-06-23"); ctx = "我为一批舞台器材做长期维护，结算跨月但已确认整段总额，不再按月折算。"
    for v in ("a", "b"):
        paid = "62180.13" if v == "a" else "62180.23"
        c = make_case(29, v, "decimal_larger_total", ctx, f"完整应付82764.29元已确认；本期完整已付这次核为{paid}元。")
        c.all(p, "82764.29", paid).finish(call=(p, "82764.29", paid), rationale="跨月的完整总额已确认，较大金额与分位均应原样进入计算参数。")
    pair_note(29, "decimal_larger_total", "相同跨月完整应付下，完整已付相差一角。")

    # 30-32: negative/equal/uncertain-sign contexts; sign never substitutes for confirmation.
    p = span("2024-06-03", "2024-06-21"); ctx = "我在香料分装小店做过一段，完整应付确认是4628.57元，已付也按所有渠道核清了。"
    for v in ("a", "b"):
        paid = "4819.23" if v == "a" else "4628.57"
        c = make_case(30, v, "negative_vs_equal", ctx, f"本期完整已付确认{paid}元；我想把这段账的算术关系列清楚。")
        c.all(p, "4628.57", paid).finish(call=(p, "4628.57", paid), rationale="due<paid为合法输入，保留负差额，不推出返还义务。" if v == "a" else "应付与已付相等，零差额也可合法计算。")
    pair_note(30, "negative_vs_equal", "完整已付高于应付，或恰好等于应付；均有完整确认。")

    p = span("2024-07-05", "2024-07-24"); ctx = "我给花艺工作室做运输，完整已付已经确认是9732.48元，应付记录还没统一。"
    for v in ("a", "b"):
        c = make_case(31, v, "negative_unresolved_due", ctx, "应付两份写了8216.39元和8547.12元，目前都没排除。" if v == "a" else "应付这边目前还没有完整总额确认，我也不知道确数。")
        c.event("period", p)
        c.event("agreed_due_total", ["8216.39", "8547.12"] if v == "a" else None, "conflict" if v == "a" else "unknown")
        c.event("wage_paid_total", "9732.48")
        c.finish(missing=[] if v == "a" else ["agreed_due_total"], conflicts=["agreed_due_total"] if v == "a" else [],
                 rationale="两个应付候选虽都小于已付，仍不得任选或凭负号判断直接执行。" if v == "a" else "应付未知不能由较高已付倒推，更不能当零。")
    pair_note(31, "negative_unresolved_due", "应付未决类型由两个都低于已付的冲突值变为未知。")

    old = span("2024-01-02", "2024-01-13"); p = span("2024-01-15", "2024-01-27"); ctx = "我在礼品包装点前后做了两段，当前段完整应付确认是3459.18元。"
    for v in ("a", "b"):
        c = make_case(32, v, "negative_scope_not_confirmed", ctx, "3891.74元只在前一段确认过，本段没有重新确认。" if v == "a" else "本段也找到3891.74元的候选记录，但还没确认它是不是完整工资已付。")
        c.event("period", old); c.event("wage_paid_total", "3891.74"); c.event("period", p); c.event("agreed_due_total", "3459.18")
        if v == "b": c.event("wage_paid_total", "3891.74", "candidate", complete=False)
        c.finish(missing=["wage_paid_total"], rationale="旧期间金额过期，即使数字比当前应付高也不能执行。" if v == "a" else "当前期间候选未确认，不能因潜在负差额而跳过核实。")
    pair_note(32, "negative_scope_not_confirmed", "高于本期应付的已付数字来自旧期间确认，或当前期间未确认候选。")

    # 33-36: exact exhausted controller state, priority over any fact status.
    p = span("2025-08-02", "2025-08-20"); ctx = "我在修鞋摊帮忙那段的工资记录都核清过了，刚才工具已经连续两次没有返回。"
    for v in ("a", "b"):
        due = "5897.42" if v == "a" else "5897.43"
        c = make_case(33, v, "terminal_confirmed_revision", ctx, "完整应付和已付仍用刚才确认的数。" if v == "a" else "应付补了一分钱，新的完整数额已经重新确认。")
        c.all(p, "5897.42", "3128.69")
        if v == "b": c.event("agreed_due_total", due)
        c.finish(terminal=True, rationale="工具已耗尽2/2；事实全确认或事后小额修正均不能自行重置尝试次数。")
    pair_note(33, "terminal_confirmed_revision", "耗尽后完整应付是否追加一分钱修正确认；工具状态不重置。")

    p = span("2025-09-04", "2025-09-25"); ctx = "我在灯具仓做配货，系统已经两次超时，期间和完整应付6729.38元确认过。"
    for v in ("a", "b"):
        c = make_case(34, v, "terminal_unknown_confirmed", ctx, "完整已付现在仍然未知。" if v == "a" else "刚又核清已付，总额2847.61元已确认。")
        c.event("period", p); c.event("agreed_due_total", "6729.38"); c.event("wage_paid_total", None if v == "a" else "2847.61", "unknown" if v == "a" else "confirmed")
        c.finish(terminal=True, rationale="工具耗尽优先于事实缺失追问或补齐；该固定状态下应报告工具失败。")
    pair_note(34, "terminal_unknown_confirmed", "已付从未知补齐为确认，工具仍维持耗尽终态。")

    p = span("2025-10-06", "2025-10-28"); ctx = "我在小剧场做灯光搬运，工具已经两次超时；期间与完整已付4176.52元确认过。"
    for v in ("a", "b"):
        c = make_case(35, v, "terminal_conflict_resolution", ctx, "应付7548.39元和7692.84元的冲突还在。" if v == "a" else "后续已经解决应付冲突，完整总额7692.84元重新确认。")
        c.event("period", p); c.event("agreed_due_total", ["7548.39", "7692.84"], "conflict"); c.event("wage_paid_total", "4176.52")
        if v == "b": c.event("agreed_due_total", "7692.84")
        c.finish(terminal=True, rationale="已有2/2工具失败，冲突解除与否不改变优先报告工具失败的终态。")
    pair_note(35, "terminal_conflict_resolution", "耗尽终态下应付冲突解除或未解除。")

    old = span("2025-11-03", "2025-11-19"); p = span("2025-11-03", "2025-11-22"); ctx = "我在手工皮具作坊做包装，刚才工具已连续超时两次。后来期间又延长了三天。"
    for v in ("a", "b"):
        c = make_case(36, v, "terminal_period_reconfirmation", ctx, "新期间已经确认，但应付和已付还只有旧期间确认。" if v == "a" else "新期间的完整应付8397.26元和完整已付5631.94元，也都重新确认了。")
        c.all(old, "7814.53", "5218.07"); c.event("period", p)
        if v == "b": c.event("agreed_due_total", "8397.26"); c.event("wage_paid_total", "5631.94")
        c.finish(terminal=True, rationale="工具耗尽优先；期间变动导致的stale或重新确认不能重置2/2状态。")
    pair_note(36, "terminal_period_reconfirmation", "新期间下两项金额全部过期，或全部重新确认；工具终态均保持。")


def dump_jsonl(path, rows):
    path.write_text("".join(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n" for row in rows), encoding="utf-8")


def main():
    build()
    assert len(INPUTS) == len(LABELS) == len(PROVENANCE) == 72
    order = list(range(72)); random.Random(2026101703).shuffle(order)
    for filename, rows in (("test.inputs.jsonl", INPUTS), ("test.labels.jsonl", LABELS), ("test.provenance.jsonl", PROVENANCE)):
        dump_jsonl(ROOT / filename, [rows[i] for i in order])
    dump_jsonl(ROOT / "pair_index.jsonl", PAIR_INDEX)
    stats = {"rows": len(INPUTS), "groups": len(PAIR_INDEX),
             "actions": dict(Counter(r["expected"]["next_action"]["type"] for r in LABELS)),
             "tool_states": dict(Counter("none" if r["tool_state"] is None else f"timeout_{r['tool_state']['attempts']}_of_2" for r in INPUTS)),
             "categories": dict(Counter(r["category"] for r in LABELS))}
    (ROOT / "author_stats.json").write_text(json.dumps(stats, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: stats[k] for k in ("rows", "groups", "actions", "tool_states")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
