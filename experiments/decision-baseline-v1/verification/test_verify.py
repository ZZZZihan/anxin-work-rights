"""Tamper/relocation regressions; mutations stay in disposable copies."""
from contextlib import redirect_stdout
import hashlib
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

import verify


def edit_json(path, change):
    value = json.loads(path.read_text())
    change(value)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def snapshot(root):
    return {path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in root.rglob("*") if path.is_file() and "__pycache__" not in path.parts}


class StoredEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="anxin-v1-verify-test-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name) / "decision-baseline-v1"
        shutil.copytree(verify.ROOT, self.root)

    def regenerate_historical_comparison(self):
        with redirect_stdout(io.StringIO()):
            verify.summarize.summarize(self.root)

    def test_real_frozen_evidence_reproduces_without_any_file_write(self):
        before = snapshot(self.root)
        result = verify.verify(self.root)
        self.assertEqual(result["recomputed_assessment_cases"], 216)
        self.assertEqual(result["recomputed_diagnostic_cases"], 216)
        self.assertEqual(result["bound_review_packets"], 145)
        self.assertEqual(result["frozen_files"], 17)
        self.assertEqual(before, snapshot(self.root))

    def test_edited_primary_summary_and_regenerated_comparison_are_rejected(self):
        edit_json(self.root / "results/rules-test/assessment.json",
                  lambda value: value["summary"]["counts"].update(decision_contract_correct=0))
        # This is the former CI path: corrupt assessment + matching regenerated
        # comparison was accepted, without changing a byte of the raw results.
        self.regenerate_historical_comparison()
        report = verify.read(self.root / "comparison.json")
        self.assertEqual(report["backends"]["rules"]["primary"]["counts"]["decision_contract_correct"], 0)
        with self.assertRaisesRegex(ValueError, "assessment summary differs"):
            verify.verify(self.root)

    def test_edited_assessment_case_is_rejected(self):
        edit_json(self.root / "results/rules-test/assessment.json",
                  lambda value: value["cases"][0].update(failure_reasons=["invented"]))
        with self.assertRaisesRegex(ValueError, "assessment cases differ"):
            verify.verify(self.root)

    def test_diagnostic_cases_and_summary_are_independently_recomputed(self):
        path = self.root / "results/rules-test/diagnostic.json"
        original = path.read_bytes()
        for target in ("cases", "summary"):
            with self.subTest(target=target):
                path.write_bytes(original)
                if target == "cases":
                    edit_json(path, lambda value: value["cases"][0].update(reasons=["invented"]))
                else:
                    edit_json(path, lambda value: value["summary"].update(correct_action_and_declared_question_fields=0))
                with self.assertRaisesRegex(ValueError, "diagnostic " + target + " differ"):
                    verify.verify(self.root)

    def test_same_backend_review_target_swap_is_rejected_after_regeneration(self):
        path = self.root / "review/blind-batch1-mapping.json"
        mapping = verify.read(path)
        first, second = [key for key, target in mapping.items() if target["backend"] == "rules"][:2]
        mapping[first], mapping[second] = mapping[second], mapping[first]
        path.write_text(json.dumps(mapping))
        self.regenerate_historical_comparison()
        with self.assertRaisesRegex(ValueError, "packet does not match mapped"):
            verify.verify(self.root)

    def test_each_packet_payload_field_is_bound_to_the_raw_target(self):
        path = self.root / "review/blind-batch1.jsonl"
        original = path.read_bytes()
        mutations = {
            "input": lambda row: row["input"].update(id="wrong-input"),
            "expected": lambda row: row.update(expected={}),
            "raw_output": lambda row: row.update(raw_output=row["raw_output"] + " "),
            "output": lambda row: row.update(output=None),
            "transport_error": lambda row: row.update(transport_error=True),
        }
        for field, mutate in mutations.items():
            with self.subTest(field=field):
                rows = [json.loads(line) for line in original.decode().splitlines()]
                mutate(rows[0])
                path.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows))
                with self.assertRaisesRegex(ValueError, "packet does not match mapped"):
                    verify.verify(self.root)

    def test_changed_comparison_is_rejected_without_overwriting_it(self):
        path = self.root / "comparison.json"
        edit_json(path, lambda value: value.update(scope="invented"))
        before = snapshot(self.root)
        with self.assertRaisesRegex(ValueError, "Stored comparison differs"):
            verify.verify(self.root)
        self.assertEqual(before, snapshot(self.root))

    def test_relocated_integration_script_uses_its_own_checkout(self):
        script = self.root / "review/final-integration-check.py"
        result = subprocess.run([sys.executable, "-B", str(script)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        result_report = verify.read(self.root / "review/final-integration-checks.json")
        self.assertTrue(result_report["regenerated_comparison_byte_identical"])
        self.assertEqual(result_report["regenerated_comparison_sha256"], verify.common.sha(self.root / "comparison.json"))
        self.assertFalse((self.root / "review/regenerated-comparison.json").exists())
        # The old absolute ROOT silently checked the author's other checkout.
        # Corrupting only this relocated copy must now make the script fail.
        edit_json(self.root / "results/rules-test/assessment.json",
                  lambda value: value["summary"]["counts"].update(decision_contract_correct=0))
        result = subprocess.run([sys.executable, "-B", str(script)], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)


class TrackedArtifactsTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="anxin-v1-index-test-")
        self.addCleanup(self.directory.cleanup)
        self.repository = Path(self.directory.name)
        self.git("init", "-q")
        for name in verify.ARTIFACTS:
            path = self.repository / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("{}\n")
        self.git("add", "--", *verify.ARTIFACTS)
        # A real fixture HEAD makes rm --cached a staged deletion, followed by
        # the same untracked regenerated path that the former CI ignored.
        self.git("-c", "user.name=Baseline test fixture", "-c", "user.email=fixture@example.invalid",
                 "-c", "commit.gpgsign=false", "commit", "-qm", "fixture artifacts")

    def git(self, *args):
        return subprocess.run(["git", "-C", str(self.repository), *args], check=True, capture_output=True, text=True)

    def test_all_required_tracked_artifacts_pass(self):
        verify.verify_tracked_artifacts(self.repository)

    def test_staged_deletion_and_untracked_regeneration_cannot_pass(self):
        for name in verify.ARTIFACTS:
            with self.subTest(artifact=name):
                path = self.repository / name
                self.git("rm", "--cached", "-f", "--", name)
                path.write_text("{}\n")  # What a generator leaves after deletion.
                status = self.git("status", "--porcelain", "--untracked-files=all", "--", name).stdout
                self.assertIn("D  " + name, status)
                self.assertIn("?? " + name, status)
                self.assertEqual(self.git("diff", "--exit-code", "--", name).returncode, 0)
                with self.assertRaisesRegex(ValueError, "must remain tracked"):
                    verify.verify_tracked_artifacts(self.repository)
                self.git("add", "--", name)

    def test_tracked_but_missing_worktree_artifact_is_rejected(self):
        (self.repository / verify.ARTIFACTS[0]).unlink()
        with self.assertRaisesRegex(ValueError, "artifact is missing"):
            verify.verify_tracked_artifacts(self.repository)


if __name__ == "__main__":
    unittest.main()
