#!/usr/bin/env python3
"""Capture official responses and deterministically extract their complete article text.

No third-party dependencies. Without --fetch this only rebuilds from saved HTML.
--fetch captures missing responses and compares existing frozen snapshots.
Changed responses are rejected; identical responses preserve saved metadata.
"""
import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.request import Request, urlopen

HERE = Path(__file__).resolve().parent
DATASET = HERE.parent.parent
CATALOG = [
    dict(id='case-src-spc-20250801-labor', url='https://www.court.gov.cn/zixun/xiangqing/472681.html',
         title='最高法发布劳动争议典型案例', publisher='最高人民法院（来源：最高人民法院新闻局）',
         published_on='2025-08-01', selector=('id', 'zoom')),
    dict(id='case-src-spc-20241223-wage', url='https://www.court.gov.cn/zixun/xiangqing/450661.html',
         title='依法惩治欠薪！最高人民法院发布涉欠薪纠纷典型案例', publisher='最高人民法院（来源：最高人民法院新闻局）',
         published_on='2024-12-23', selector=('id', 'zoom')),
    dict(id='case-src-spc-20240125-wage', url='https://www.court.gov.cn/zixun/xiangqing/423922.html',
         title='最高法 人社部 全总发布涉欠薪纠纷典型案例', publisher='最高人民法院（来源：最高人民法院新闻局）',
         published_on='2024-01-25', selector=('id', 'zoom')),
    dict(id='case-src-nanyang-20230609-third', url='https://rensheju.nanyang.gov.cn/2023/06-09/135971.html',
         title='人力资源社会保障部 最高人民法院关于联合发布第三批劳动人事争议典型案例的通知',
         publisher='南阳市人力资源和社会保障局（转载人力资源社会保障部、最高人民法院通知）',
         published_on='2023-06-09', selector=('id', 'mainCon')),
]

