"""Bounded inference only. JSONL messages in; first response/error receipts out. No training."""
import argparse
import importlib.metadata as metadata
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
import hashlib

GIB = 1024 ** 3


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None



def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify_model(model, integrity):
    manifest = json.loads((integrity / 'source-manifest.json').read_text())
    verification = json.loads((integrity / 'weights-verification.json').read_text())
    if not verification['all_ok'] or verification['revision'] != manifest['revision']:
        raise ValueError('Model verification incomplete')
    if Path(verification['model_dir']).resolve() != model.resolve() or verification['manifest_sha256'] != digest(integrity / 'source-manifest.json'):
        raise ValueError('Model verification mismatch')
    for item in verification['files']:
        st = (model / item['path']).stat()
        if [st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns, st.st_ctime_ns] != item['stat_fingerprint']:
            raise ValueError('Model files changed since full hash verification')
    return {'repository': manifest['repo_id'], 'revision': manifest['revision'], 'integrity_method': 'prior full hash plus current stat fingerprints'}


def memory_snapshot():
    level = int(subprocess.check_output(['sysctl', '-n', 'kern.memorystatus_vm_pressure_level'], text=True))
    swap = subprocess.check_output(['sysctl', '-n', 'vm.swapusage'], text=True)
    match = re.search(r'used\s*=\s*([\d.]+)([MG])', swap)
    return {'pressure_level': level, 'swap_used_bytes': float(match[1]) * (1024 ** 2 if match[2] == 'M' else GIB)}


def qwen(args, records):
    before = memory_snapshot()
    emit({'type': 'memory_before', **before})
    if before['pressure_level'] != 1:
        raise RuntimeError('initial_memory_pressure')
    verified = verify_model(args.model_path, args.integrity_dir)
    import mlx.core as mx
    from mlx_lm import load, stream_generate
    from mlx_lm.sample_utils import make_sampler
    if not mx.metal.is_available():
        raise RuntimeError('Metal unavailable')
    mx.set_default_device(mx.gpu)
    mx.set_memory_limit(24 * GIB)
    mx.set_wired_limit(20 * GIB)
    mx.set_cache_limit(512 * 1024 ** 2)
    mx.random.seed(123)
    start = time.perf_counter()
    model, tokenizer = load(str(args.model_path), lazy=False, trust_remote_code=False)
    mx.eval(model.parameters())
    mx.synchronize()
    emit({'type': 'load', 'seconds': time.perf_counter() - start, 'model': verified, 'packages': {p: metadata.version(p) for p in ['mlx', 'mlx-metal', 'mlx-lm', 'transformers']}})
    for record in records:
        mx.clear_cache()
        mx.reset_peak_memory()
        rendered = tokenizer.apply_chat_template(record['messages'], tokenize=False, add_generation_prompt=True, enable_thinking=False)
        if not rendered.endswith('<think>\n\n</think>\n\n'):
            raise ValueError('Non-thinking template not confirmed')
        tokens = tokenizer.encode(rendered, add_special_tokens=False)
        if len(tokens) + 4096 > 12288:
            emit({'type': 'result', 'id': record['id'], 'backend': 'qwen', 'raw_output': '', 'finish_reason': 'context_limit'})
            continue
        emit({'type': 'generating', 'id': record['id'], 'input_tokens': len(tokens)})
        start = last_check = time.perf_counter()
        warning_since = None
        parts, token_ids, first, final = [], [], None, None
        for response in stream_generate(model, tokenizer, tokens, max_tokens=4096, sampler=make_sampler(temp=0.0), prefill_step_size=128, kv_bits=4, kv_group_size=64, quantized_kv_start=0):
            if first is None:
                first = time.perf_counter() - start
            parts.append(response.text)
            if response.token not in tokenizer.eos_token_ids:
                token_ids.append(response.token)
            final = response
            if time.perf_counter() - last_check >= 2:
                sample = memory_snapshot()
                now = time.perf_counter()
                warning_since = (warning_since or now) if sample['pressure_level'] >= 2 else None
                emit({'type': 'telemetry', 'id': record['id'], 'elapsed': now - start, **sample})
                if sample['pressure_level'] >= 4 or (warning_since and now - warning_since >= 10) or sample['swap_used_bytes'] - before['swap_used_bytes'] > 4 * GIB or now - start > 600:
                    emit({'type': 'result', 'id': record['id'], 'backend': 'qwen', 'raw_output': ''.join(parts), 'finish_reason': 'safety_stop'})
                    raise RuntimeError('memory_or_timeout_stop')
                last_check = now
        mx.synchronize()
        if final is None:
            raise RuntimeError('No output')
        emit({'type': 'result', 'id': record['id'], 'backend': 'qwen', 'model': verified['repository'], 'raw_output': ''.join(parts), 'output_token_ids': token_ids, 'input_tokens': len(tokens), 'output_tokens': len(token_ids), 'finish_reason': final.finish_reason, 'latency_seconds': time.perf_counter() - start, 'ttft_seconds': first, 'mlx_peak_bytes': mx.get_peak_memory()})
    emit({'type': 'memory_after', **memory_snapshot()})


