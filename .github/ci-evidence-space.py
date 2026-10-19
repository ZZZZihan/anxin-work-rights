"""Keep diagnostic archives out of recursive historical CI copies, without deletion."""

import hashlib
import json
import os
from pathlib import Path
import stat
import sys


def inventory(directory):
    records = {".": {"type": "directory", "mode": stat.S_IMODE(directory.stat().st_mode)}}
    for path in sorted(directory.rglob("*")):
        if path.is_symlink():
            raise ValueError(f"Refusing evidence symlink: {path}")
        mode = stat.S_IMODE(path.stat().st_mode)
        if path.is_dir():
            value = {"type": "directory", "mode": mode}
        elif path.is_file():
            with path.open("rb") as source:
                digest = hashlib.file_digest(source, "sha256").hexdigest()
            value = {"type": "file", "mode": mode, "sha256": digest,
                     "size": path.stat().st_size}
        else:
            raise ValueError(f"Refusing special evidence file: {path}")
        records[path.relative_to(directory).as_posix()] = value
    return records


def run(action, workspace, temporary):
    workspace = Path(workspace).resolve(strict=True)
    temporary = Path(temporary).resolve()
    if temporary.is_relative_to(workspace):
        raise ValueError("Evidence storage must be outside the workspace")
    source = workspace / "experiments/material-facts-v7/postfreeze-evidence"
    archive = temporary / "archive"
    manifest = temporary / "manifest.json"
    receipt = temporary / "restore.json"
    if source.is_symlink() or archive.is_symlink():
        raise ValueError("Refusing evidence directory symlink")
    if action == "park":
        if not source.is_dir() or source.resolve() != source:
            raise ValueError("Expected original diagnostic directory")
        records = inventory(source)
        temporary.mkdir()  # Exclusive: never reuse or overwrite an earlier attempt.
        with manifest.open("x", encoding="utf-8") as output:
            json.dump({"source": str(source), "entries": records}, output,
                      ensure_ascii=False, sort_keys=True, indent=2)
        os.rename(source, archive)  # Atomic on the runner's shared filesystem.
        print(f"Parked {len(records)} diagnostic entries; original bytes retained")
        return
    if action != "restore":
        raise ValueError("Expected park or restore")
    if not manifest.exists():
        if archive.exists() or not source.is_dir():
            raise ValueError("Cannot account for diagnostic evidence")
        print("Diagnostic evidence was not parked")
        return
    saved = json.loads(manifest.read_text(encoding="utf-8"))
    if saved["source"] != str(source):
        raise ValueError("Evidence manifest belongs to a different workspace")
    if archive.exists():
        if source.exists():
            raise ValueError("Restore collision: preserving both evidence directories")
        os.rename(archive, source)
    if not source.is_dir():
        raise ValueError("Diagnostic evidence is missing")
    # Restore even changed evidence, then fail explicitly without losing its bytes.
    actual = inventory(source)
    identical = actual == saved["entries"]
    receipt.write_text(json.dumps({"restored": True, "identical": identical,
                                  "entry_count": len(actual)}, indent=2) + "\n",
                       encoding="utf-8")
    if not identical:
        raise ValueError("Restored diagnostic evidence differs from its manifest")
    print(f"Restored and verified {len(actual)} diagnostic entries")


if __name__ == "__main__":
    run(*sys.argv[1:])
