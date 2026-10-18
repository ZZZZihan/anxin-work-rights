"""Process-local MLX memory policy and fail-closed macOS observations.

The allocator limit is a guideline, not a hard allocation cap. Wired capacity
controls residency of existing allocations; it does not reserve that capacity.
No model is imported or loaded by this module.
"""
from contextlib import contextmanager
from datetime import datetime, timezone
import os
import re
import subprocess
from weakref import WeakKeyDictionary


class MemoryRuntimeError(RuntimeError):
    """A fixed, safe category; never includes command output or exception text."""

    def __init__(self, category):
        self.category = category
        super().__init__(category)


_WIRED_OBSERVED = WeakKeyDictionary()
_VM_FIELDS = {
    'free_pages': 'Pages free',
    'active_pages': 'Pages active',
    'inactive_pages': 'Pages inactive',
    'speculative_pages': 'Pages speculative',
    'wired_pages': 'Pages wired down',
    'purgeable_pages': 'Pages purgeable',
    'file_backed_pages': 'File-backed pages',
    'anonymous_pages': 'Anonymous pages',
    'compressor_stored_pages': 'Pages stored in compressor',
    'compressor_occupied_pages': 'Pages occupied by compressor',
    'compression_count': 'Compressions',
    'decompression_count': 'Decompressions',
    'pagein_count': 'Pageins',
    'pageout_count': 'Pageouts',
    'swapin_count': 'Swapins',
    'swapout_count': 'Swapouts',
}


def _integer(value, category):
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise MemoryRuntimeError(category)
    return value


def _command(argv, category):
    try:
        return subprocess.run(argv, check=True, capture_output=True, text=True,
                              timeout=2).stdout
    except Exception:
        raise MemoryRuntimeError(category) from None


def _vm_stat(text):
    page_match = re.search(r'page size of (\d+) bytes', text)
    counts = dict(re.findall(r'^([^:\n]+):\s+(\d+)\.?\s*$', text, re.MULTILINE))
    if not page_match or int(page_match[1]) <= 0:
        raise MemoryRuntimeError('vm_stat_invalid')
    try:
        value = {key: int(counts[label]) for key, label in _VM_FIELDS.items()}
    except (KeyError, ValueError):
        raise MemoryRuntimeError('vm_stat_invalid') from None
    value['page_size_bytes'] = int(page_match[1])
    value['wired_bytes'] = value['wired_pages'] * value['page_size_bytes']
    value['compressor_occupied_bytes'] = (
        value['compressor_occupied_pages'] * value['page_size_bytes'])
    return value


def bounded_wired_context(mx, emit, limit_bytes):
    """Return the replacement for ``mlx_lm.generate.wired_limit``.

    Install in a dedicated inference process before creating the generator.
    Close that generator in a finally block before restoring its module hook.
    The same-value readback happens before evaluation, never during async work.
    """
    _integer(limit_bytes, 'wired_limit_invalid')
    if limit_bytes == 0:
        raise MemoryRuntimeError('wired_limit_invalid')

    @contextmanager
    def bounded(_model, streams=None):
        try:
            previous = _integer(mx.set_wired_limit(limit_bytes), 'wired_previous_invalid')
        except MemoryRuntimeError:
            raise
        except Exception:
            raise MemoryRuntimeError('wired_limit_set_failed') from None

        try:
            try:
                observed = _integer(mx.set_wired_limit(limit_bytes), 'wired_readback_invalid')
            except MemoryRuntimeError:
                raise
            except Exception:
                raise MemoryRuntimeError('wired_readback_failed') from None
            if observed != limit_bytes:
                raise MemoryRuntimeError('wired_readback_mismatch')
            _WIRED_OBSERVED[mx] = observed
            try:
                guideline = _integer(mx.get_memory_limit(), 'allocator_guideline_invalid')
            except MemoryRuntimeError:
                raise
            except Exception:
                raise MemoryRuntimeError('mlx_memory_read_failed') from None
            try:
                emit({'type': 'wired_policy', 'wired_limit_bytes': limit_bytes,
                      'wired_observed_bytes': observed, 'previous_wired_bytes': previous,
                      'allocator_guideline_bytes': guideline,
                      'note': 'allocator_guideline_not_hard_cap; wired_capacity_not_reservation'})
            except Exception:
                raise MemoryRuntimeError('memory_emit_failed') from None
            yield
        finally:
            sync_error = False
            try:
                if streams:
                    for stream in streams:
                        try:
                            mx.synchronize(stream)
                        except Exception:
                            sync_error = True
                else:
                    try:
                        mx.synchronize()
                    except Exception:
                        sync_error = True
            finally:
                try:
                    before_restore = _integer(
                        mx.set_wired_limit(previous), 'wired_restore_readback_invalid')
                    _WIRED_OBSERVED[mx] = previous
                except MemoryRuntimeError:
                    _WIRED_OBSERVED.pop(mx, None)
                    raise
                except Exception:
                    _WIRED_OBSERVED.pop(mx, None)
                    raise MemoryRuntimeError('wired_restore_failed') from None
            if sync_error:
                raise MemoryRuntimeError('wired_synchronize_failed') from None
            if before_restore != limit_bytes:
                raise MemoryRuntimeError('wired_changed_during_generation') from None

    return bounded


