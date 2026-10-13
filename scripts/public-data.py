#!/usr/bin/env python3
"""Build and query the frozen public labor-law sample using Python stdlib only."""
from __future__ import annotations

import argparse
from collections import Counter
from contextlib import contextmanager
from datetime import date, datetime
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
import tempfile
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA = ROOT / "data/labor-public-v1"
DATASET_ID = "anxin-labor-public-v1"
TOPICS = {"wage_arrears", "employment_relationship"}
ANNOTATION = "agent_curated_not_legal_expert_reviewed"


class DataError(ValueError):
    pass


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def json_file(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def require(condition, message):
    if not condition:
        raise DataError(message)


def local_path(root, name):
    require(isinstance(name, str) and name, "asset path must be nonempty")
    path = (root / name).resolve()
    require(path.is_relative_to(root.resolve()), f"asset escapes dataset: {name}")
    require(path.is_file(), f"asset missing: {name}")
    return path


def check_date(value, name):
    if value is not None:
        require(isinstance(value, str), f"{name}: date must be string or null")
        try:
            require(date.fromisoformat(value).isoformat() == value, f"{name}: use YYYY-MM-DD")
        except ValueError as exc:
            raise DataError(f"{name}: invalid date {value}") from exc


def all_refs(value, path=""):
    if isinstance(value, dict):
        for key, child in value.items():
            child_path = f"{path}.{key}" if path else key
            if key in {"refs", "source_refs"}:
                yield child_path, child
            else:
                yield from all_refs(child, child_path)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from all_refs(child, f"{path}[{index}]")


def load_dataset(root):
    sources, cases, laws = [], [], []
    for family, target in (("cases", cases), ("laws", laws)):
        folder = root / "curation" / family
        sources.extend(read_json(folder / "sources.json"))
        target.extend(read_json(folder / f"{family}.json"))
    for records in (sources, cases, laws):
        records.sort(key=lambda item: item["id"])
    return sources, cases, laws


def validate(root, sources, cases, laws):
    require(sources and cases and laws, "sources, cases and laws must all be nonempty")
    source_ids, paragraphs, ids = {}, {}, set()
    raw_hashes, cleaned_hashes = Counter(), Counter()
    source_fields = {"id", "title", "url", "publisher", "published_on", "retrieved_at", "raw_path", "raw_sha256", "text_path", "encoding", "acquisition_method", "usage_note", "paragraphs"}
    for source in sources:
        sid = source["id"]
        require(not source_fields - source.keys(), f"{sid}: missing source fields {source_fields - source.keys()}")
        require(sid not in source_ids, f"duplicate source id: {sid}")
        require(urlparse(source["url"]).scheme in {"http", "https"}, f"{sid}: invalid source URL")
        require(source["acquisition_method"] in {"direct_http", "jina_reader"}, f"{sid}: undocumented acquisition method")
        require(source["title"] and source["publisher"] and source["usage_note"], f"{sid}: source metadata is empty")
        check_date(source["published_on"], f"{sid}.published_on")
        try:
            retrieved = datetime.fromisoformat(source["retrieved_at"].replace("Z", "+00:00"))
            require(retrieved.tzinfo is not None, f"{sid}: retrieved_at needs timezone")
        except (ValueError, AttributeError) as exc:
            raise DataError(f"{sid}: invalid retrieval timestamp") from exc
        raw = local_path(root, source["raw_path"]).read_bytes()
        require(sha256(raw) == source["raw_sha256"], f"{sid}: raw source hash mismatch")
        require(source["paragraphs"], f"{sid}: no source paragraphs")
        for paragraph in source["paragraphs"]:
            pid = paragraph["id"]
            require(pid.startswith(sid + ":"), f"{pid}: paragraph/source mismatch")
            require(pid not in paragraphs, f"duplicate paragraph id: {pid}")
            require(isinstance(paragraph["text"], str) and paragraph["text"].strip(), f"{pid}: empty paragraph")
            paragraphs[pid] = (sid, paragraph["text"])
        cleaned = "\n\n".join(p["text"] for p in source["paragraphs"]) + "\n"
        require(local_path(root, source["text_path"]).read_text(encoding="utf-8") == cleaned, f"{sid}: clean text differs from paragraph snapshot")
        raw_hashes[source["raw_sha256"]] += 1
        cleaned_hashes[sha256(cleaned.encode())] += 1
        source_ids[sid] = source
    require(max(raw_hashes.values()) == 1, "duplicate raw source snapshot; reuse one source id")
    require(max(cleaned_hashes.values()) == 1, "duplicate cleaned source; deduplicate before release")

    citations = []
    law_ids = {law["id"] for law in laws}
    law_titles = {law["id"]: law["title"] for law in laws}
    topic_counts = Counter()
    for kind, records in (("case", cases), ("law", laws)):
        for record in records:
            rid = record["id"]
            require(rid not in ids, f"duplicate record id: {rid}")
            ids.add(rid)
            require(record["source_id"] in source_ids, f"{rid}: unknown source")
            require(record["annotation_status"] == ANNOTATION, f"{rid}: unsupported review claim")
            require(record["source_refs"], f"{rid}: missing body provenance")
            require(isinstance(record.get("title"), str) and record["title"].strip(), f"{rid}: missing title")
            for field, refs in all_refs(record):
                require(isinstance(refs, list) and refs, f"{rid}.{field}: empty or invalid references")
                require(len(refs) == len(set(refs)), f"{rid}.{field}: duplicate reference")
                for pid in refs:
                    require(pid in paragraphs, f"{rid}.{field}: unknown paragraph {pid}")
                    require(paragraphs[pid][0] == record["source_id"], f"{rid}.{field}: cross-source citation")
                    require(pid in record["source_refs"], f"{rid}.{field}: citation outside record body")
                    citations.append((rid, field, pid))
            if kind == "case":
                required = {"title", "topics", "case_group_id", "region", "decision_date", "facts", "claims", "issues", "evidence", "outcome", "reasoning", "cited_rules", "tags"}
                require(not required - record.keys(), f"{rid}: missing case fields {required - record.keys()}")
                require(record["topics"] and set(record["topics"]) <= TOPICS, f"{rid}: invalid topics")
                require(len(set(record["topics"])) == len(record["topics"]), f"{rid}: duplicate topics")
                require(record["case_group_id"], f"{rid}: missing case group")
                require(record["region"] is None or isinstance(record["region"], str), f"{rid}: invalid region")
                check_date(record["decision_date"], f"{rid}.decision_date")
                require(record["facts"] and record["outcome"].get("text"), f"{rid}: missing facts or outcome")
                require(record.get("issue_disclosure") == ("reported_in_source" if record["issues"] else "not_explicit_in_source"), f"{rid}: issue disclosure does not match source annotations")
                for field in ("facts", "claims", "issues", "reasoning"):
                    for statement in record[field]:
                        require(statement.get("text") and statement.get("refs"), f"{rid}.{field}: missing text or refs")
                        require(statement["kind"] in {"reported_fact", "party_assertion", "adjudicated_fact", "issue", "reasoning"}, f"{rid}.{field}: unknown statement kind")
                require(record["outcome"].get("refs"), f"{rid}: outcome has no refs")
                for evidence in record["evidence"]:
                    require(evidence.get("description") and evidence.get("material_type") and evidence.get("refs"), f"{rid}: missing evidence description or refs")
                    require(evidence["treatment"] in {"mentioned", "accepted", "rejected", "not_disclosed"}, f"{rid}: invalid evidence treatment")
                    require(evidence["has_original"] is False, f"{rid}: this release contains descriptions, not original case exhibits")
                for rule in record["cited_rules"]:
                    require(rule.get("name") and rule.get("refs"), f"{rid}: rule name/provenance missing")
                    require(rule["link_basis"] == "source_explicit", f"{rid}: unsupported inferred authority")
                    require(rule["law_id"] is None or rule["law_id"] in law_ids, f"{rid}: dangling law link")
                    if rule["law_id"]:
                        require(law_titles[rule["law_id"]] == rule["name"], f"{rid}: law link name mismatch")
                    require(rule.get("version_match") == "not_determined" and rule.get("link_note"), f"{rid}: rule link must disclose version uncertainty")
                topic_counts.update(record["topics"])
            else:
                required = {"title", "instrument_type", "version_label", "issued_on", "effective_on", "expires_on", "applicability", "status_note", "articles"}
                require(not required - record.keys(), f"{rid}: missing law fields {required - record.keys()}")
                for field in ("issued_on", "effective_on", "expires_on"):
                    check_date(record[field], f"{rid}.{field}")
                require(record["status_note"] and record["version_label"] and record["applicability"], f"{rid}: missing version boundary")
                require(record["articles"], f"{rid}: no selected provisions")
                for article in record["articles"]:
                    aid = article["id"]
                    require(aid not in ids, f"duplicate provision id: {aid}")
                    ids.add(aid)
                    require(article.get("label") and article.get("refs"), f"{aid}: missing label or refs")
                    require(article["topics"] and set(article["topics"]) <= TOPICS, f"{aid}: invalid provision topics")
                    exact = "\n".join(paragraphs[pid][1] for pid in article["refs"])
                    require(article["text"] == exact, f"{aid}: provision is not verbatim source paragraphs")
    require(set(topic_counts) == TOPICS, "both task topics need at least one case")
    body_hashes = Counter(sha256("\n".join(paragraphs[p][1] for p in c["source_refs"]).encode()) for c in cases)
    require(max(body_hashes.values()) == 1, "duplicate case body across records")
    return paragraphs, citations, topic_counts


def verify_clean_sources(root):
    """Re-extract frozen HTML offline; hashes alone cannot validate text extraction."""
    for relative in ("curation/cases/collect_sources.py", "curation/laws/collect.py"):
        script = local_path(root, relative)
        result = subprocess.run([sys.executable, "-E", "-B", str(script), "--verify-clean"],
                                capture_output=True, text=True, timeout=60)
        require(result.returncode == 0,
                f"offline raw-to-clean verification failed ({relative}): {result.stderr or result.stdout}")
    result = subprocess.run([sys.executable, "-E", "-B", str(local_path(root, "curation/cases/validate_cases.py"))],
                            capture_output=True, text=True, timeout=60)
    require(result.returncode == 0, f"case extraction verification failed: {result.stderr or result.stdout}")


def provision_records(laws):
    return [{"law_id": law["id"], "source_id": law["source_id"],
             "law_title": law["title"], "version_label": law["version_label"],
             "issued_on": law["issued_on"], "effective_on": law["effective_on"],
             "expires_on": law["expires_on"], "applicability": law["applicability"],
             "status_note": law["status_note"], "annotation_status": law["annotation_status"],
             **article} for law in laws for article in law["articles"]]


SCHEMA = """
PRAGMA foreign_keys=ON;
CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE sources(id TEXT PRIMARY KEY, title TEXT NOT NULL, url TEXT NOT NULL, publisher TEXT NOT NULL, published_on TEXT, retrieved_at TEXT NOT NULL, raw_sha256 TEXT NOT NULL, record_json TEXT NOT NULL);
CREATE TABLE paragraphs(id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id), ordinal INTEGER NOT NULL, text TEXT NOT NULL);
CREATE TABLE cases(id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id), title TEXT NOT NULL, case_group_id TEXT NOT NULL, region TEXT, decision_date TEXT, annotation_status TEXT NOT NULL, record_json TEXT NOT NULL);
CREATE TABLE case_topics(case_id TEXT NOT NULL REFERENCES cases(id), topic TEXT NOT NULL, PRIMARY KEY(case_id,topic));
CREATE TABLE statements(case_id TEXT NOT NULL REFERENCES cases(id), field TEXT NOT NULL, ordinal INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, refs_json TEXT NOT NULL, PRIMARY KEY(case_id,field,ordinal));
CREATE TABLE evidence_descriptions(case_id TEXT NOT NULL REFERENCES cases(id), ordinal INTEGER NOT NULL, material_type TEXT NOT NULL, description TEXT NOT NULL, treatment TEXT NOT NULL, has_original INTEGER NOT NULL CHECK(has_original=0), refs_json TEXT NOT NULL, PRIMARY KEY(case_id,ordinal));
CREATE TABLE laws(id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id), title TEXT NOT NULL, version_label TEXT NOT NULL, issued_on TEXT, effective_on TEXT, expires_on TEXT, applicability_json TEXT NOT NULL, status_note TEXT NOT NULL, record_json TEXT NOT NULL);
CREATE TABLE provisions(id TEXT PRIMARY KEY, law_id TEXT NOT NULL REFERENCES laws(id), label TEXT NOT NULL, text TEXT NOT NULL, topics_json TEXT NOT NULL, refs_json TEXT NOT NULL);
CREATE TABLE case_rule_citations(case_id TEXT NOT NULL REFERENCES cases(id), ordinal INTEGER NOT NULL, name TEXT NOT NULL, article TEXT, law_id TEXT REFERENCES laws(id), link_basis TEXT NOT NULL, refs_json TEXT NOT NULL, version_match TEXT NOT NULL, link_note TEXT NOT NULL, PRIMARY KEY(case_id,ordinal));
CREATE TABLE citations(record_id TEXT NOT NULL, field_path TEXT NOT NULL, paragraph_id TEXT NOT NULL REFERENCES paragraphs(id), PRIMARY KEY(record_id,field_path,paragraph_id));
CREATE TABLE search_documents(id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, source_id TEXT NOT NULL REFERENCES sources(id), topics_json TEXT NOT NULL, region TEXT, effective_on TEXT, expires_on TEXT, search_text TEXT NOT NULL);
CREATE INDEX citations_record ON citations(record_id);
CREATE INDEX paragraphs_source ON paragraphs(source_id);
CREATE INDEX search_kind ON search_documents(kind);
CREATE VIEW case_provenance AS SELECT c.id AS case_id,c.title,c.region,c.decision_date,s.url,s.publisher,c.annotation_status FROM cases c JOIN sources s ON s.id=c.source_id;
"""


def make_database(path, sources, cases, laws, citations, fingerprint):
    conn = sqlite3.connect(path)
    try:
        conn.executescript(SCHEMA)
        conn.executemany("INSERT INTO metadata VALUES (?,?)", [("dataset_id", DATASET_ID), ("schema_version", "1"), ("data_fingerprint", fingerprint), ("status", "curated_sample_not_legal_expert_reviewed")])
        for s in sources:
            conn.execute("INSERT INTO sources VALUES (?,?,?,?,?,?,?,?)", (s["id"], s["title"], s["url"], s["publisher"], s["published_on"], s["retrieved_at"], s["raw_sha256"], canonical(s)))
            conn.executemany("INSERT INTO paragraphs VALUES (?,?,?,?)", [(p["id"], s["id"], n, p["text"]) for n, p in enumerate(s["paragraphs"])])
        for law in laws:
            conn.execute("INSERT INTO laws VALUES (?,?,?,?,?,?,?,?,?,?)", (law["id"], law["source_id"], law["title"], law["version_label"], law["issued_on"], law["effective_on"], law["expires_on"], canonical(law["applicability"]), law["status_note"], canonical(law)))
            for a in law["articles"]:
                conn.execute("INSERT INTO provisions VALUES (?,?,?,?,?,?)", (a["id"], law["id"], a["label"], a["text"], canonical(a["topics"]), canonical(a["refs"])))
                conn.execute("INSERT INTO search_documents VALUES (?,?,?,?,?,?,?,?,?)", (a["id"], "provisions", law["title"] + " " + a["label"], law["source_id"], canonical(a["topics"]), "、".join(law["applicability"]), law["effective_on"], law["expires_on"], law["title"] + "\n" + a["text"]))
        for c in cases:
            cid = c["id"]
            conn.execute("INSERT INTO cases VALUES (?,?,?,?,?,?,?,?)", (cid, c["source_id"], c["title"], c["case_group_id"], c["region"], c["decision_date"], c["annotation_status"], canonical(c)))
            conn.executemany("INSERT INTO case_topics VALUES (?,?)", [(cid, t) for t in c["topics"]])
            text_parts = [c["title"], *c["tags"], c["outcome"]["text"]]
            for field in ("facts", "claims", "issues", "reasoning"):
                for n, s in enumerate(c[field]):
                    conn.execute("INSERT INTO statements VALUES (?,?,?,?,?,?)", (cid, field, n, s["kind"], s["text"], canonical(s["refs"])))
                    text_parts.append(s["text"])
            for n, e in enumerate(c["evidence"]):
                conn.execute("INSERT INTO evidence_descriptions VALUES (?,?,?,?,?,?,?)", (cid, n, e["material_type"], e["description"], e["treatment"], 0, canonical(e["refs"])))
                text_parts.append(e["description"])
            for n, r in enumerate(c["cited_rules"]):
                conn.execute("INSERT INTO case_rule_citations VALUES (?,?,?,?,?,?,?,?,?)", (cid, n, r["name"], r["article"], r["law_id"], r["link_basis"], canonical(r["refs"]), r["version_match"], r["link_note"]))
            conn.execute("INSERT INTO search_documents VALUES (?,?,?,?,?,?,?,?,?)", (cid, "cases", c["title"], c["source_id"], canonical(c["topics"]), c["region"], None, None, "\n".join(text_parts)))
        conn.executemany("INSERT INTO citations VALUES (?,?,?)", citations)
        require(not conn.execute("PRAGMA foreign_key_check").fetchall(), "SQLite foreign key validation failed")
        require(conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok", "SQLite integrity check failed")
        conn.commit()
    finally:
        conn.close()


def dataset_counts(sources, cases, laws, paragraphs, citations, topic_counts):
    return {"sources": len(sources), "source_paragraphs": len(paragraphs), "cases": len(cases), "cases_by_topic": dict(sorted(topic_counts.items())), "laws": len(laws), "selected_provisions": sum(len(l["articles"]) for l in laws), "field_citations": len(citations), "evidence_descriptions": sum(len(c["evidence"]) for c in cases), "original_case_exhibits": 0, "linked_rule_citations": sum(r["law_id"] is not None for c in cases for r in c["cited_rules"]), "unlinked_rule_citations": sum(r["law_id"] is None for c in cases for r in c["cited_rules"]), "cases_with_undisclosed_region": sum(c["region"] is None for c in cases), "cases_with_undisclosed_decision_date": sum(c["decision_date"] is None for c in cases)}


def build(root, output):
    sources, cases, laws = load_dataset(root)
    paragraphs, citations, topic_counts = validate(root, sources, cases, laws)
    verify_clean_sources(root)
    fingerprint = sha256(canonical([sources, cases, laws]).encode())
    output.parent.mkdir(parents=True, exist_ok=True)
    require(not output.is_symlink(), "output cannot be a symlink")
    if output.exists() and any(output.iterdir()):
        require((output / "manifest.json").is_file(), "nonempty output has no dataset manifest; choose an empty directory")
        require(read_json(output / "manifest.json").get("dataset_id") == DATASET_ID, "output belongs to another dataset")
    with tempfile.TemporaryDirectory(prefix=".public-data-build-", dir=output.parent) as temporary:
        stage = Path(temporary)
        for name, rows in (("sources", sources), ("cases", cases), ("laws", laws)):
            (stage / f"{name}.jsonl").write_text("".join(canonical(row) + "\n" for row in rows), encoding="utf-8")
        provisions = provision_records(laws)
        (stage / "provisions.jsonl").write_text("".join(canonical(row) + "\n" for row in provisions), encoding="utf-8")
        make_database(stage / "labor-public.sqlite", sources, cases, laws, citations, fingerprint)
        stats = dataset_counts(sources, cases, laws, paragraphs, citations, topic_counts)
        report = {"dataset_id": DATASET_ID, "data_fingerprint": fingerprint, "automated_validation": "PASS", "checks": ["raw_sha256", "offline_raw_to_clean_reextraction", "clean_text_snapshot", "case_exact_extracts", "unique_ids_and_source_bodies", "same_source_and_record_body_references", "law_link_names_and_version_uncertainty", "verbatim_selected_provisions", "required_fields_and_date_syntax", "no_claimed_original_exhibits", "sqlite_integrity_and_foreign_keys"], "counts": stats, "limits": ["自动检查验证结构、哈希和引用存在性，不证明每项语义正确。", "标注由 Agent 整理；独立技术复核另行记录，不代表法律专业审核。", "法规仅按已取得的发布版本保存，现行性限制见各条 status_note。", "本样例没有训练或运行多模态模型，没有真实用户证据原件。"]}
        json_file(stage / "quality-report.json", report)
        manifest = {"dataset_id": DATASET_ID, "schema_version": 1, "data_fingerprint": fingerprint, "counts": stats, "files": {p.name: {"sha256": sha256(p.read_bytes()), "bytes": p.stat().st_size} for p in sorted(stage.iterdir())}, "raw_sources": {s["raw_path"]: s["raw_sha256"] for s in sources}}
        json_file(stage / "manifest.json", manifest)
        output.mkdir(parents=True, exist_ok=True)
        # Only replace the tool's declared outputs, never remove unrelated files.
        for path in sorted(stage.iterdir(), key=lambda p: p.name == "manifest.json"):
            path.replace(output / path.name)
    return report


def verify(root, output):
    sources, cases, laws = load_dataset(root)
    paragraphs, citations, topic_counts = validate(root, sources, cases, laws)
    verify_clean_sources(root)
    manifest = read_json(output / "manifest.json")
    require(manifest["dataset_id"] == DATASET_ID, "wrong dataset manifest")
    fingerprint = sha256(canonical([sources, cases, laws]).encode())
    require(manifest["data_fingerprint"] == fingerprint, "curation changed; rebuild the release")
    expected_files = {"sources.jsonl", "cases.jsonl", "laws.jsonl", "provisions.jsonl", "labor-public.sqlite", "quality-report.json"}
    require(set(manifest["files"]) == expected_files, "manifest output file set mismatch")
    require(manifest["raw_sources"] == {s["raw_path"]: s["raw_sha256"] for s in sources}, "manifest raw source inventory mismatch")
    for filename, info in manifest["files"].items():
        path = local_path(output, filename)
        require(sha256(path.read_bytes()) == info["sha256"] and path.stat().st_size == info["bytes"], f"release artifact changed: {filename}")
    for name, expected in (("sources", sources), ("cases", cases), ("laws", laws), ("provisions", provision_records(laws))):
        actual = [json.loads(line) for line in (output / f"{name}.jsonl").read_text(encoding="utf-8").splitlines()]
        require(actual == expected, f"{name} JSONL does not match curation")
    counts = dataset_counts(sources, cases, laws, paragraphs, citations, topic_counts)
    require(manifest["counts"] == counts, "manifest counts differ from curation")
    report = read_json(output / "quality-report.json")
    require(report["counts"] == counts and report["data_fingerprint"] == fingerprint and report["automated_validation"] == "PASS", "quality report differs from curation")
    with connect(output) as conn:
        require(conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok", "corrupt SQLite")
        require(not conn.execute("PRAGMA foreign_key_check").fetchall(), "broken SQLite foreign keys")
        require(conn.execute("SELECT value FROM metadata WHERE key='data_fingerprint'").fetchone()[0] == fingerprint, "database fingerprint mismatch")
        for table, records in (("sources", sources), ("cases", cases), ("laws", laws)):
            actual = [json.loads(row[0]) for row in conn.execute(f"SELECT record_json FROM {table} ORDER BY id")]
            require(actual == records, f"database {table} differs from curation")
        # Rebuild independently and compare all logical tables, including derived indices.
        with tempfile.TemporaryDirectory(prefix="anxin-data-verify-") as temp:
            comparison = Path(temp) / "comparison.sqlite"
            _, citations, _ = validate(root, sources, cases, laws)
            make_database(comparison, sources, cases, laws, citations, fingerprint)
            with sqlite3.connect(comparison) as rebuilt:
                tables = [row[0] for row in rebuilt.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
                require(tables == [row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")], "database table inventory mismatch")
                schema_query = "SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name"
                require([tuple(row) for row in conn.execute(schema_query)] == rebuilt.execute(schema_query).fetchall(), "database schema differs from rebuilt candidate")
                for table in tables:
                    expected = sorted(rebuilt.execute(f'SELECT * FROM "{table}"').fetchall(), key=repr)
                    actual = sorted((tuple(row) for row in conn.execute(f'SELECT * FROM "{table}"')), key=repr)
                    require(actual == expected, f"derived database table changed: {table}")
    return {"status": "PASS", "data_fingerprint": fingerprint, "counts": manifest["counts"]}


@contextmanager
def connect(output):
    path = (output / "labor-public.sqlite").resolve()
    require(path.is_file(), "database missing; run build first")
    conn = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def search(output, query="", topic=None, kind="all", limit=5):
    require(topic is None or topic in TOPICS, "invalid topic")
    require(kind in {"all", "cases", "provisions"}, "invalid search kind")
    require(1 <= limit <= 100, "limit must be 1..100")
    terms = [term.casefold() for term in query.split() if term]
    clauses, args = [], []
    if topic:
        clauses.append("EXISTS (SELECT 1 FROM json_each(d.topics_json) WHERE value=?)")
        args.append(topic)
    if kind != "all":
        clauses.append("d.kind=?")
        args.append(kind)
    for term in terms:
        clauses.append("instr(lower(d.search_text), ?) > 0")
        args.append(term)
    where = " AND ".join(clauses) if clauses else "1=1"
    with connect(output) as conn:
        rows = conn.execute(f"SELECT d.*, s.url AS source_url FROM search_documents d JOIN sources s ON s.id=d.source_id WHERE {where}", args).fetchall()
        ranked = sorted(rows, key=lambda row: (-sum(3 * row["title"].casefold().count(t) + row["search_text"].casefold().count(t) for t in terms), row["id"]))
        results = []
        for row in ranked[:limit]:
            text = row["search_text"]
            first = min((text.casefold().find(t) for t in terms if t in text.casefold()), default=0)
            results.append({"id": row["id"], "kind": row["kind"], "title": row["title"], "topics": json.loads(row["topics_json"]), "region": row["region"], "source_url": row["source_url"], "excerpt": text[max(0, first - 40):first + 220]})
    return {"query": query, "topic": topic, "method": "deterministic_keyword_and_topic_filter_not_semantic_rag", "total_matches": len(rows), "results": results}


def get_record(output, record_id):
    with connect(output) as conn:
        for table in ("cases", "laws", "sources"):
            row = conn.execute(f"SELECT record_json FROM {table} WHERE id=?", (record_id,)).fetchone()
            if row:
                record = json.loads(row[0])
                refs = sorted({pid for _, values in all_refs(record) for pid in values})
                if table == "sources":
                    return record
                source = conn.execute("SELECT url,title FROM sources WHERE id=?", (record["source_id"],)).fetchone()
                return {"record": record, "source_url": source["url"], "source_title": source["title"], "cited_paragraphs": [dict(conn.execute("SELECT id,text FROM paragraphs WHERE id=?", (pid,)).fetchone()) for pid in refs]}
        row = conn.execute("SELECT p.*, l.source_id,l.title,l.version_label,l.issued_on,l.effective_on,l.expires_on,l.applicability_json,l.status_note,l.record_json,s.url FROM provisions p JOIN laws l ON l.id=p.law_id JOIN sources s ON s.id=l.source_id WHERE p.id=?", (record_id,)).fetchone()
        if row:
            result = dict(row)
            result["refs"] = json.loads(result.pop("refs_json"))
            result["topics"] = json.loads(result.pop("topics_json"))
            result["applicability"] = json.loads(result.pop("applicability_json"))
            result["annotation_status"] = json.loads(result.pop("record_json"))["annotation_status"]
            result["cited_paragraphs"] = [dict(conn.execute("SELECT id,text FROM paragraphs WHERE id=?", (pid,)).fetchone()) for pid in result["refs"]]
            return result
    raise DataError(f"record not found: {record_id}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--out", type=Path, help="release directory; default DATA_DIR/release")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("build", "verify", "stats"):
        commands.add_parser(name)
    query = commands.add_parser("search")
    query.add_argument("query", nargs="?", default="")
    query.add_argument("--topic", choices=sorted(TOPICS))
    query.add_argument("--kind", choices=["all", "cases", "provisions"], default="all")
    query.add_argument("--limit", type=int, default=5)
    detail = commands.add_parser("get")
    detail.add_argument("id")
    args = parser.parse_args()
    root = args.data_dir.resolve()
    output = args.out.absolute() if args.out else root / "release"
    try:
        if args.command == "build":
            result = build(root, output)
        elif args.command == "verify":
            result = verify(root, output)
        elif args.command == "stats":
            result = read_json(output / "manifest.json")["counts"]
        elif args.command == "search":
            result = search(output, args.query, args.topic, args.kind, args.limit)
        else:
            result = get_record(output, args.id)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except (DataError, OSError, KeyError, TypeError, json.JSONDecodeError, sqlite3.Error, subprocess.TimeoutExpired) as exc:
        parser.exit(1, f"public-data: {exc}\n")


if __name__ == "__main__":
    main()
