"""Data separation and decision contract; no model or training imports."""
import datetime as dt
from decimal import Decimal
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FIELDS = {"period", "agreed_due_total", "wage_paid_total"}
ACTIONS = {"ask_user", "call_tool", "report_tool_failure"}


def sha(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def read_jsonl(path):
    return [json.loads(line) for line in Path(path).read_text().splitlines() if line.strip()]


def save(path, obj):
    Path(path).write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n")


def append(path, obj):
    with Path(path).open("a") as f:
        f.write(json.dumps(obj, ensure_ascii=False) + "\n")


def visible(record):
    # Intentional allowlist; labels/category/group never enter model or rule input.
    if set(record) != {"id", "messages", "tool_state"}:
        raise ValueError("Inference record contains non-visible fields")
    if any(set(m) != {"role", "content"} or m["role"] not in {"user", "assistant"}
           or not isinstance(m["content"], str) for m in record["messages"]):
        raise ValueError("Invalid input messages")
    return {k: record[k] for k in ("id", "messages", "tool_state")}


def messages(record, prompt):
    r = visible(record)
    system = prompt + "\n运行器提供的tool_state：" + json.dumps(r["tool_state"], ensure_ascii=False)
    return [{"role": "system", "content": system}, *r["messages"]]


def parse_output(raw):
    try:
        return json.loads(raw), True
    except (ValueError, TypeError):
        text = raw.strip() if isinstance(raw, str) else ""
        if text.startswith("```json\n") and text.endswith("```"):
            text = text[8:-3]
        elif text.startswith("```\n") and text.endswith("```"):
            text = text[4:-3]
        else:
            return None, False
        try:
            return json.loads(text), False
        except ValueError:
            return None, False


def validate_output(obj):
    try:
        if not isinstance(obj, dict) or set(obj) != {"missing", "conflicts", "next_action"}:
            return False
        for key in ("missing", "conflicts"):
            value = obj[key]
            if not isinstance(value, list) or any(not isinstance(x, str) for x in value):
                return False
            if not set(value) <= FIELDS or len(value) != len(set(value)):
                return False
        if set(obj["missing"]) & set(obj["conflicts"]):
            return False
        action = obj["next_action"]
        if not isinstance(action, dict) or set(action) != {"type", "questions", "tool", "arguments"}:
            return False
        if action["type"] not in ACTIONS or not isinstance(action["questions"], list):
            return False
        qs = action["questions"]
        for q in qs:
            if not isinstance(q, dict) or set(q) != {"field", "text"} or q["field"] not in FIELDS:
                return False
            if not isinstance(q["text"], str) or not q["text"].strip():
                return False
        qfields = [q["field"] for q in qs]
        if len(qfields) != len(set(qfields)):
            return False
        if action["type"] == "ask_user":
            return (bool(qfields) and set(qfields) == set(obj["missing"]) | set(obj["conflicts"])
                    and action["tool"] is None and action["arguments"] is None)
        if obj["missing"] or obj["conflicts"] or qs:
            return False
        if action["type"] == "report_tool_failure":
            return action["tool"] is None and action["arguments"] is None
        args = action["arguments"]
        if action["tool"] != "calculate_wage_gap" or not isinstance(args, dict):
            return False
        if set(args) != {"period_start", "period_end", "due", "paid"}:
            return False
        start = dt.date.fromisoformat(args["period_start"])
        end = dt.date.fromisoformat(args["period_end"])
        if start.isoformat() != args["period_start"] or end.isoformat() != args["period_end"] or start > end:
            return False
        for key in ("due", "paid"):
            if type(args[key]) not in (int, float) or not Decimal(str(args[key])).is_finite() or args[key] < 0:
                return False
        return True
    except (KeyError, TypeError, ValueError):
        return False


def calculate(args):
    """Replay only the arithmetic proposal. No persistence, external tools, or legal conclusion."""
    return str(Decimal(str(args["due"])) - Decimal(str(args["paid"])))
