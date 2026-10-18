"""Behavior tests authored before accessing development examples."""

import unittest
from rules import predict


def record(*messages, tool_state=None):
    return {"id": "irrelevant", "messages": [{"role": "user", "content": text} for text in messages], "tool_state": tool_state}


BASE = "核算2026年2月3日到2026年2月19日，整个期间约定应付工资6200元。"


class RuleBehaviorTests(unittest.TestCase):
    def test_complete_decimal(self):
        answer = predict(record(BASE + "这段工资实收2123.45元。"))
        self.assertEqual(answer["next_action"]["type"], "call_tool")
        self.assertEqual(answer["next_action"]["arguments"]["paid"], 2123.45)

    def test_monthly_standard_not_period_total(self):
        answer = predict(record("核算2026年3月1日到2026年3月31日，每月工资6200元。这段工资实收2000元。"))
        self.assertEqual(answer["missing"], ["agreed_due_total"])

    def test_known_transfer_unknown_wage_role(self):
        answer = predict(record(BASE + "到账1800元，不知道是不是这个期间的工资。"))
        self.assertEqual(answer["missing"], ["wage_paid_total"])

    def test_zero_is_known(self):
        answer = predict(record(BASE + "这段工资一分钱也没收到。"))
        self.assertEqual(answer["next_action"]["arguments"]["paid"], 0)

    def test_reimbursement_excluded(self):
        answer = predict(record(BASE + "这段收到工资2400元，另收到差旅报销800元。"))
        self.assertEqual(answer["next_action"]["arguments"]["paid"], 2400)

    def test_only_reimbursement_is_not_zero_wage(self):
        answer = predict(record(BASE + "收到差旅报销800元。"))
        self.assertEqual(answer["missing"], ["wage_paid_total"])

    def test_multiturn_adds_known_facts(self):
        answer = predict(record("核算2026年2月3日到2月19日。", "整个期间约定应付工资6200元。", "这段工资实收2000元。"))
        self.assertEqual(answer["next_action"]["type"], "call_tool")

    def test_explicit_correction_replaces_due(self):
        answer = predict(record(BASE + "这段工资实收2000元。", "更正，刚才约定工资总额说错，整个期间应付工资是6800元。"))
        self.assertEqual(answer["next_action"]["arguments"]["due"], 6800)

    def test_unresolved_due_conflict(self):
        answer = predict(record(BASE + "这段工资实收2000元。", "老板说这段约定应付工资6700元，但双方没解决分歧。"))
        self.assertEqual(answer["conflicts"], ["agreed_due_total"])
        self.assertNotIn("agreed_due_total", answer["missing"])

    def test_uncertain_amount_is_missing(self):
        answer = predict(record("核算2026年2月3日到2月19日。约定工资总额可能6200元。这段工资实收2000元。"))
        self.assertEqual(answer["missing"], ["agreed_due_total"])

    def test_all_wage_parts_sum(self):
        answer = predict(record(BASE + "工资分两笔支付，先收到工资1100元，后又收到工资900元，全部就是这两笔。"))
        self.assertEqual(answer["next_action"]["arguments"]["paid"], 2000)

    def test_incomplete_payment_list_not_total(self):
        answer = predict(record(BASE + "目前只找到收到工资1100元，是否还有其他工资付款还没核对。"))
        self.assertEqual(answer["missing"], ["wage_paid_total"])

    def test_negative_gap_is_allowed(self):
        answer = predict(record(BASE + "这段工资实收7000元。"))
        self.assertEqual(answer["next_action"]["arguments"]["paid"], 7000)

    def test_assistant_facts_ignored(self):
        item = record("我要核算工资。")
        item["messages"].append({"role": "assistant", "content": BASE + "这段工资实收2000元。"})
        self.assertEqual(predict(item)["missing"], ["period", "agreed_due_total", "wage_paid_total"])

    def test_timeout_priority(self):
        answer = predict(record("信息都没给。", tool_state={"status": "TIMEOUT", "attempts": 2, "max_attempts": 2}))
        self.assertEqual(answer["next_action"], {"type": "report_tool_failure", "questions": [], "tool": None, "arguments": None})

    def test_id_and_extra_labels_do_not_change_result(self):
        item = record(BASE + "这段工资实收2000元。")
        before = predict(item)
        item.update({"id": "missing_period", "category": "missing_due", "labels": {"due": 1}, "family": "bad"})
        self.assertEqual(predict(item), before)

    def test_not_old_amount_but_new_amount(self):
        answer = predict(record(BASE + "这段工资实收2000元。", "更正一下，这段应付工资不是6200元，而是6600元。"))
        self.assertEqual(answer["next_action"]["arguments"]["due"], 6600)

    def test_wage_standard_not_confirmed_total(self):
        answer = predict(record("核算2026年2月3日到2月19日，合同工资标准6200元。这段工资实收2000元。"))
        self.assertEqual(answer["missing"], ["agreed_due_total"])

    def test_no_other_payment_is_not_zero(self):
        answer = predict(record(BASE + "工资实收2000元，除此没有发过任何工资。"))
        self.assertEqual(answer["next_action"]["arguments"]["paid"], 2000)

    def test_chinese_number(self):
        answer = predict(record("核算2026年2月3日到2月19日，整个期间约定应付工资一万二千元。这段工资实收三千五百元。"))
        self.assertEqual(answer["next_action"]["arguments"]["due"], 12000)
        self.assertEqual(answer["next_action"]["arguments"]["paid"], 3500)

    def test_period_conflict(self):
        answer = predict(record(BASE + "工资实收2000元。", "另一份核算单期间写2026年2月4日到2月20日，两份单子还没对齐。"))
        self.assertEqual(answer["conflicts"], ["period"])


if __name__ == "__main__":
    unittest.main()
