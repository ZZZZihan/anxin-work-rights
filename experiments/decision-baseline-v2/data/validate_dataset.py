#!/usr/bin/env python3
"""Validate only this independently authored synthetic holdout, offline."""
from __future__ import annotations

import collections
import datetime as dt
import hashlib
import importlib.util
import json
import re
import sys
import uuid
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CATEGORIES = {
    'missing_period', 'missing_due', 'payment_attribution', 'complete',
    'mixed_payment', 'conflict', 'multi_turn', 'tool_failure',
}
FIELDS = ('period', 'agreed_due_total', 'wage_paid_total')
ERRORS: list[str] = []


def check(condition, message):
    if not condition:
        ERRORS.append(message)


def no_duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f'duplicate JSON key {key!r}')
        result[key] = value
    return result


def read_jsonl(name):
    result = []
    for line_number, line in enumerate((ROOT / name).read_text(encoding='utf-8').splitlines(), 1):
        check(bool(line.strip()), f'{name}:{line_number}: blank line')
        try:
            value = json.loads(line, object_pairs_hook=no_duplicate_keys,
                               parse_constant=lambda s: (_ for _ in ()).throw(ValueError(s)))
        except (json.JSONDecodeError, ValueError) as exc:
            ERRORS.append(f'{name}:{line_number}: {exc}')
            continue
        check(isinstance(value, dict), f'{name}:{line_number}: record is not object')
        result.append(value)
    return result


def finite_amount(value):
    return type(value) in (int, float) and Decimal(str(value)).is_finite()


def source_contains_amount(text, value):
    # A full numeric token is required: a 0 hidden inside a year is insufficient.
    number = re.escape(str(value))
    return bool(re.search(r'(?<![\d.])' + number + r'(?![\d.])\s*元', text))


