"""
Answer key JSON validation for PDF/JSON exam sources.
Enforces composition: QUIZ 12 closed + 3 open; EXAM 22 closed + 5 open + 3 situations.
"""
from typing import Any

# Composition rules
QUIZ_TOTAL = 15
QUIZ_CLOSED = 12
QUIZ_OPEN = 3
QUIZ_SITUATION = 0
EXAM_TOTAL = 30
EXAM_CLOSED = 22
EXAM_OPEN = 5
EXAM_SITUATION = 3

OPEN_RULES = {'EXACT_MATCH', 'ORDERED_MATCH', 'UNORDERED_MATCH', 'NUMERIC_EQUAL', 'ORDERED_DIGITS', 'UNORDERED_DIGITS'}
QUESTION_KINDS = {'mc', 'open', 'situation'}


def validate_answer_key_json(data: Any) -> tuple[bool, list[str]]:
    """
    Validate answer key JSON. Returns (is_valid, list of error messages).
    """
    errors = []
    if not isinstance(data, dict):
        return False, ['answer_key must be an object']

    exam_type = data.get('type')
    if exam_type not in ('quiz', 'exam'):
        errors.append('"type" must be "quiz" or "exam"')

    questions = data.get('questions')
    if not isinstance(questions, list):
        errors.append('"questions" must be an array')
        return False, errors

    situations = data.get('situations')
    if situations is not None and not isinstance(situations, list):
        errors.append('"situations" must be an array or omitted')

    closed = 0
    open_count = 0
    situation_count = 0
    seen_numbers = set()
    mc_options_keys = set()

    for i, q in enumerate(questions):
        if not isinstance(q, dict):
            errors.append(f'questions[{i}] must be an object')
            continue
        num = q.get('number')
        if num is None:
            errors.append(f'questions[{i}]: "number" required')
        elif num in seen_numbers:
            errors.append(f'questions[{i}]: duplicate number {num}')
        else:
            seen_numbers.add(num)

        kind = (q.get('kind') or '').strip().lower()
        if kind not in QUESTION_KINDS:
            errors.append(f'questions[{i}]: "kind" must be one of mc, open, situation')
        else:
            if kind == 'mc':
                closed += 1
                opts = q.get('options')
                if not isinstance(opts, list):
                    errors.append(f'questions[{i}]: mc question must have "options" array')
                else:
                    keys = set()
                    for o in opts:
                        if isinstance(o, dict) and o.get('key'):
                            keys.add(str(o.get('key')).strip().upper())
                    correct = q.get('correct')
                    if correct is not None and str(correct).strip().upper() not in keys:
                        errors.append(f'questions[{i}]: "correct" must be one of option keys')
            elif kind == 'open':
                open_count += 1
                rule = (q.get('open_rule') or '').strip().upper()
                if rule and rule not in OPEN_RULES:
                    errors.append(f'questions[{i}]: open_rule must be one of {sorted(OPEN_RULES)}')
                # open_answer optional; used for auto-grading
            elif kind == 'situation':
                situation_count += 1

    if situations:
        for j, s in enumerate(situations):
            if not isinstance(s, dict):
                errors.append(f'situations[{j}] must be an object')
            elif 'index' not in s and 'pages' not in s:
                errors.append(f'situations[{j}]: "index" or "pages" required')

    total = closed + open_count + situation_count
    if exam_type == 'quiz':
        if total != QUIZ_TOTAL:
            errors.append(f'Quiz must have {QUIZ_TOTAL} questions total (got {total})')
        if closed != QUIZ_CLOSED:
            errors.append(f'Quiz must have {QUIZ_CLOSED} closed (mc) questions (got {closed})')
        if open_count != QUIZ_OPEN:
            errors.append(f'Quiz must have {QUIZ_OPEN} open questions (got {open_count})')
        if situation_count != QUIZ_SITUATION:
            errors.append(f'Quiz must have {QUIZ_SITUATION} situation questions (got {situation_count})')
    elif exam_type == 'exam':
        if total != EXAM_TOTAL:
            errors.append(f'Exam must have {EXAM_TOTAL} questions total (got {total})')
        if closed != EXAM_CLOSED:
            errors.append(f'Exam must have {EXAM_CLOSED} closed (mc) questions (got {closed})')
        if open_count != EXAM_OPEN:
            errors.append(f'Exam must have {EXAM_OPEN} open questions (got {open_count})')
        if situation_count != EXAM_SITUATION:
            errors.append(f'Exam must have {EXAM_SITUATION} situation questions (got {situation_count})')

    return len(errors) == 0, errors


def get_answer_key_question_counts(data: Any) -> dict[str, int] | None:
    """Return {closed, open, situation, total} from validated answer_key_json, or None if invalid."""
    if not isinstance(data, dict):
        return None
    questions = data.get('questions') or []
    closed = open_count = situation_count = 0
    for q in questions:
        if not isinstance(q, dict):
            continue
        kind = (q.get('kind') or '').strip().lower()
        if kind == 'mc':
            closed += 1
        elif kind == 'open':
            open_count += 1
        elif kind == 'situation':
            situation_count += 1
    return {
        'closed': closed,
        'open': open_count,
        'situation': situation_count,
        'total': closed + open_count + situation_count,
    }
