"""CI archive retention and failure recovery, using only isolated tiny fixtures."""

import importlib.util
from pathlib import Path
import tempfile
import unittest


spec = importlib.util.spec_from_file_location(
    "evidence_space", Path(__file__).with_name("ci-evidence-space.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class EvidenceSpaceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        base = Path(self.temporary.name).resolve()
        self.workspace = base / "workspace"
        self.source = self.workspace / "experiments/material-facts-v7/postfreeze-evidence"
        self.source.mkdir(parents=True)
        (self.source / "empty").mkdir()
        (self.source / "原始输出.bin").write_bytes(b"\x00raw\xff\n")
        self.storage = base / "storage"
        self.before = module.inventory(self.source)

    def execute(self, action):
        module.run(action, self.workspace, self.storage)

    def test_round_trip_preserves_bytes_names_directories_and_modes(self):
        self.execute("park")
        self.assertFalse(self.source.exists())
        self.assertEqual(module.inventory(self.storage / "archive"), self.before)
        self.execute("restore")
        self.assertEqual(module.inventory(self.source), self.before)

    def test_changed_bytes_are_restored_but_report_failure(self):
        self.execute("park")
        (self.storage / "archive/原始输出.bin").write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "differs"):
            self.execute("restore")
        self.assertEqual((self.source / "原始输出.bin").read_bytes(), b"changed")
        self.assertIn('"identical": false', (self.storage / "restore.json").read_text())

    def test_changed_root_permissions_are_not_reported_identical(self):
        self.source.chmod(0o700)
        self.execute("park")
        (self.storage / "archive").chmod(0o755)
        with self.assertRaisesRegex(ValueError, "differs"):
            self.execute("restore")
        self.assertTrue(self.source.is_dir())

    def test_restore_collision_keeps_both_sides(self):
        self.execute("park")
        self.source.mkdir()
        (self.source / "new").write_text("keep")
        with self.assertRaisesRegex(ValueError, "collision"):
            self.execute("restore")
        self.assertEqual((self.source / "new").read_text(), "keep")
        self.assertEqual(module.inventory(self.storage / "archive"), self.before)

    def test_storage_collision_does_not_move_source(self):
        self.storage.mkdir()
        with self.assertRaises(FileExistsError):
            self.execute("park")
        self.assertEqual(module.inventory(self.source), self.before)

    def test_restore_without_park_accepts_present_source_only(self):
        self.execute("restore")
        self.source.rename(self.source.with_name("preserved"))
        with self.assertRaisesRegex(ValueError, "Cannot account"):
            self.execute("restore")

    def test_refuse_symlink_without_moving_evidence(self):
        (self.source / "link").symlink_to(self.source / "原始输出.bin")
        with self.assertRaisesRegex(ValueError, "symlink"):
            self.execute("park")
        self.assertTrue(self.source.is_dir())


if __name__ == "__main__":
    unittest.main()
