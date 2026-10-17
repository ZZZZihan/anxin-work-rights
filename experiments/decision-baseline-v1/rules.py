"""Conservative, deterministic Chinese wage-intake baseline.

Only ``messages`` and ``tool_state`` are inspected.  This is deliberately a
small language-rule system, not a legal assessment or a trained classifier.
Public entry point: ``predict(record)``.  The optional CLI reads JSONL inputs.
"""

from __future__ import annotations

import argparse
import calendar
import datetime as dt
from decimal import Decimal, InvalidOperation
import json
import re
import sys
from dataclasses import dataclass, field
from typing import Any


FIELDS = ("period", "agreed_due_total", "wage_paid_total")
QUESTIONS = {
    "period": "请确认这次核算的起止日期，包含年份、月份和日期。",
    "agreed_due_total": "请确认这整个核算期间约定应付的工资总额；只有月薪标准还不够。",
    "wage_paid_total": "请确认属于这个期间的全部已付工资合计；请区分工资、报销和其他款项。",
}
CONFLICT_QUESTIONS = {
    "period": "目前核算期间有不一致的说法，请确认最终采用的起止日期。",
    "agreed_due_total": "目前该期间约定应付工资总额有不一致的说法，请确认最终金额。",
    "wage_paid_total": "目前该期间已付工资总额有不一致的说法，请核对全部工资付款并确认最终合计。",
}

