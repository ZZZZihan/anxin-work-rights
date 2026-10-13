#!/usr/bin/env python3
"""Collect official HTML snapshots; extraction is deterministic and offline by default."""
import argparse
import concurrent.futures
import hashlib
import json
import re
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATASET = ROOT.parent.parent
URLS = {
    "law-labor-2018": "https://www.gz.gov.cn/zt/jrshts/2021n/ldj/ldwqbms/content/post_7233064.html",
    "law-contract-2012": "https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/bgt/art/2023/art_0abfdd261c03417b949df19d869add8d.html",
    "law-arbitration-2007": "https://www.gjxfj.gov.cn/2007-12/29/c_139960598.htm",
    "law-relationship-2005": "https://hrss.jl.gov.cn/flfg/gjflfg/201609/t20160901_2424502.html",
    "law-wage-payment-1994": "https://www.gov.cn/zhengce/2022-08/31/content_5711284.htm",
    "law-migrant-wage-2019": "https://www.gov.cn/zhengce/zhengceku/2020-01/07/content_5467278.htm",
    "law-judicial-i-2020": "https://www.court.gov.cn/zixun/xiangqing/282121.html",
    "law-judicial-ii-2025": "https://www.court.gov.cn/fabu/xiangqing/472691.html",
}

class ParagraphParser(HTMLParser):
    """Split visible blocks while retaining original text and punctuation."""
    blocks = {"p", "div", "h1", "h2", "h3", "h4", "li", "tr", "td", "br", "section", "article"}
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.skip = 0
        self.buffer = []
        self.paragraphs = []
    def flush(self):
        value = re.sub(r"\s+", " ", "".join(self.buffer)).strip()
        if value:
            self.paragraphs.append(value)
        self.buffer = []
    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style", "noscript"}:
            self.skip += 1
        if not self.skip and tag in self.blocks:
            self.flush()
    def handle_endtag(self, tag):
        if tag in {"script", "style", "noscript"} and self.skip:
            self.skip -= 1
        elif not self.skip and tag in self.blocks:
            self.flush()
    def handle_data(self, data):
        if not self.skip:
            self.buffer.append(data)

