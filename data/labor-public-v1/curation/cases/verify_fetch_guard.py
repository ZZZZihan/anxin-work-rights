#!/usr/bin/env python3
"""Verify frozen-fetch behavior with mocked HTTP in a temporary local fixture.

No network requests and no changes to the delivered captures. Uses only stdlib;
explicit failures remain effective when Python runs with -O.
"""
import io
import json
import shutil
import sys
import tempfile
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
COLLECTOR = HERE / 'collect_sources.py'


def require(condition, message):
    if not condition:
        raise ValueError(message)


class Response:
    def __init__(self, url, payload):
        self.url = url
        self.status = 200
        self.headers = {'Content-Type': 'text/html; charset=utf-8'}
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        return self.payload


def main():
    namespace = {'__file__': str(COLLECTOR), '__name__': 'collector_guard_fixture'}
    exec(compile(COLLECTOR.read_text(encoding='utf-8'), str(COLLECTOR), 'exec'), namespace)
    configs = {c['url']: c for c in namespace['CATALOG']}

    def saved_response(request, timeout):
        config = configs[request.full_url]
        return Response(request.full_url, (HERE / 'raw' / (config['id'] + '.html')).read_bytes())

    def run(*args):
        with patch.object(sys, 'argv', [str(COLLECTOR), *args]), redirect_stdout(io.StringIO()):
            namespace['main']()

    with tempfile.TemporaryDirectory(prefix='.fetch-guard-', dir=HERE) as directory:
        fixture = Path(directory)
        shutil.copytree(HERE / 'raw', fixture / 'raw')
        namespace['HERE'] = fixture
        namespace['urlopen'] = saved_response
        run()
        before = {p.relative_to(fixture): p.read_bytes() for p in fixture.rglob('*') if p.is_file()}

        namespace['urlopen'] = lambda request, timeout: Response(request.full_url, b'changed response: offline test')
        try:
            run('--fetch')
        except ValueError as exc:
            require('refusing to overwrite' in str(exc), 'wrong rejection reason')
        else:
            raise ValueError('changed HTTP response was accepted')
        require(all((fixture / p).read_bytes() == data for p, data in before.items()), 'rejected fetch changed a fixture file')
        print('PASS: changed response rejected; frozen raw, HTTP metadata, clean and sources preserved')

        namespace['urlopen'] = saved_response
        run('--fetch')
        require(all((fixture / p).read_bytes() == data for p, data in before.items()), 'identical fetch changed a fixture file')
        print('PASS: identical responses preserved original bytes and capture timestamps')

        calls = []

        def selected_response(request, timeout):
            calls.append(request.full_url)
            return saved_response(request, timeout)

        namespace['urlopen'] = selected_response
        selected = next(iter(configs.values()))
        run('--fetch', '--source-id', selected['id'])
        require(calls == [selected['url']], 'source filter requested an unselected URL')
        require(all((fixture / p).read_bytes() == data for p, data in before.items()), 'filtered fetch changed a frozen fixture file')
        print('PASS: selected-source fetch requested only the selected URL; all frozen files preserved')

        # A distinct empty fixture exercises the only path allowed to save a new
        # response. Original dataset files remain read-only throughout the test.
        missing = fixture / 'missing'
        missing.mkdir()
        namespace['HERE'] = missing
        namespace['urlopen'] = saved_response
        namespace['CATALOG'] = [next(iter(configs.values()))]
        run('--fetch')
        config = namespace['CATALOG'][0]
        raw_name = config['id'] + '.html'
        require((missing / 'raw' / raw_name).read_bytes() == (HERE / 'raw' / raw_name).read_bytes(), 'missing snapshot did not save response bytes')
        meta_path = missing / 'raw' / (config['id'] + '.http.json')
        meta = json.loads(meta_path.read_text(encoding='utf-8'))
        require(meta['url'] == config['url'] and meta['retrieved_at'] and meta['acquisition_method'] == 'direct_http', 'new capture metadata is missing')
        print('PASS: missing snapshot saved response bytes and actual capture metadata')


if __name__ == '__main__':
    main()
