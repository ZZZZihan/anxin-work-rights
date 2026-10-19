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
import importlib
import hashlib

GIB = 1024 ** 3


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
    return {'repository': manifest['repo_id'], 'revision': manifest['revision'], 'integrity_method': 'prior full hash plus current stat fingerprints', 'source_manifest_sha256': digest(integrity / 'source-manifest.json'), 'weights_verification_sha256': digest(integrity / 'weights-verification.json')}


def memory_snapshot():
    level = int(subprocess.check_output(['sysctl', '-n', 'kern.memorystatus_vm_pressure_level'], text=True))
    swap = subprocess.check_output(['sysctl', '-n', 'vm.swapusage'], text=True)
    match = re.search(r'used\s*=\s*([\d.]+)([MG])', swap)
    return {'pressure_level': level, 'swap_used_bytes': float(match[1]) * (1024 ** 2 if match[2] == 'M' else GIB)}


def qwen(args, records):
    if len(records) != 1:
        raise ValueError('Qwen requires one document per process')
    before = memory_snapshot()
    emit({'type': 'memory_before', **before})
    if before['pressure_level'] != 1:
        raise RuntimeError('initial_memory_pressure')
    verified = verify_model(args.model_path, args.integrity_dir)
    if verified['repository'] != 'mlx-community/Qwen3-32B-4bit' or verified['revision'] != 'bcaaf7f538adf166c1080a2befdb4f6019f66639':
        raise ValueError('Frozen Qwen identity mismatch')
    import mlx.core as mx
    from mlx_lm import load, stream_generate
    from mlx_lm.sample_utils import make_sampler
    from fact_memory_runtime import bounded_wired_context, snapshot
    generation = importlib.import_module("mlx_lm.generate")
    previous_wired_context = generation.wired_limit
    generation.wired_limit = bounded_wired_context(mx, lambda event: emit({**event, 'id': records[0]['id']}), 20 * GIB)
    try:
        if not mx.metal.is_available():
            raise RuntimeError('Metal unavailable')
        mx.set_default_device(mx.gpu)
        mx.set_memory_limit(24 * GIB)
        mx.set_wired_limit(20 * GIB)
        mx.set_cache_limit(512 * 1024 ** 2)
        mx.random.seed(123)
        emit(snapshot(mx, 'before_load'))
        start = time.perf_counter()
        model, tokenizer = load(str(args.model_path), lazy=False, trust_remote_code=False)
        mx.eval(model.parameters())
        mx.synchronize()
        emit({'type': 'load', 'id': records[0]['id'], 'seconds': time.perf_counter() - start, 'model': verified, 'packages': {p: metadata.version(p) for p in ['mlx', 'mlx-metal', 'mlx-lm', 'transformers']}})
        emit(snapshot(mx, 'after_load'))
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
            iterator = stream_generate(model, tokenizer, tokens, max_tokens=4096, sampler=make_sampler(temp=0.0), prefill_step_size=128, kv_bits=4, kv_group_size=64, quantized_kv_start=0, prompt_progress_callback=lambda done, total: emit(snapshot(mx, 'prefill', record['id'], processed=done, total=total)))
            try:
                for response in iterator:
                    if first is None:
                        first = time.perf_counter() - start
                        emit(snapshot(mx, 'first_token', record['id']))
                    parts.append(response.text)
                    if response.token not in tokenizer.eos_token_ids:
                        token_ids.append(response.token)
                    final = response
                    if time.perf_counter() - last_check >= 2:
                        sample = memory_snapshot()
                        now = time.perf_counter()
                        warning_since = (warning_since or now) if sample['pressure_level'] >= 2 else None
                        emit(snapshot(mx, 'generation', record['id'], elapsed=now - start))
                        if sample['pressure_level'] >= 4 or (warning_since and now - warning_since >= 10) or sample['swap_used_bytes'] - before['swap_used_bytes'] > 4 * GIB or now - start > 600:
                            emit({'type': 'result', 'id': record['id'], 'backend': 'qwen', 'raw_output': ''.join(parts), 'finish_reason': 'safety_stop'})
                            raise RuntimeError('memory_or_timeout_stop')
                        last_check = now
            finally:
                iterator.close()
            mx.synchronize()
            emit(snapshot(mx, 'after_generation', record['id']))
            if final is None:
                raise RuntimeError('No output')
            emit({'type': 'result', 'id': record['id'], 'backend': 'qwen', 'model': verified['repository'], 'raw_output': ''.join(parts), 'output_token_ids': token_ids, 'input_tokens': len(tokens), 'output_tokens': len(token_ids), 'finish_reason': final.finish_reason, 'latency_seconds': time.perf_counter() - start, 'ttft_seconds': first, 'mlx_peak_bytes': mx.get_peak_memory()})
        emit({'type': 'memory_after', **memory_snapshot()})
    finally:
        generation.wired_limit = previous_wired_context


