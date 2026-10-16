"""Behavior/provenance regressions on frozen real data, using isolated copies."""
import copy
from contextlib import redirect_stdout
import importlib.util
import io
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("public_data", Path(__file__).parents[1] / "public-data.py")
DATA = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DATA)


class PublicDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix="anxin-data-tests-")
        cls.base = Path(cls.tmp.name)
        cls.frozen = cls.base / "frozen"
        shutil.copytree(DATA.DEFAULT_DATA, cls.frozen, ignore=shutil.ignore_patterns("release", "__pycache__"))
        cls.release = cls.base / "release"
        cls.report = DATA.build(cls.frozen, cls.release)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def isolated_source(self, name):
        target = self.base / name
        shutil.copytree(self.frozen, target)
        return target

    def test_real_release_rebuild_is_repeatable(self):
        second = self.base / "repeat-release"
        DATA.build(self.frozen, second)
        self.assertEqual(DATA.verify(self.frozen, second)["status"], "PASS")
        # Raw download times are frozen metadata; a rebuild must not rewrite them.
        self.assertEqual(DATA.read_json(self.release / "manifest.json"), DATA.read_json(second / "manifest.json"))

    def test_malformed_case_usage_limits_fail_before_release_replacement(self):
        source = self.isolated_source("coverage-tamper")
        path = source / "curation/cases/coverage.json"
        original = DATA.read_json(path)
        before = (self.release / "labor-public.sqlite").read_bytes()
        for field, bad in (("limitations", "not-a-list"), ("limitations", [""]),
                           ("merits_supervision_eligible", 1), ("scenario", ["not-a-string"])):
            with self.subTest(field=field, bad=bad):
                changed = copy.deepcopy(original)
                changed["cases"][0][field] = bad
                DATA.json_file(path, changed)
                with self.assertRaisesRegex(DATA.DataError, "case extraction verification failed"):
                    DATA.build(source, self.release)
                self.assertEqual(before, (self.release / "labor-public.sqlite").read_bytes())

    def test_source_tamper_fails_before_replacing_release(self):
        source = self.isolated_source("raw-tamper")
        record = DATA.load_dataset(source)[0][0]
        (source / record["raw_path"]).write_bytes(b"changed raw source")
        before = (self.release / "labor-public.sqlite").read_bytes()
        with self.assertRaisesRegex(DATA.DataError, "raw source hash mismatch"):
            DATA.build(source, self.release)
        self.assertEqual(before, (self.release / "labor-public.sqlite").read_bytes())

    def test_consistent_clean_and_paragraph_tamper_fails_raw_reextraction(self):
        source = self.isolated_source("clean-tamper")
        path = source / "curation/laws/sources.json"
        records = DATA.read_json(path)
        records[0]["paragraphs"][0]["text"] += " 伪造的附加句子"
        DATA.json_file(path, records)
        (source / records[0]["text_path"]).write_text("\n\n".join(p["text"] for p in records[0]["paragraphs"]) + "\n", encoding="utf-8")
        with self.assertRaisesRegex(DATA.DataError, "offline raw-to-clean verification failed"):
            DATA.verify_clean_sources(source)

    def test_provision_tamper_with_updated_manifest_is_detected(self):
        target = self.base / "provision-tamper"
        shutil.copytree(self.release, target)
        path = target / "provisions.jsonl"
        rows = [json.loads(line) for line in path.read_text().splitlines()]
        rows[0]["text"] = "伪造条款"
        path.write_text("".join(DATA.canonical(row) + "\n" for row in rows), encoding="utf-8")
        manifest = DATA.read_json(target / "manifest.json")
        manifest["files"][path.name] = {"sha256": DATA.sha256(path.read_bytes()), "bytes": path.stat().st_size}
        DATA.json_file(target / "manifest.json", manifest)
        with self.assertRaisesRegex(DATA.DataError, "provisions JSONL does not match curation"):
            DATA.verify(self.frozen, target)

    def test_same_collection_other_case_citation_is_rejected(self):
        sources, cases, laws = copy.deepcopy(DATA.load_dataset(self.frozen))
        case = cases[0]
        source = next(s for s in sources if s["id"] == case["source_id"])
        outside = next(p["id"] for p in source["paragraphs"] if p["id"] not in case["source_refs"])
        case["facts"][0]["refs"] = [outside]
        with self.assertRaisesRegex(DATA.DataError, "citation outside record body"):
            DATA.validate(self.frozen, sources, cases, laws)

    def test_real_queries_and_provision_boundaries(self):
        result = DATA.search(self.release, "举证", "wage_arrears", "cases")
        self.assertGreater(result["total_matches"], 0)
        self.assertTrue(all(row["source_url"].startswith("https://") for row in result["results"]))
        for row in result["results"]:
            detail = DATA.get_record(self.release, row["id"])
            self.assertTrue(detail["cited_paragraphs"])
            self.assertEqual(detail["record"]["annotation_status"], DATA.ANNOTATION)
        laws = DATA.load_dataset(self.frozen)[2]
        provision = DATA.get_record(self.release, laws[0]["articles"][0]["id"])
        for key in ("version_label", "effective_on", "expires_on", "applicability", "status_note", "annotation_status"):
            self.assertIn(key, provision)
        self.assertEqual(DATA.search(self.release, "' OR 1=1 --")["total_matches"], 0)
        with self.assertRaisesRegex(DATA.DataError, "record not found"):
            DATA.get_record(self.release, "unknown-record")

    def test_mismatched_law_name_link_is_rejected(self):
        sources, cases, laws = copy.deepcopy(DATA.load_dataset(self.frozen))
        case = next(c for c in cases if c["cited_rules"])
        rule = case["cited_rules"][0]
        rule["law_id"] = next(l["id"] for l in laws if l["title"] != rule["name"])
        with self.assertRaisesRegex(DATA.DataError, "law link name mismatch"):
            DATA.validate(self.frozen, sources, cases, laws)

    def test_law_fetch_failure_is_nonzero_and_keeps_frozen_files(self):
        root = self.isolated_source("fetch-failure") / "curation/laws"
        spec = importlib.util.spec_from_file_location("law_collector", root / "collect.py")
        collector = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(collector)
        files = [p for p in root.rglob("*") if p.is_file() and p.name != "fetch_failures.json"]
        before = {p: p.read_bytes() for p in files}
        with patch.object(collector, "fetch", side_effect=OSError("offline simulated fetch failure")), \
                patch("sys.argv", ["collect.py", "--fetch"]), redirect_stdout(io.StringIO()):
            with self.assertRaises(SystemExit) as error:
                collector.main()
        self.assertIn("Fetch failed", str(error.exception))
        self.assertTrue(all(p.read_bytes() == value for p, value in before.items()))
        self.assertEqual(len(DATA.read_json(root / "fetch_failures.json")),
                         len(DATA.read_json(self.frozen / "curation/laws/fetch_failures.json")) + 8)

    def test_case_fetch_changed_response_preserves_snapshot(self):
        root = self.isolated_source("case-fetch-change") / "curation/cases"
        spec = importlib.util.spec_from_file_location("case_collector", root / "collect_sources.py")
        collector = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(collector)
        class Response:
            headers = {"Content-Type": "text/html"}
            url = collector.CATALOG[0]["url"]
            status = 200
            def __enter__(self): return self
            def __exit__(self, *args): return None
            def read(self): return b"changed remote content"
        before = {p: p.read_bytes() for p in root.rglob("*") if p.is_file()}
        with patch.object(collector, "urlopen", return_value=Response()), \
                patch("sys.argv", ["collect_sources.py", "--fetch"]):
            with self.assertRaisesRegex(ValueError, "refusing to overwrite"):
                collector.main()
        self.assertTrue(all(p.read_bytes() == value for p, value in before.items()))


if __name__ == "__main__":
    unittest.main()