CN_DIGITS = {"零": 0, "〇": 0, "一": 1, "二": 2, "两": 2, "三": 3,
             "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}
NUM = r"(?:[+-]?\d[\d,，]*(?:\.\d+)?(?:万|千)?|[零〇一二两三四五六七八九十百千万亿点]+)"
MONEY_RE = re.compile(r"(?P<num>" + NUM + r")\s*(?:元|块钱|块|人民币)(?![\d年月日])")
DATE_RE = re.compile(
    r"(?<!\d)(?:(?P<year>20\d{2}|19\d{2})\s*(?:年|[-/.]))?"
    r"(?P<month>1[0-2]|0?[1-9])\s*(?:月|[-/.])\s*"
    r"(?P<day>3[01]|[12]\d|0?[1-9])\s*(?:日|号)?(?!\d)"
)
WAGE = r"工资|薪资|薪酬|薪水|工钱|薪金|劳务费"
DUE_CUE = r"约定|应付|应发|该发|应该发|应得|该给|该拿|答应|承诺|谈好|说好|结算单|合同|核定"
PAID_CUE = r"收到|收过|收了|到账|已发|发了|已付|付了|支付|实付|实发|实收|全付|共付|打过|打了|打款|转过|转了|给过|给了|拿到|领到|已领|收款|付款|转账|汇款"
TOTAL_CUE = r"总额|总计|总共|共计|合计|一共|整个|整段|这段|期间|本期|上述|这笔|这些|全部|所有|只有|仅有|就这|只发|只付|实际"
MONTHLY = r"月薪|每月|每个月|一个月|月工资|月标准|按月|日薪|每天|时薪|小时|工资标准|基本工资标准|工资单价|底薪标准"
NON_WAGE = r"报销|差旅|餐费|住宿费|借款|借给|还款|押金|垫付|垫款|赔偿|补偿|奖金未定|过节红包|礼金"
UNCERTAIN = r"大概|大约|可能|好像|似乎|估计|估算|记不清|记不准|不确定|不清楚|不能确认|无法确认|未确认|没确认|尚未确认|不知道|不知道是不是|未核实|待核实|没核实|不记得|说不准"
CORRECTION = r"更正|纠正|改口|说错|写错|记错|打错|口误|以.{0,16}为准|改为|改成|应为|应当是|实际应是|最终确认|重新核对|核对后|撤回|作废|不算数|不是.{0,80}而是|刚才.{0,24}(?:不对|有误)"


def _decimal(raw: str) -> Decimal:
    raw = raw.replace(",", "").replace("，", "").strip()
    if re.fullmatch(r"[+-]?\d+(?:\.\d+)?[万千]?", raw):
        scale = Decimal(10000 if raw.endswith("万") else 1000 if raw.endswith("千") else 1)
        return Decimal(raw.rstrip("万千")) * scale
    integer, _, fraction = raw.partition("点")
    total = 0
    section = 0
    digit = 0
    for char in integer:
        if char in CN_DIGITS:
            digit = CN_DIGITS[char]
        elif char in {"十", "百", "千"}:
            section += (digit or 1) * {"十": 10, "百": 100, "千": 1000}[char]
            digit = 0
        elif char in {"万", "亿"}:
            section += digit
            total += section * {"万": 10000, "亿": 100000000}[char]
            section = digit = 0
        else:
            raise InvalidOperation
    result = Decimal(total + section + digit)
    if fraction:
        result += Decimal("0." + "".join(str(CN_DIGITS[c]) for c in fraction))
    return result


def _json_number(value: Decimal) -> int | float:
    return int(value) if value == value.to_integral_value() else float(value)


@dataclass
class Fact:
    values: list[Any] = field(default_factory=list)

    def add(self, values: list[Any], correction: bool = False) -> None:
        if correction:
            self.values.clear()
        for value in values:
            if value not in self.values:
                self.values.append(value)

    def clear(self) -> None:
        self.values.clear()


def _clauses(text: str) -> list[str]:
    return [part.strip() for part in re.split(r"[。！？!?；;\n]+", text) if part.strip()]


def _has(pattern: str, text: str) -> bool:
    return re.search(pattern, text) is not None


def _date_candidates(text: str) -> list[tuple[str, str]]:
    dates = []
    inherited_year = None
    for match in DATE_RE.finditer(text):
        year = int(match["year"]) if match["year"] else inherited_year
        if match["year"]:
            inherited_year = year
        if year is None:
            continue
        try:
            date = dt.date(year, int(match["month"]), int(match["day"]))
        except ValueError:
            continue
        dates.append((match.start(), match.end(), date))
    result = []
    for index in range(len(dates) - 1):
        first, second = dates[index], dates[index + 1]
        connector = text[first[1]:second[0]]
        joined_employment = _has(r"入职|上班|开工", connector) and _has(r"离职|下班|完工|结束", text[second[1]:second[1] + 10]) and _has(r"核算|计算|这段|期间", text)
        if len(connector) > 16 or not (_has(r"至|到|—|–|-|~|～|和|以及", connector) or joined_employment):
            continue
        nearby = text[max(0, first[0] - 18): min(len(text), second[1] + 18)]
        # A payment date, receipt timestamp, or example does not define intake scope.
        if _has(r"例如|比如|假设|打款日|转账日|付款日|到账日", nearby) and not _has(r"核算|计算|期间|范围|工资期|工作期", nearby):
            continue
        if first[2] <= second[2]:
            result.append((first[2].isoformat(), second[2].isoformat()))
    # Explicit full-month scope establishes dates, but establishes no wage total.
    if not result:
        full_month = re.search(r"(20\d{2}|19\d{2})年\s*(1[0-2]|0?[1-9])月(?:整月|全月|份整月)", text)
        if full_month:
            year, month = int(full_month[1]), int(full_month[2])
            result.append((dt.date(year, month, 1).isoformat(), dt.date(year, month, calendar.monthrange(year, month)[1]).isoformat()))
    return list(dict.fromkeys(result))


def _date_unknown(text: str) -> bool:
    return _has(r"(?:日期|起止|期间|哪天|时间|月份).{0,14}(?:不确定|没确定|未确定|记不清|不清楚|不知道)|(?:不确定|记不清|不清楚|不知道).{0,14}(?:日期|起止|哪天|期间|时间)|(?:起止|日期|期间).{0,8}(?:尚未|还没|没有)(?:核对|确认|定)", text)


def _negative_amount(before: str, after: str) -> bool:
    # A replacement introduced by "rather, it is ..." is affirmative even
    # though the immediately preceding amount was explicitly negated.
    before = re.split(r"而是|实际是|实际应是|现确认为", before)[-1]
    return _has(r"(?:不是|并非|不是指|并不是|别用|不采用|不按|不应按|不用|排除|撤回|说错的|误写的)[^，,；;。]{0,16}$", before) or _has(r"^[^，,；;。]{0,8}(?:说错了|写错了|作废|不算数|不对|有误)", after)


def _uncertain_amount(before: str, after: str) -> bool:
    return _has(r"(?:" + UNCERTAIN + r")[^，,；;。]{0,12}$", before) or _has(r"^.{0,10}(?:不确定|待核实|没核实|未确认|记不清|不能确认)", after)


def _money_items(text: str) -> list[dict[str, Any]]:
    result = []
    for match in MONEY_RE.finditer(text):
        try:
            value = _decimal(match["num"])
        except (InvalidOperation, KeyError):
            continue
        if value < 0:
            continue
        before = text[max(0, match.start() - 42):match.start()]
        after = text[match.end():min(len(text), match.end() + 32)]
        if _negative_amount(before, after):
            continue
        result.append({"start": match.start(), "end": match.end(), "value": value,
                       "before": before, "after": after, "uncertain": _uncertain_amount(before, after)})
    return result


def _local_context(text: str, item: dict[str, Any]) -> tuple[str, str, str]:
    left = max(text.rfind(separator, 0, item["start"]) for separator in ("，", ",", "、")) + 1
    endings = [pos for pos in (text.find(separator, item["end"]) for separator in ("，", ",", "、")) if pos >= 0]
    right = min(endings) if endings else len(text)
    return text[left:right], text[left:item["start"]], text[item["end"]:right]


def _due_values(text: str) -> list[Decimal]:
    result = []
    for item in _money_items(text):
        local, before, after = _local_context(text, item)
        if item["uncertain"]:
            continue
        if _has(NON_WAGE, local) and not _has(WAGE, local):
            continue
        due_local = _has(DUE_CUE, local)
        # Context before a comma may supply "this period's agreed wages".
        prefix = text[:item["start"]]
        due_context = _has(r"应发|应付|约定.{0,8}(?:工资|总额)", prefix)
        contextual_value = _has(r"总额|总计|合计|一共|共计|总共|整段|整个|本期|财务|主管|老板|公司|合同|表|写|说|报|更正|而是", local)
        if not due_local and not (due_context and contextual_value):
            continue
        if not _has(WAGE, local) and not _has(r"应发|应付", local) and not due_context:
            continue
        # Monthly/daily/hourly standards require a separately asserted period total.
        if _has(MONTHLY, local) and not _has(r"(?:期间|本期|整段|整个).{0,12}(?:总额|合计|一共|应付)|(?:总额|合计|一共).{0,8}(?:期间|本期|整段|整个)", local):
            continue
        if _has(PAID_CUE, local) and not _has(r"应付|应发|约定|该发|应得|应当|应该", before):
            continue
        # "Contract total 5000; employer says 5500" is a conflict, even without
        # repeating the word wages in the second source's clause.
        result.append(item["value"])
    return list(dict.fromkeys(result))


def _wage_zero(text: str) -> bool:
    # "Besides that payment, no other wages" confirms completeness, not zero.
    if _has(r"除此|此外|其他|其它|别的|另外|以外|之外", text):
        return False
    if _has(UNCERTAIN, text) and not _has(r"确认|确定|核对", text):
        return False
    return _has(r"(?:工资|工钱|薪资|薪水).{0,12}(?:一分(?:钱)?(?:也|都)?没(?:有)?(?:收到|发|付|给)|一分未(?:付|发)|(?:完全|全部|至今|一直|从未|根本)?(?:没有|没|未)(?:有)?(?:发过|付过|收到过|收到|发放|支付))|(?:没有|没|未)(?:有)?(?:收到|领到|拿到|发放|支付)(?:过)?(?:任何|一分(?:钱)?|一笔)?(?:工资|工钱|薪资|薪水)|一分(?:钱)?(?:也|都)?没(?:有)?收到", text)


def _payment_values(text: str) -> list[Decimal]:
    if _wage_zero(text):
        return [Decimal(0)]
    items = _money_items(text)
    candidates = []
    totals = []
    for item in items:
        local, before, after = _local_context(text, item)
        if item["uncertain"]:
            continue
        wage_local = _has(WAGE, local) or _has(r"实付|实收|已付|已发|全付|共付", local)
        nonwage_local = _has(NON_WAGE, local)
        if nonwage_local and not wage_local:
            continue
        if nonwage_local and wage_local:
            # Resolve the role using the closest following/before label.
            before_role = list(re.finditer(r"(?:" + WAGE + r")|(?:" + NON_WAGE + r")", before))
            after_role = re.search(r"^\s*(?:是|为|属于|算|的)?\s*((?:" + WAGE + r")|(?:" + NON_WAGE + r"))", after)
            if after_role:
                if _has(NON_WAGE, after_role[1]):
                    continue
                wage_local = True
            elif before_role and _has(NON_WAGE, before_role[-1][0]):
                continue
            elif not before_role:
                continue
        paid_local = _has(PAID_CUE, local)
        paid_context = (_has(PAID_CUE, text) and (_has(r"其中|余下|剩下|分成|分别|构成|这两笔|这几笔", text) or _has(r"工资|工钱", local))) or _has(r"全是.{0,8}(?:这段|本段|本期|期间).{0,4}(?:工资|工钱)|(?:只有|仅有).{0,20}(?:本段|这段|本期).{0,4}(?:工资|工钱)", local)
        if not wage_local or not (paid_local or paid_context):
            continue
        if _has(DUE_CUE, before) and not _has(PAID_CUE, before):
            continue
        if _has(r"应付|应发|约定|每月|月薪|原本|还差|还欠|尚欠|差额|差异|未付|未发", before[-12:]):
            continue
        # A transfer can be known while its wage role or period remains unknown.
        if _has(r"(?:不清楚|不知道|不确定|无法确认|不能确认|没确认|未核实|待核实).{0,18}(?:工资|哪|属于|对应|包含)|(?:工资|归属|哪期|对应).{0,18}(?:不清楚|不知道|不确定|无法确认|不能确认|没确认|未核实|待核实)", text):
            continue
        if _has(r"上(?:个)?月|去年|前期|以前|上一期|另一个期间|其他月份", local) and not _has(r"(?:本期|这段|该期间|这个期间).{0,8}(?:工资|已付|实收)|(?:工资|已付|实收).{0,8}(?:本期|这段|该期间|这个期间)", local):
            continue
        # A explicitly incomplete list cannot establish the complete payment sum.
        if _has(r"还有.{0,16}(?:没|未|不).{0,8}(?:查|核|确认|记清|确定)|只查到|暂时查到|目前只找到|另有.{0,12}(?:未核实|不确定|记不清)|是否还有|是不是还有|有没有其他|是不是全部|不确定.{0,8}(?:全部|还有)|不能确认.{0,8}(?:全部|还有)|(?:总实付|全部实付|实付总额|已付总额).{0,8}(?:不确定|没确认|不知道)", text):
            continue
        candidates.append(item["value"])
        if _has(r"合计|总计|总额|总共|共计|一共|实付工资|实收工资|已付工资|工资实收|工资实付|工资已付|全部实付|全部已付|全部工资|所有工资|完整.{0,12}已付", before):
            totals.append(item["value"])
    if totals:
        return list(dict.fromkeys(totals))
    # A natural narrative listing the wage payments is treated as exhaustive
    # unless it states uncertainty or incompleteness. Pure transfer sums are not.
    if candidates:
        if len(candidates) == 1:
            return candidates
        if _has(r"分别|分(?:两|三|几|2|3)笔|两笔|三笔|几笔|先.{0,25}后|又|加上|其余|剩下|余下|所有|全部|只有|就这", text):
            return [sum(candidates, Decimal(0))]
        return list(dict.fromkeys(candidates))
    return []


def _field_scope(text: str, name: str) -> bool:
    if name == "period":
        return bool(_date_candidates(text)) or _has(r"日期|起止|核算期间|计算期间|期间改|时间改", text)
    if name == "agreed_due_total":
        return _has(DUE_CUE, text) and _has(WAGE + r"|总额|总数|合计", text)
    return _has(PAID_CUE + r"|已付|实付|实收|付款|发款", text)


def predict(record: dict[str, Any]) -> dict[str, Any]:
    """Return one next action; record id and all unrecognized keys are ignored."""
    tool_state = record.get("tool_state")
    if isinstance(tool_state, dict) and tool_state.get("status") == "TIMEOUT":
        attempts = tool_state.get("attempts")
        maximum = tool_state.get("max_attempts")
        if isinstance(attempts, (int, float)) and isinstance(maximum, (int, float)) and attempts >= maximum:
            return {"missing": [], "conflicts": [], "next_action": {
                "type": "report_tool_failure", "questions": [], "tool": None, "arguments": None}}
    state = {name: Fact() for name in FIELDS}
    for message in record.get("messages", []):
        if not isinstance(message, dict) or message.get("role") != "user":
            continue
        text = message.get("content")
        if not isinstance(text, str):
            continue
        # A correction applies only to fields actually mentioned in that turn.
        corrected = {name: _has(CORRECTION, text) and _field_scope(text, name) for name in FIELDS}
        dates = _date_candidates(text)
        if _date_unknown(text) and not dates:
            state["period"].clear()
        if dates:
            state["period"].add(dates[-1:] if corrected["period"] else dates, corrected["period"])
        for name, parser in (("agreed_due_total", _due_values), ("wage_paid_total", _payment_values)):
            values = []
            for clause in _clauses(text):
                values.extend(parser(clause))
            values = list(dict.fromkeys(values))
            if values:
                state[name].add(values[-1:] if corrected[name] else values, corrected[name])
            elif corrected[name]:
                state[name].clear()
    missing = [name for name in FIELDS if not state[name].values]
    conflicts = [name for name in FIELDS if len(state[name].values) > 1]
    if missing or conflicts:
        questions = [{"field": name, "text": (CONFLICT_QUESTIONS if name in conflicts else QUESTIONS)[name]}
                     for name in FIELDS if name in missing or name in conflicts]
        return {"missing": missing, "conflicts": conflicts, "next_action": {
            "type": "ask_user", "questions": questions, "tool": None, "arguments": None}}
    period_start, period_end = state["period"].values[0]
    return {"missing": [], "conflicts": [], "next_action": {
        "type": "call_tool", "questions": [], "tool": "calculate_wage_gap", "arguments": {
            "period_start": period_start, "period_end": period_end,
            "due": _json_number(state["agreed_due_total"].values[0]),
            "paid": _json_number(state["wage_paid_total"].values[0])}}}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", nargs="?", help="JSONL input; stdin when omitted")
    args = parser.parse_args()
    source = open(args.input, encoding="utf-8") if args.input else sys.stdin
    try:
        for line in source:
            if line.strip():
                print(json.dumps(predict(json.loads(line)), ensure_ascii=False))
    finally:
        if args.input:
            source.close()


if __name__ == "__main__":
    main()
