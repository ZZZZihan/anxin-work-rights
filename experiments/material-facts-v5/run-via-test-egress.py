"""Ephemeral loopback SSH egress; TLS and credentials stay in the local worker."""
import argparse
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--inputs', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--key-file', required=True)
    parser.add_argument('--mode', choices=['diagnostic', 'holdout'], required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    output = Path(args.out).resolve()
    if output.exists():
        raise ValueError('Output already exists')
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        port = probe.getsockname()[1]
    ssh = subprocess.Popen([
        'ssh', '-N', '-T', '-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes',
        '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15',
        '-o', 'ServerAliveCountMax=2', '-L',
        f'127.0.0.1:{port}:api.deepseek.com:443', 'carryz@172.23.1.127',
    ], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    child = None
    receipt = {'route': 'temporary_loopback_ssh_test_host', 'tls_host': 'api.deepseek.com',
               'credential_copied_to_server': False, 'global_network_changed': False,
               'started_at': time.time(), 'loopback_port': port}

    def cancel(_signum, _frame):
        raise KeyboardInterrupt()

    signal.signal(signal.SIGTERM, cancel)
    signal.signal(signal.SIGINT, cancel)
    try:
        ready = False
        for _ in range(100):
            if ssh.poll() is not None:
                raise RuntimeError('SSH forward stopped')
            try:
                with socket.create_connection(('127.0.0.1', port), timeout=0.2):
                    ready = True
                    break
            except OSError:
                time.sleep(0.1)
        if not ready:
            raise RuntimeError('SSH forward readiness timeout')
        child = subprocess.Popen([
            'node', str(Path(__file__).with_name('run.mjs')), '--backend', 'deepseek',
            '--mode', args.mode, '--inputs', args.inputs, '--out', args.out,
            '--key-file', args.key_file, '--connect-port', str(port),
        ], cwd=root, start_new_session=True)
        deadline = time.monotonic() + 2450
        while child.poll() is None:
            if ssh.poll() is not None or time.monotonic() >= deadline:
                raise RuntimeError('SSH or run deadline failure')
            time.sleep(0.25)
        receipt['runner_exit_code'] = child.returncode
        return child.returncode
    finally:
        if child is not None and child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
        if ssh.poll() is None:
            ssh.terminate()
            try:
                ssh.wait(timeout=5)
            except subprocess.TimeoutExpired:
                ssh.kill()
                ssh.wait()
        receipt.update({'ssh_closed': ssh.poll() is not None, 'ended_at': time.time()})
        if output.is_dir():
            (output / 'egress.json').write_text(json.dumps(receipt, indent=2) + '\n')


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (Exception, KeyboardInterrupt) as error:
        print(json.dumps({'egress_error_type': type(error).__name__}), flush=True)
        sys.exit(1)
