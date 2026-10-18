"""Load unchanged, frozen v1 modules without importing model runtimes."""
import importlib.util
from pathlib import Path
import sys

V1 = Path(__file__).resolve().parents[1] / "decision-baseline-v1"


def load(name, filename):
    path = V1 / filename
    if name in sys.modules:
        module = sys.modules[name]
        if Path(module.__file__).resolve() != path.resolve():
            raise RuntimeError(f"Module collision for frozen dependency: {name}")
        return module
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


common = load("common", "common.py")
runtime = load("decision_v1_runtime", "run.py")
evaluation = load("decision_v1_evaluation", "evaluate.py")
diagnostics = load("decision_v1_diagnostics", "diagnostics.py")