def deepseek(args, records):
    if args.key_file is None or args.key_file.stat().st_mode & 0o077:
        raise ValueError('Private credential file required')
    key = args.key_file.read_text().strip()
    reserve, failures = 0.0, 0
    for record in records:
        # UTF-8 bytes are a conservative token upper bound, with overhead reserved.
        upper = sum(len(m['content'].encode()) for m in record['messages']) + 1024
        cost = upper * 1.32 / 1e6 + 4096 * 3.96 / 1e6
        if upper > 85000 or reserve + cost > 2.0:
            raise RuntimeError('predeclared_budget_or_input_limit')
        reserve += cost
        request = urllib.request.Request('https://api.deepseek.com/chat/completions', data=json.dumps({'model': 'deepseek-v4-pro', 'messages': record['messages'], 'temperature': 0, 'max_tokens': 4096, 'stream': False, 'thinking': {'type': 'disabled'}}, ensure_ascii=False).encode(), headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key})
        start = time.perf_counter()
        emit({'type': 'requesting', 'id': record['id']})
        try:
            with urllib.request.build_opener(NoRedirect()).open(request, timeout=120) as response:
                value = json.load(response)
            choice = value['choices'][0]
            row = {'raw_output': choice['message'].get('content') or '', 'finish_reason': choice['finish_reason'], 'response_model': value.get('model'), 'response_id': value.get('id'), 'system_fingerprint': value.get('system_fingerprint'), 'usage': value.get('usage')}
        except (urllib.error.URLError, TimeoutError, KeyError, ValueError) as exc:
            failures += 1
            row = {'raw_output': '', 'finish_reason': 'request_error', 'error_type': type(exc).__name__, 'http_status': getattr(exc, 'code', None)}
        emit({'type': 'result', 'id': record['id'], 'backend': 'deepseek', 'request_model': 'deepseek-v4-pro', 'latency_seconds': time.perf_counter() - start, **row})
        if failures >= 3:
            emit({'type': 'outcome', 'completed': False, 'stop_reason': 'three_request_errors', 'reserved_peak_usd_upper': reserve})
            return 1
    emit({'type': 'outcome', 'completed': True, 'failures': failures, 'reserved_peak_usd_upper': reserve, 'actual_billed_cost': None})
    return 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--backend', choices=['qwen', 'deepseek'], required=True)
    parser.add_argument('--model-path', type=Path)
    parser.add_argument('--integrity-dir', type=Path)
    parser.add_argument('--key-file', type=Path)
    args = parser.parse_args()
    records = [json.loads(line) for line in sys.stdin if line.strip()]
    if not 1 <= len(records) <= 12 or len({row['id'] for row in records}) != len(records):
        raise ValueError('Invalid batch')
    return qwen(args, records) or 0 if args.backend == 'qwen' else deepseek(args, records)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as exc:
        # No exception text: urllib errors and process paths may contain sensitive data.
        emit({'type': 'fatal', 'error_type': type(exc).__name__})
        sys.exit(1)
