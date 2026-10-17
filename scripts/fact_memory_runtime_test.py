"""Memory policy integration checks; fake MLX only, no weights or inference."""
import unittest
from unittest.mock import patch

from fact_memory_runtime import MemoryRuntimeError, bounded_wired_context, snapshot


class FakeMX:
    def __init__(self):
        self.wired = 9
        self.calls = []
        self.fail_sync = False

    def set_wired_limit(self, value):
        old, self.wired = self.wired, value
        self.calls.append(('set', value))
        return old

    def synchronize(self, *streams):
        self.calls.append(('sync', *streams))
        if self.fail_sync:
            raise ValueError('must not leak exception text')

    def get_memory_limit(self):
        return 24

    def get_active_memory(self):
        return 10

    def get_cache_memory(self):
        return 2

    def get_peak_memory(self):
        return 12


VM = 'Mach Virtual Memory Statistics: (page size of 16384 bytes)\n' + '\n'.join(
    f'{key}: {value}.' for value, key in enumerate([
        'Pages free', 'Pages active', 'Pages inactive', 'Pages speculative',
        'Pages wired down', 'Pages purgeable', 'File-backed pages',
        'Anonymous pages', 'Pages stored in compressor',
        'Pages occupied by compressor', 'Compressions', 'Decompressions',
        'Pageins', 'Pageouts', 'Swapins', 'Swapouts'], 1))


def command(argv, _category):
    if argv[-1] == 'kern.memorystatus_vm_pressure_level':
        return '1\n'
    if argv[-1] == 'vm.swapusage':
        return 'total = 2048.00M used = 123.50M free = 1924.50M (encrypted)'
    if argv[0] == '/usr/bin/vm_stat':
        return VM
    return '4567\n'


class WiredPolicyTests(unittest.TestCase):
    def test_entry_readback_and_stream_synchronization_before_restore(self):
        mx, events = FakeMX(), []
        with bounded_wired_context(mx, events.append, 20)({}, ['s1', 's2']):
            self.assertEqual(mx.wired, 20)
            self.assertEqual(events[0]['wired_observed_bytes'], 20)
            self.assertEqual(events[0]['allocator_guideline_bytes'], 24)
        self.assertEqual(mx.wired, 9)
        self.assertEqual(mx.calls, [('set', 20), ('set', 20),
                                   ('sync', 's1'), ('sync', 's2'), ('set', 9)])

    def test_body_exception_restores_after_global_sync(self):
        mx = FakeMX()
        with self.assertRaisesRegex(ValueError, '^body$'):
            with bounded_wired_context(mx, lambda _: None, 20)({}):
                raise ValueError('body')
        self.assertEqual(mx.wired, 9)
        self.assertEqual(mx.calls[-2:], [('sync',), ('set', 9)])

    def test_generator_close_restores(self):
        mx = FakeMX()

        def tokens():
            with bounded_wired_context(mx, lambda _: None, 20)({}, ['generation']):
                yield 1
                yield 2

        generator = tokens()
        self.assertEqual(next(generator), 1)
        self.assertEqual(mx.wired, 20)
        generator.close()
        self.assertEqual(mx.wired, 9)
        self.assertEqual(mx.calls[-2:], [('sync', 'generation'), ('set', 9)])

    def test_readback_mismatch_fails_closed_and_restores(self):
        mx = FakeMX()
        original = mx.set_wired_limit
        count = 0

        def mismatch(value):
            nonlocal count
            count += 1
            actual = original(value)
            return actual if count != 2 else 19

        mx.set_wired_limit = mismatch
        with self.assertRaisesRegex(MemoryRuntimeError, '^wired_readback_mismatch$'):
            with bounded_wired_context(mx, lambda _: None, 20)({}):
                self.fail('body must not run')
        self.assertEqual(mx.wired, 9)

    def test_sync_failure_still_attempts_restore_and_hides_details(self):
        mx = FakeMX()
        mx.fail_sync = True
        with self.assertRaisesRegex(MemoryRuntimeError, '^wired_synchronize_failed$'):
            with bounded_wired_context(mx, lambda _: None, 20)({}, ['s1', 's2']):
                pass
        self.assertEqual(mx.wired, 9)
        self.assertEqual(mx.calls[-3:], [('sync', 's1'), ('sync', 's2'), ('set', 9)])

    def test_unexpected_override_detected_after_restore(self):
        mx = FakeMX()
        with self.assertRaisesRegex(MemoryRuntimeError, '^wired_changed_during_generation$'):
            with bounded_wired_context(mx, lambda _: None, 20)({}):
                mx.set_wired_limit(51)
        self.assertEqual(mx.wired, 9)

    def test_emit_failure_also_restores(self):
        mx = FakeMX()

        def emit(_):
            raise OSError('output unavailable')

        with self.assertRaisesRegex(MemoryRuntimeError, '^memory_emit_failed$'):
            with bounded_wired_context(mx, emit, 20)({}):
                self.fail('body must not run')
        self.assertEqual(mx.wired, 9)


class SnapshotTests(unittest.TestCase):
    @patch('fact_memory_runtime._command', side_effect=command)
    def test_complete_metrics_and_wired_observation_without_setter(self, _):
        mx = FakeMX()
        first = snapshot(mx, 'loaded', case_id='dev-1', processed_tokens=128)
        self.assertIsNone(first['wired_observed_bytes'])
        self.assertEqual(first['wired_observation'], 'not_observed')
        with bounded_wired_context(mx, lambda _: None, 20)({}):
            before = list(mx.calls)
            value = snapshot(mx, 'prefill', case_id='dev-1', processed_tokens=128)
            self.assertEqual(mx.calls, before)
            self.assertEqual(value['wired_observed_bytes'], 20)
        self.assertEqual(value['type'], 'phase_memory')
        self.assertEqual(value['process_rss_bytes'], 4567 * 1024)
        self.assertEqual(value['swap_used_bytes'], 123.5 * 1024 ** 2)
        self.assertEqual(value['vm_stat']['compressor_occupied_bytes'], 10 * 16384)
        self.assertEqual(value['mlx_active_bytes'], 10)
        self.assertEqual(value['processed_tokens'], 128)

    @patch('fact_memory_runtime._command', return_value='secret malformed output')
    def test_invalid_observation_is_safe_category(self, _):
        with self.assertRaisesRegex(MemoryRuntimeError, '^pressure_invalid$'):
            snapshot(FakeMX(), 'prefill')

    @patch('fact_memory_runtime._command', side_effect=command)
    def test_missing_vm_counter_fails_closed(self, _):
        def missing_vm(argv, category):
            return command(argv, category).replace('Pageouts: 14.', '')

        with patch('fact_memory_runtime._command', side_effect=missing_vm):
            with self.assertRaisesRegex(MemoryRuntimeError, '^vm_stat_invalid$'):
                snapshot(FakeMX(), 'prefill')

    @patch('fact_memory_runtime._command', side_effect=command)
    def test_extra_cannot_overwrite_metrics(self, _):
        with self.assertRaisesRegex(MemoryRuntimeError, '^memory_extra_collision$'):
            snapshot(FakeMX(), 'prefill', pressure_level=1)


if __name__ == '__main__':
    unittest.main()