def deepseek(args, records):
    from fact_api_transport import DeepSeekTransport, TransportError
    if args.key_file is None or args.key_file.stat().st_mode & 0o077:
        raise ValueError('Private credential file required')
    key = args.key_file.read_text().strip()
    transport = DeepSeekTransport(emit, connect_host=args.connect_host, connect_port=args.connect_port)
    reserve, failures = 0.0, 0
    for record in records:
        upper = sum(len(m['content'].encode()) for m in record['messages']) + 1024
        cost = upper * 1.32 / 1e6 + 4096 * 3.96 / 1e6
        if upper > 85000 or reserve + cost > 2.0:
            raise RuntimeError('predeclared_budget_or_input_limit')
        # Reserve even when server billing after a network failure is unknown.
        reserve += cost
        payload = json.dumps({'model': 'deepseek-v4-pro', 'messages': record['messages'], 'temperature': 0, 'max_tokens': 4096, 'stream': False, 'thinking': {'type': 'disabled'}}, ensure_ascii=False).encode()
        start = time.perf_counter()
        emit({'type': 'requesting', 'id': record['id'], 'payload_sha256': hashlib.sha256(payload).hexdigest(), 'reserved_usd_upper': cost})
        stop = False
        try:
            value, receipt = transport.post(payload, 'Bearer ' + key, record['id'])
            choice = value['choices'][0]
            row = {'raw_output': choice['message'].get('content') or '', 'finish_reason': choice['finish_reason'], 'response_model': value.get('model'), 'response_id': value.get('id'), 'system_fingerprint': value.get('system_fingerprint'), 'usage': value.get('usage'), 'transport_receipt': receipt}
        except TransportError as exc:
            failures += 1
            row = {'raw_output': '', 'finish_reason': 'request_error', **exc.safe_receipt}
            stop = row.get('http_status') in (400, 401, 402, 403, 404, 422) or row.get('error_type') == 'SSLCertVerificationError'
        except (KeyError, ValueError, TypeError, IndexError):
            failures += 1
            row = {'raw_output': '', 'finish_reason': 'invalid_response_schema', 'error_type': 'ResponseSchemaError'}
        emit({'type': 'result', 'id': record['id'], 'backend': 'deepseek', 'request_model': 'deepseek-v4-pro', 'latency_seconds': time.perf_counter() - start, **row})
        if stop or failures >= 3:
            emit({'type': 'outcome', 'completed': False, 'stop_reason': 'nonretryable_request_error' if stop else 'three_request_errors', 'reserved_peak_usd_upper': reserve})
            return 1
    emit({'type': 'outcome', 'completed': failures == 0, 'failures': failures, 'reserved_peak_usd_upper': reserve, 'actual_billed_cost': None})
    return int(failures != 0)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--backend', choices=['qwen', 'deepseek'], required=True)
    parser.add_argument('--model-path', type=Path)
    parser.add_argument('--integrity-dir', type=Path)
    parser.add_argument('--key-file', type=Path)
    parser.add_argument('--connect-host', default='api.deepseek.com')
    parser.add_argument('--connect-port', type=int, default=443)
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
        emit({'type': 'fatal', 'error_type': type(exc).__name__, 'category': getattr(exc, 'category', None)})
        sys.exit(1)