def main():
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location('sealed_authoring_source', ROOT / 'build_dataset.py')
    author = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(author)
    authored = {c['id']: c for c in author.CASES}
    inputs = read_jsonl('test.inputs.jsonl')
    labels = read_jsonl('test.labels.jsonl')
    check(len(inputs) == len(labels) == len(authored) == 72, 'record counts must all be 72')
    ids = [r.get('id') for r in inputs]
    label_ids = [r.get('id') for r in labels]
    check(len(set(ids)) == len(ids), 'input IDs must be unique')
    check(len(set(label_ids)) == len(label_ids), 'label IDs must be unique')
    check(set(ids) == set(label_ids) == set(authored), 'input, label and source IDs must match')
    check(ids == label_ids, 'input and label record order must match')
    by_label = {r['id']: r for r in labels}
    group_sizes = collections.Counter(r.get('group_id') for r in labels)
    check(len(group_sizes) == 36 and set(group_sizes.values()) == {2}, 'must have exactly 36 two-record groups')
    for group_id in group_sizes:
        try:
            check(str(uuid.UUID(group_id)) == group_id, f'{group_id}: group ID is not opaque canonical UUID')
        except (ValueError, TypeError):
            ERRORS.append(f'{group_id}: invalid group ID')
    seen_payloads = set()
    actions = collections.Counter()
    categories = collections.Counter()
    states = collections.Counter()
    multi_turn = 0
    amount_audits = 0
    full_dates_checked = 0
    pairs = collections.defaultdict(list)
    for record in inputs:
        ident = record.get('id')
        prefix = f'{ident}: '
        check(set(record) == {'id', 'messages', 'tool_state'}, prefix + 'inference input schema differs')
        try:
            check(str(uuid.UUID(ident)) == ident, prefix + 'input ID is not opaque canonical UUID')
        except (ValueError, TypeError):
            ERRORS.append(prefix + 'invalid ID')
        messages = record.get('messages')
        check(isinstance(messages, list) and len(messages) >= 1, prefix + 'messages must be nonempty list')
        if not isinstance(messages, list):
            continue
        text = '\n'.join(m.get('content', '') for m in messages)
        check(messages[0].get('role') == 'user' and messages[-1].get('role') == 'user', prefix + 'snapshots must begin/end with user')
        for mi, message in enumerate(messages):
            check(set(message) == {'role', 'content'}, prefix + 'message schema differs')
            check(message.get('role') in {'user', 'assistant'}, prefix + 'invalid message role')
            check(isinstance(message.get('content'), str) and bool(message['content'].strip()), prefix + 'empty message text')
            if mi:
                check(message['role'] != messages[mi-1]['role'], prefix + 'conversation roles do not alternate')
        if len(messages) >= 3:
            multi_turn += 1
        state = record.get('tool_state')
        if state is None:
            states['null'] += 1
        else:
            check(set(state) == {'status', 'attempts', 'max_attempts'}, prefix + 'tool state schema differs')
            check(state.get('status') == 'TIMEOUT', prefix + 'unexpected tool status')
            check(type(state.get('attempts')) is int and state['attempts'] in (1, 2), prefix + 'unexpected attempts')
            check(type(state.get('max_attempts')) is int and state['max_attempts'] == 2, prefix + 'unexpected max_attempts')
            states[f'TIMEOUT:{state.get("attempts")}/2'] += 1
        payload = json.dumps({'messages': messages, 'tool_state': state}, ensure_ascii=False, sort_keys=True)
        check(payload not in seen_payloads, prefix + 'duplicate inference payload')
        seen_payloads.add(payload)
        for token in re.findall(r'(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)', text):
            try:
                dt.date.fromisoformat(token)
                full_dates_checked += 1
            except ValueError:
                ERRORS.append(prefix + f'invalid full date literal {token}')
        label = by_label.get(ident)
        if label is None:
            continue
        check(set(label) == {'id', 'split', 'group_id', 'category', 'synthetic', 'provenance', 'expected', 'rationale'}, prefix + 'label schema differs')
        check(label.get('split') == 'test', prefix + 'wrong split')
        check(label.get('synthetic') is True and label.get('provenance') == 'agent_authored_synthetic', prefix + 'synthetic provenance missing')
        check(label.get('category') in CATEGORIES, prefix + 'unknown category')
        check(isinstance(label.get('rationale'), str) and len(label['rationale'].strip()) >= 10, prefix + 'missing rationale')
        categories[label.get('category')] += 1
        pairs[label['group_id']].append(record)
        gold = label.get('expected')
        check(isinstance(gold, dict) and set(gold) == {'missing', 'conflicts', 'next_action'}, prefix + 'expected top-level schema differs')
        if not isinstance(gold, dict):
            continue
        missing, conflicts = gold.get('missing'), gold.get('conflicts')
        check(isinstance(missing, list) and len(set(missing)) == len(missing) and set(missing) <= set(FIELDS), prefix + 'invalid missing fields')
        check(isinstance(conflicts, list) and len(set(conflicts)) == len(conflicts) and set(conflicts) <= set(FIELDS), prefix + 'invalid conflict fields')
        check(not (set(missing) & set(conflicts)), prefix + 'same field cannot be missing and conflicting')
        action = gold.get('next_action', {})
        check(set(action) == {'type', 'questions', 'tool', 'arguments'}, prefix + 'next_action schema differs')
        typ = action.get('type')
        actions[typ] += 1
        questions = action.get('questions')
        check(isinstance(questions, list), prefix + 'questions must be list')
        if typ == 'ask_user':
            check(set(missing) | set(conflicts), prefix + 'ask_user without unknown/conflicting field')
            check(action.get('tool') is None and action.get('arguments') is None, prefix + 'ask_user must not call tool')
            qfields = []
            for question in questions:
                check(set(question) == {'field', 'text'}, prefix + 'question schema differs')
                check(question.get('field') in FIELDS, prefix + 'question field invalid')
                check(isinstance(question.get('text'), str) and bool(question['text'].strip()), prefix + 'question text empty')
                qfields.append(question.get('field'))
            check(len(qfields) == len(set(qfields)) and set(qfields) == set(missing) | set(conflicts), prefix + 'questions must cover exactly missing union conflicts')
        elif typ == 'call_tool':
            check(not missing and not conflicts and questions == [], prefix + 'call_tool has unresolved fields/questions')
            check(action.get('tool') == 'calculate_wage_gap', prefix + 'incorrect tool')
            arguments = action.get('arguments')
            check(isinstance(arguments, dict) and set(arguments) == {'period_start', 'period_end', 'due', 'paid'}, prefix + 'argument schema differs')
            if not isinstance(arguments, dict):
                continue
            try:
                start = dt.date.fromisoformat(arguments['period_start'])
                end = dt.date.fromisoformat(arguments['period_end'])
                check(start <= end, prefix + 'period end precedes start')
                check(arguments['period_start'] in text and arguments['period_end'] in text, prefix + 'complete period is not grounded in conversation')
            except (ValueError, TypeError, KeyError):
                ERRORS.append(prefix + 'invalid call dates')
            check(finite_amount(arguments.get('due')) and finite_amount(arguments.get('paid')), prefix + 'amounts must be finite JSON numbers, not booleans')
            ledger = authored[ident].get('audit')
            check(isinstance(ledger, dict), prefix + 'complete case lacks decimal arithmetic audit')
            if ledger:
                amount_audits += 1
                due = Decimal(ledger['confirmed_due'])
                parts = [Decimal(p) for p in ledger['wage_parts']]
                paid = sum(parts, Decimal('0'))
                check(Decimal(str(arguments['due'])) == due, prefix + 'due differs from authored confirmation')
                check(Decimal(str(arguments['paid'])) == paid, prefix + 'paid differs from exact sum of confirmed wage components')
                check(due - paid == Decimal(ledger['expected_gap']), prefix + 'gap decimal arithmetic incorrect')
                for amount in [ledger['confirmed_due'], *ledger['wage_parts'], *ledger['excluded_from_period_wages']]:
                    check(source_contains_amount(text, amount), prefix + f'audited amount {amount} absent as explicit yuan token')
                check(due.as_tuple().exponent >= -2 and all(p.as_tuple().exponent >= -2 for p in parts), prefix + 'amount exceeds cent precision')
        elif typ == 'report_tool_failure':
            check(state is not None and state.get('status') == 'TIMEOUT' and state.get('attempts', 0) >= state.get('max_attempts', 1), prefix + 'failure lacks exhausted trusted timeout')
            check(not missing and not conflicts and questions == [] and action.get('tool') is None and action.get('arguments') is None, prefix + 'failure must be terminal without questions/tool arguments')
        else:
            ERRORS.append(prefix + 'unknown action type')
        if state is not None and state['attempts'] >= state['max_attempts']:
            check(typ == 'report_tool_failure', prefix + 'exhausted trusted timeout did not terminate')
        if state is not None and state['attempts'] < state['max_attempts']:
            check(typ in {'call_tool', 'ask_user'}, prefix + 'remaining attempt incorrectly treated as exhausted')
        source = authored[ident]
        check(messages == source['messages'] and state == source['tool_state'], prefix + 'input differs from independent authored source')
        check(gold == source['expected'] and label['category'] == source['category'] and label['rationale'] == source['rationale'] and label['group_id'] == source['group_id'], prefix + 'label differs from authored source')
    check(states == {'null': 56, 'TIMEOUT:2/2': 8, 'TIMEOUT:1/2': 8}, 'trusted tool-state distribution differs')
    check(actions == {'call_tool': 30, 'ask_user': 34, 'report_tool_failure': 8}, 'action distribution differs from requested 30/34/8')
    check(multi_turn >= 12, 'must contain at least 12 multi-turn snapshots')
    check(full_dates_checked >= 120, 'full date token checks unexpectedly absent or too few')
    check(amount_audits == 30, 'every call must have a decimal ledger check')
    trusted_pairs = 0
    for group_id, group_records in pairs.items():
        if any(r['tool_state'] is not None for r in group_records):
            trusted_pairs += 1
            check(group_records[0]['messages'] == group_records[1]['messages'], f'{group_id}: state contrast changed messages')
            check(sorted(r['tool_state']['attempts'] for r in group_records) == [1, 2], f'{group_id}: state pair does not isolate attempt count')
        else:
            check(group_records[0]['messages'] != group_records[1]['messages'], f'{group_id}: language contrast is identical')
    check(trusted_pairs == 8, 'must have eight trusted-state contrast groups')
    artifact_names = ['test.inputs.jsonl', 'test.labels.jsonl', 'AUTHORING.md', 'build_dataset.py', 'validate_dataset.py']
    hashes = {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in artifact_names}
    joined = b''.join((ROOT / name).read_bytes() for name in ['test.inputs.jsonl', 'test.labels.jsonl'])
    result = {
        'status': 'pass' if not ERRORS else 'fail',
        'record_count': len(inputs), 'group_count': len(group_sizes),
        'group_sizes': dict(sorted(collections.Counter(group_sizes.values()).items())),
        'actions': dict(sorted(actions.items())),
        'categories': dict(sorted(categories.items())),
        'tool_states': dict(sorted(states.items())),
        'multi_turn_record_count': multi_turn,
        'date_literal_checks': full_dates_checked,
        'decimal_ledger_checks': amount_audits,
        'trusted_state_contrast_groups': trusted_pairs,
        'sha256': hashes,
        'inputs_labels_concatenated_sha256': hashlib.sha256(joined).hexdigest(),
        'checks': [
            'strict JSON and duplicate-key detection', 'exact inference/label/output schemas',
            'opaque unique UUIDs and joined IDs', '36 groups of exactly two records',
            'no duplicate inference payloads', 'valid complete date literals and call-date ordering',
            'all call dates and monetary facts grounded as explicit source tokens',
            '30 exact Decimal wage-component sums and gap calculations',
            'question fields equal missing union conflicts, without overlap',
            'trusted exhausted timeout termination and isolated attempt-count contrasts',
            'exact 30 call / 34 ask / 8 failure distribution', 'at least 12 multi-turn snapshots',
            'JSONL matches independent authored source',
        ],
        'limitations': [
            'Gold labels and rationales are independently Agent-authored synthetic judgments, not expert annotations.',
            'Structural and decimal validation cannot establish legal correctness or empirical real-case performance.',
            '36 paired authoring groups are not 72 independent real-world samples.',
        ],
        'errors': ERRORS,
    }
    (ROOT / 'validation.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(0 if not ERRORS else 1)


if __name__ == '__main__':
    main()