class ArticleParser(HTMLParser):
    """Keep selected article container; ignore scripts/styles and retain block order."""
    BLOCKS = {'p', 'br', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr'}
    def __init__(self, selector):
        super().__init__(convert_charrefs=True)
        self.key, self.value = selector
        self.depth = 0
        self.skip = 0
        self.buffer = []
        self.paragraphs = []
        self.found = False
    def flush(self):
        value = re.sub(r'\s+', ' ', ''.join(self.buffer)).strip()
        self.buffer = []
        if value:
            self.paragraphs.append(value)
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if self.depth == 0:
            matched = attrs.get(self.key) == self.value if self.key == 'id' else self.value in attrs.get('class', '').split()
            if tag == 'div' and matched:
                self.depth = 1
                self.found = True
            return
        if tag == 'div':
            self.depth += 1
            self.flush()
        if tag in {'script', 'style'}:
            self.skip += 1
        if tag in self.BLOCKS and not self.skip:
            self.flush()
    def handle_endtag(self, tag):
        if not self.depth:
            return
        if tag in {'script', 'style'}:
            self.skip = max(0, self.skip - 1)
        if tag in self.BLOCKS and not self.skip:
            self.flush()
        if tag == 'div':
            self.flush()
            self.depth -= 1
    def handle_data(self, value):
        if self.depth and not self.skip:
            self.buffer.append(value)

def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument('--fetch', action='store_true', help='GET official webpages; capture missing snapshots and refuse changes to existing snapshots')
    mode.add_argument('--verify-clean', action='store_true', help='read-only offline verification of saved raw against sources and clean')
    args = ap.parse_args()
    (HERE / 'raw').mkdir(exist_ok=True)
    (HERE / 'clean').mkdir(exist_ok=True)
    sources = []
    for config in CATALOG:
        sid = config['id']
        raw = HERE / 'raw' / (sid + '.html')
        meta_path = HERE / 'raw' / (sid + '.http.json')
        if args.fetch:
            request = Request(config['url'], headers={'User-Agent': 'Mozilla/5.0 (official-public-case-capture/1.0)'})
            with urlopen(request, timeout=45) as response:
                payload = response.read()
                content_type = response.headers.get('Content-Type', '')
                meta = dict(url=config['url'], final_url=response.url, status=response.status,
                            retrieved_at=datetime.now(timezone.utc).isoformat(),
                            content_type=content_type, acquisition_method='direct_http',
                            response_boundary='raw file is the unmodified HTTP response body; transport headers are recorded separately')
            if raw.exists():
                if raw.read_bytes() != payload:
                    raise ValueError(f'{sid}: response differs from frozen raw snapshot; refusing to overwrite saved bytes or metadata')
                if not meta_path.exists():
                    raise ValueError(f'{sid}: frozen raw snapshot has no saved HTTP metadata; refusing to invent its capture time')
                # An identical fetch is only a comparison. Preserve the original
                # capture metadata, including its actual retrieval timestamp.
            else:
                raw.write_bytes(payload)
                write_json(meta_path, meta)
        payload = raw.read_bytes()
        meta = json.loads(meta_path.read_text(encoding='utf-8'))
        parser = ArticleParser(config['selector'])
        parser.feed(payload.decode('utf-8'))
        parser.flush()
        if not parser.found or len(parser.paragraphs) < 20:
            raise ValueError(f'{sid}: missing or unexpectedly short article container')
        # Title and publication date are copied from the page title/date metadata;
        # the complete selected article body follows in original order.
        html = payload.decode('utf-8')
        if 'court.gov.cn' in config['url']:
            title_match = re.search(r'<div class="title">([^<]+)</div>', html)
            date_match = re.search(r'发布时间：([0-9-]+ [0-9:]+)', html)
            actual_title = title_match.group(1).strip() if title_match else None
            actual_date_text = '发布时间：' + date_match.group(1) if date_match else None
        else:
            title_match = re.search(r'<meta name="ArticleTitle" content="([^"]+)"', html)
            date_match = re.search(r'<meta name="PubDate" content="([^"]+)"', html)
            actual_title = title_match.group(1) if title_match else None
            actual_date_text = date_match.group(1) if date_match else None
        if actual_title != config['title'] or config['published_on'] not in (actual_date_text or ''):
            raise ValueError(f'{sid}: configured page metadata no longer matches saved response')
        texts = [actual_title, actual_date_text] + parser.paragraphs
        paragraphs = [dict(id=f'{sid}:p{i:04d}', text=t) for i, t in enumerate(texts, 1)]
        clean = HERE / 'clean' / (sid + '.txt')
        expected_clean = '\n\n'.join(texts) + '\n'
        if args.verify_clean:
            if clean.read_text(encoding='utf-8') != expected_clean:
                raise ValueError(f'{sid}: clean differs from raw extraction')
        else:
            clean.write_text(expected_clean, encoding='utf-8')
        sources.append(dict(id=sid, title=config['title'], url=config['url'], publisher=config['publisher'],
                            published_on=config['published_on'], retrieved_at=meta['retrieved_at'],
                            raw_path=str(raw.relative_to(DATASET)), raw_sha256=hashlib.sha256(payload).hexdigest(),
                            text_path=str(clean.relative_to(DATASET)), encoding='utf-8',
                            acquisition_method=meta['acquisition_method'],
                            usage_note='官方网页免费公开访问；未声明开放数据许可。保留发布机构、出处、原文快照，仅作可追溯研究样例，免费访问不代表任意再分发授权。该页为典型案例汇编，不是完整裁判文书或用户案卷；未采集任何当事人证据附件。',
                            paragraphs=paragraphs))
        print(sid, 'paragraphs=', len(paragraphs), 'bytes=', len(payload))
    if args.verify_clean:
        stored = json.loads((HERE / 'sources.json').read_text(encoding='utf-8'))
        if sources != stored:
            raise ValueError('sources.json differs from reproducible offline raw extraction')
        print('PASS: all source metadata, raw hashes, paragraphs and clean files match offline extraction')
    else:
        write_json(HERE / 'sources.json', sources)

if __name__ == '__main__':
    main()