def fetch(item):
    sid, url = item
    request = urllib.request.Request(url, headers={"User-Agent": "PublicLaborDataset/1.0 (single-page official-source archival)"})
    with urllib.request.urlopen(request, timeout=35) as response:
        raw = response.read()
        encoding = response.headers.get_content_charset()
        if not encoding:
            match = re.search(rb"charset\s*=\s*[\"']?\s*([\w-]+)", raw[:12000], re.I)
            encoding = match.group(1).decode("ascii") if match else "utf-8"
        raw_path = ROOT / "raw" / f"{sid}.html"
        raw_path.parent.mkdir(parents=True, exist_ok=True)
        if raw_path.exists():
            if raw_path.read_bytes() != raw:
                raise ValueError("Official response changed; refusing to overwrite frozen original snapshot. Recuration is required.")
            return json.loads((ROOT / "raw" / f"{sid}.http.json").read_text())
        raw_path.write_bytes(raw)
        metadata = {"id": sid, "requested_url": url, "response_url": response.url, "status": response.status,
                    "retrieved_at": datetime.now(timezone.utc).isoformat(), "encoding": encoding,
                    "content_type": response.headers.get("Content-Type"), "sha256": hashlib.sha256(raw).hexdigest(),
                    "bytes": len(raw)}
        (ROOT / "raw" / f"{sid}.http.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return metadata

def parse(sid):
    metadata = json.loads((ROOT / "raw" / f"{sid}.http.json").read_text())
    raw = (ROOT / "raw" / f"{sid}.html").read_bytes()
    if hashlib.sha256(raw).hexdigest() != metadata["sha256"]:
        raise ValueError(f"Original bytes do not match saved HTTP checksum: {sid}")
    text = raw.decode(metadata["encoding"], errors="strict")
    parser = ParagraphParser()
    parser.feed(text)
    parser.flush()
    return parser.paragraphs

def curate(verify=False):
    specifications = json.loads((ROOT / "selection.json").read_text(encoding="utf-8"))
    sources, laws = [], []
    for spec in specifications:
        sid = spec["source_id"]
        metadata = json.loads((ROOT / "raw" / f"{sid}.http.json").read_text(encoding="utf-8"))
        if metadata["sha256"] != spec["raw_sha256"]:
            raise ValueError(f"Frozen original hash mismatch: {sid}")
        visible = parse(sid)
        indices = spec["paragraph_indices"]
        selected = [visible[index] for index in indices]
        if selected[0] != spec["first_paragraph"] or selected[-1] != spec["last_paragraph"]:
            raise ValueError(f"Selected body boundary mismatch: {sid}")
        paragraphs = [{"id": f"{sid}:p{index + 1:04d}", "text": value} for index, value in enumerate(selected)]
        id_by_visible_index = dict(zip(indices, [p["id"] for p in paragraphs]))
        text_path = ROOT / "clean" / f"{sid}.txt"
        clean = "\n\n".join(p["text"] for p in paragraphs) + "\n"
        if verify:
            if text_path.read_text(encoding="utf-8") != clean:
                raise ValueError(f"Clean mismatch: {sid}")
        else:
            text_path.parent.mkdir(parents=True, exist_ok=True)
            text_path.write_text(clean, encoding="utf-8")
        source = {"id": sid, "title": spec.get("source_title", spec["title"]), "url": metadata["response_url"], "publisher": spec["publisher"],
                  "published_on": spec["published_on"], "retrieved_at": metadata["retrieved_at"],
                  "raw_path": str((ROOT / "raw" / f"{sid}.html").relative_to(DATASET)), "raw_sha256": metadata["sha256"],
                  "text_path": str(text_path.relative_to(DATASET)), "encoding": metadata["encoding"],
                  "acquisition_method": "direct_http", "usage_note": spec["usage_note"], "paragraphs": paragraphs}
        sources.append(source)
        matcher = r"^(第[一二三四五六七八九十百零〇]+条)" if not spec.get("numbered_items") else r"^([一二三四五]、)"
        groups, active = {}, None
        body_ids = {id_by_visible_index[i] for i in spec["body_indices"]}
        for paragraph in paragraphs:
            if paragraph["id"] not in body_ids:
                continue
            value = paragraph["text"]
            match = re.match(matcher, value)
            if match:
                active = match.group(1)
                groups[active] = []
            elif re.match(r"^第[一二三四五六七八九十百零〇]+[章节]", value):
                active = None
            if active:
                groups[active].append(paragraph)
        articles = []
        for number, entry in enumerate(spec["articles"], 1):
            label = entry["label"]
            refs = groups[label]
            articles.append({"id": f"{spec['id']}:a{number:03d}", "label": label,
                             "text": "\n".join(p["text"] for p in refs), "refs": [p["id"] for p in refs], "topics": entry["topics"]})
        source_refs = [id_by_visible_index[i] for i in spec["metadata_indices"]]
        source_refs += [p for article in articles for p in article["refs"]]
        law = {key: spec[key] for key in ["id", "source_id", "title", "instrument_type", "version_label", "issued_on", "effective_on", "expires_on", "applicability", "status_note"]}
        if "original_effective_on" in spec:
            law["original_effective_on"] = spec["original_effective_on"]
        law.update({"source_refs": list(dict.fromkeys(source_refs)), "articles": articles,
                    "annotation_status": "agent_curated_not_legal_expert_reviewed"})
        laws.append(law)
    for filename, value in [("sources.json", sources), ("laws.json", laws)]:
        serialized = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
        path = ROOT / filename
        if verify:
            if path.read_text(encoding="utf-8") != serialized:
                raise ValueError(f"Curation mismatch: {filename}")
        else:
            path.write_text(serialized, encoding="utf-8")
    print("Verified" if verify else "Curated", len(sources), "sources;", len(laws), "laws;", sum(len(x["articles"]) for x in laws), "selected articles")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fetch", action="store_true", help="Explicitly refresh official HTTP snapshots")
    ap.add_argument("--inspect", action="store_true", help="Print paragraph indices before curation")
    ap.add_argument("--verify-clean", action="store_true", help="Offline recompute and byte-compare clean text and JSON from frozen original HTTP snapshots")
    args = ap.parse_args()
    if args.fetch:
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            pending = {pool.submit(fetch, item): item[0] for item in URLS.items()}
            failures = []
            for future in concurrent.futures.as_completed(pending):
                sid = pending[future]
                try:
                    result = future.result()
                    print(sid, result["status"], result["bytes"])
                except Exception as exc:
                    failures.append({"id": sid, "url": URLS[sid], "error": str(exc), "attempted_at": datetime.now(timezone.utc).isoformat()})
                    print(sid, "FAILED", str(exc))
            failure_path = ROOT / "fetch_failures.json"
            previous_failures = json.loads(failure_path.read_text(encoding="utf-8")) if failure_path.exists() else []
            failure_path.write_text(json.dumps(previous_failures + failures, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            if failures:
                failed_ids = ", ".join(failure["id"] for failure in failures)
                raise SystemExit(f"Fetch failed for {failed_ids}; preserved frozen data, no recuration performed. See fetch_failures.json.")
    if args.inspect:
        for sid in URLS:
            if (ROOT / "raw" / f"{sid}.html").exists():
                print("SOURCE", sid)
                for i, value in enumerate(parse(sid)):
                    print(i, value)
    elif (ROOT / "selection.json").exists():
        curate(verify=args.verify_clean)

if __name__ == "__main__":
    main()
