#!/usr/bin/env python3
"""Generate the Worker index from the verified, frozen public release; stdlib only."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
RELEASE = ROOT / "data/labor-public-v1/release"
OUTPUT = ROOT / "lib/generated/public-knowledge.json"
DATASET_ID = "anxin-labor-public-v1"
ANNOTATION = "agent_curated_not_legal_expert_reviewed"
TOPICS = {"wage_arrears", "employment_relationship"}
INPUT_FILES = ("sources.jsonl", "cases.jsonl", "provisions.jsonl")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def load_verified_release():
    # The original verifier also checks raw HTML re-extraction and exact case excerpts.
    result = subprocess.run(
        [sys.executable, "-E", "-B", str(ROOT / "scripts/public-data.py"), "verify"],
        cwd=ROOT, capture_output=True, text=True, timeout=60,
    )
    require(result.returncode == 0, f"public release verification failed: {result.stderr or result.stdout}")
    manifest = json.loads((RELEASE / "manifest.json").read_text(encoding="utf-8"))
    require(manifest["dataset_id"] == DATASET_ID and manifest["schema_version"] == 1,
            "unsupported public dataset")
    require(json.loads(result.stdout)["data_fingerprint"] == manifest["data_fingerprint"],
            "verified fingerprint differs from release")
    loaded = {}
    for name in INPUT_FILES:
        data = (RELEASE / name).read_bytes()
        info = manifest["files"][name]
        require(len(data) == info["bytes"] and hashlib.sha256(data).hexdigest() == info["sha256"],
                f"release changed after verification: {name}")
        loaded[name] = [json.loads(line) for line in data.decode("utf-8").splitlines()]
    return manifest, loaded


def build_index(manifest, loaded):
    sources = loaded["sources.jsonl"]
    cases = loaded["cases.jsonl"]
    provisions = loaded["provisions.jsonl"]
    source_map, paragraphs = {}, {}
    for source in sources:
        sid = source["id"]
        require(sid not in source_map, f"duplicate source: {sid}")
        url = urlparse(source["url"])
        require(url.scheme == "https" and url.hostname and not url.username and not url.password,
                f"source URL must be a public HTTPS URL: {sid}")
        source_map[sid] = source
        for p in source["paragraphs"]:
            require(p["id"] not in paragraphs and p["id"].startswith(sid + ":"),
                    f"duplicate or mismatched paragraph: {p['id']}")
            require(isinstance(p["text"], str) and p["text"].strip(), "empty source paragraph")
            paragraphs[p["id"]] = (sid, p["text"])

    documents, ids, used = [], set(), set()

    def check_record(record, refs):
        rid = record["id"]
        require(rid not in ids, f"duplicate record: {rid}")
        ids.add(rid)
        require(record["source_id"] in source_map, f"unknown source: {rid}")
        require(record["annotation_status"] == ANNOTATION, f"unsupported review status: {rid}")
        require(record["topics"] and set(record["topics"]) <= TOPICS, f"unknown topic: {rid}")
        require(refs and len(refs) == len(set(refs)), f"empty or duplicate references: {rid}")
        for ref in refs:
            require(ref in paragraphs and paragraphs[ref][0] == record["source_id"],
                    f"unknown or cross-source reference: {rid}/{ref}")
        used.update(refs)

    for case in cases:
        refs = case["source_refs"]
        check_record(case, refs)
        sections = []
        for field in ("facts", "claims", "issues", "reasoning"):
            for item in case[field]:
                require(item["refs"] and set(item["refs"]) <= set(refs),
                        f"case field escapes record: {case['id']}/{field}")
                require(item["text"] in "".join(paragraphs[r][1] for r in item["refs"]),
                        f"case field is not source extract: {case['id']}/{field}")
                sections.append({"field": field, "text": item["text"]})
        for item in case["evidence"]:
            require(item["has_original"] is False and set(item["refs"]) <= set(refs),
                    f"invalid evidence provenance: {case['id']}")
            sections.append({"field": "evidence", "text": item["description"]})
        require(set(case["outcome"]["refs"]) <= set(refs), f"outcome escapes record: {case['id']}")
        sections.append({"field": "outcome", "text": case["outcome"]["text"]})
        notes = ["来源为官方典型案例汇编，未披露裁判地区和裁判日期；不是完整裁判文书。"]
        for rule in case["cited_rules"]:
            require(rule["version_match"] == "not_determined" and rule["link_basis"] == "source_explicit",
                    f"unsupported version certainty: {case['id']}")
            if rule["link_note"] not in notes:
                notes.append(rule["link_note"])
        documents.append({
            "id": case["id"], "kind": "case", "title": case["title"],
            "sourceId": case["source_id"], "refs": refs, "topics": case["topics"],
            "tags": case["tags"], "sections": sections, "outcome": case["outcome"]["text"],
            "region": case["region"], "decisionDate": case["decision_date"],
            "versionNote": " ".join(notes), "annotationStatus": ANNOTATION,
        })
    for provision in provisions:
        refs = provision["refs"]
        check_record(provision, refs)
        require(provision["text"] == "\n".join(paragraphs[r][1] for r in refs),
                f"provision differs from verbatim source: {provision['id']}")
        # Index only the explicitly released provisions, never the historical source body.
        require(not (provision["law_id"] == "labor-dispute-interpretation-i-2020"
                     and provision["label"] == "第三十二条"), "known repealed provision cannot enter index")
        documents.append({
            "id": provision["id"], "kind": "provision",
            "title": provision["law_title"] + " " + provision["label"],
            "sourceId": provision["source_id"], "refs": refs, "topics": provision["topics"],
            "tags": [], "sections": [{"field": "text", "text": provision["text"]}],
            "versionNote": provision["status_note"], "versionLabel": provision["version_label"],
            "articleLabel": provision["label"], "effectiveOn": provision["effective_on"],
            "expiresOn": provision["expires_on"], "annotationStatus": ANNOTATION,
        })
    selected_sources = []
    for source in sources:
        selected_sources.append({
            "id": source["id"], "title": source["title"], "url": source["url"],
            "publisher": source["publisher"], "publishedOn": source["published_on"],
            "retrievedAt": source["retrieved_at"], "rawSha256": source["raw_sha256"],
            "paragraphs": [p for p in source["paragraphs"] if p["id"] in used],
        })
    require(len(cases) == manifest["counts"]["cases"]
            and len(provisions) == manifest["counts"]["selected_provisions"], "release count mismatch")
    return {
        "datasetId": DATASET_ID, "schemaVersion": 1,
        "fingerprint": manifest["data_fingerprint"],
        "inputHashes": {name: manifest["files"][name]["sha256"] for name in INPUT_FILES},
        "sources": sorted(selected_sources, key=lambda s: s["id"]),
        "documents": sorted(documents, key=lambda d: d["id"]),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="verify committed generated index without writing")
    args = parser.parse_args()
    manifest, loaded = load_verified_release()
    content = (canonical(build_index(manifest, loaded)) + "\n").encode("utf-8")
    if args.check:
        require(OUTPUT.is_file() and OUTPUT.read_bytes() == content,
                "generated index is missing or stale; run python3 -B scripts/build-public-index.py")
    else:
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        require(not OUTPUT.is_symlink(), "generated output cannot be a symlink")
        with tempfile.NamedTemporaryFile(prefix=".public-knowledge-", dir=OUTPUT.parent, delete=False) as tmp:
            staged = Path(tmp.name)
            try:
                tmp.write(content)
                tmp.flush()
                staged.replace(OUTPUT)
            finally:
                staged.unlink(missing_ok=True)
    print(json.dumps({"status": "PASS", "fingerprint": manifest["data_fingerprint"],
                      "bytes": len(content), "checkOnly": args.check}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, TypeError, OSError, subprocess.TimeoutExpired) as exc:
        sys.exit(f"public-index: {exc}")
