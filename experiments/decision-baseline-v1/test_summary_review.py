"""Guard against scoring an incomplete semantic review as success."""
import unittest

from summarize import validate_review


class ReviewCompletenessTests(unittest.TestCase):
    def test_expected_question_cannot_have_unreviewed_text(self):
        packet = {"transport_error": False, "output": {"next_action": {"type": "call_tool"}},
                  "expected": {"next_action": {"type": "ask_user"}}}
        with self.assertRaises(AssertionError):
            validate_review({"business_action_correct": True, "question_text_adequate": None}, packet)

    def test_unnecessary_actual_question_also_requires_text_review(self):
        packet = {"transport_error": False,
                  "output": {"next_action": {"questions": [{"field": "period", "text": "日期？"}]}},
                  "expected": {"next_action": {"type": "call_tool"}}}
        with self.assertRaises(AssertionError):
            validate_review({"business_action_correct": True, "question_text_adequate": None}, packet)

    def test_network_failure_can_have_no_text_judgment(self):
        validate_review({"business_action_correct": False, "question_text_adequate": None},
                        {"transport_error": True, "output": None, "raw_output": ""})

    def test_network_failure_cannot_be_scored_as_success(self):
        with self.assertRaises(AssertionError):
            validate_review({"business_action_correct": True, "question_text_adequate": None},
                            {"transport_error": True, "output": None, "raw_output": ""})


if __name__ == "__main__":
    unittest.main()