def snapshot(mx, phase, case_id=None, **extra):
    """Collect observations or raise a safe category; never return partial data.

    Wired is the last successful setter observation in this helper, not a query
    of physical residency. It is null before the helper has observed a value.
    System and process counters are sampled sequentially, not atomically.
    """
    if not isinstance(phase, str) or not re.fullmatch(r'[a-z][a-z0-9_]{0,63}', phase):
        raise MemoryRuntimeError('memory_phase_invalid')
    pressure_text = _command(
        ['/usr/sbin/sysctl', '-n', 'kern.memorystatus_vm_pressure_level'],
        'pressure_read_failed').strip()
    if pressure_text not in {'1', '2', '4'}:
        raise MemoryRuntimeError('pressure_invalid')
    swap_text = _command(['/usr/sbin/sysctl', '-n', 'vm.swapusage'], 'swap_read_failed')
    swap_match = re.search(r'used\s*=\s*([\d.]+)([MG])(?:\s|$)', swap_text)
    if not swap_match:
        raise MemoryRuntimeError('swap_invalid')
    try:
        swap_used = float(swap_match[1]) * (1024 ** (2 if swap_match[2] == 'M' else 3))
        if not 0 <= swap_used < 2 ** 63:
            raise ValueError()
    except ValueError:
        raise MemoryRuntimeError('swap_invalid') from None
    vm = _vm_stat(_command(['/usr/bin/vm_stat'], 'vm_stat_read_failed'))
    rss_text = _command(['/bin/ps', '-o', 'rss=', '-p', str(os.getpid())], 'rss_read_failed').strip()
    if not rss_text.isdigit():
        raise MemoryRuntimeError('rss_invalid')
    try:
        stats = {
            'mlx_active_bytes': _integer(mx.get_active_memory(), 'mlx_active_invalid'),
            'mlx_cache_bytes': _integer(mx.get_cache_memory(), 'mlx_cache_invalid'),
            'mlx_peak_bytes': _integer(mx.get_peak_memory(), 'mlx_peak_invalid'),
            'allocator_guideline_bytes': _integer(mx.get_memory_limit(), 'allocator_guideline_invalid'),
        }
    except MemoryRuntimeError:
        raise
    except Exception:
        raise MemoryRuntimeError('mlx_memory_read_failed') from None
    result = {
        'type': 'phase_memory', 'phase': phase, 'case_id': case_id,
        'at': datetime.now(timezone.utc).isoformat(), 'pid': os.getpid(),
        **stats, 'wired_observed_bytes': _WIRED_OBSERVED.get(mx),
        'wired_observation': ('last_successful_setter_readback'
                              if mx in _WIRED_OBSERVED else 'not_observed'),
        'process_rss_bytes': int(rss_text) * 1024, 'pressure_level': int(pressure_text),
        'swap_used_bytes': swap_used, 'vm_stat': vm,
        'memory_note': 'allocator_guideline_not_hard_cap; RSS_not_exclusive_footprint',
    }
    if result.keys() & extra.keys():
        raise MemoryRuntimeError('memory_extra_collision')
    return {**result, **extra}
