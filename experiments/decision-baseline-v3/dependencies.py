"""Explicit unchanged v2 dependencies; no model loads or file reads of labels."""
import importlib.util
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
V2 = ROOT.parent / 'decision-baseline-v2'
V1 = ROOT.parent / 'decision-baseline-v1'
sys.path.insert(0, str(V2))

def load(name, path):
    if name in sys.modules:
        module = sys.modules[name]
        if Path(module.__file__).resolve() != path.resolve():
            raise RuntimeError('Dependency name collision')
        return module
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module

runtime = load('decision_v2_runtime_for_v3', V2 / 'run_comparison.py')
common = runtime.common
from protocol import ProtocolError, canonical_failure, parse_proposal, validate_proposal
from tool_control import MAX_ATTEMPTS, ToolController, calculate_wage_gap, preflight
# Imported dependency modules keep their explicit module identity. Restore the
# current experiment first so assess/freeze/run resolve to v3 in fresh CLIs.
if str(ROOT) in sys.path:
    sys.path.remove(str(ROOT))
sys.path.insert(0, str(ROOT))
