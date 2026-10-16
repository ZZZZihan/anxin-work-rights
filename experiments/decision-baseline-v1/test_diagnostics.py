import copy
import json
import unittest
from diagnostics import diagnose
from test_evaluation import output


class DiagnosticTests(unittest.TestCase):
    def test_omitted_empty_field_does_not_invent_arguments(self):
        gold = output()
        value = copy.deepcopy(gold)
        del value["next_action"]["questions"]
        self.assertTrue(diagnose({"id": "x", "expected": gold},
            {"raw_output": json.dumps(value)})["next_action_diagnostic_correct"])
        value["next_action"]["arguments"]["due"] = 10000
        self.assertFalse(diagnose({"id": "x", "expected": gold},
            {"raw_output": json.dumps(value)})["next_action_diagnostic_correct"])

    def test_malformed_question_field_cannot_crash(self):
        value = output()
        value["next_action"].update(type="ask_user", questions=[{"field": [], "text": "?"}])
        self.assertFalse(diagnose({"id": "x", "expected": output()},
            {"raw_output": json.dumps(value)})["next_action_diagnostic_correct"])

    def test_no_inference_when_output_unreadable(self):
        self.assertFalse(diagnose({"id": "x", "expected": output()},
            {"raw_output": "我认为应当计算"})["next_action_diagnostic_correct"])


if __name__ == "__main__":
    unittest.main()
