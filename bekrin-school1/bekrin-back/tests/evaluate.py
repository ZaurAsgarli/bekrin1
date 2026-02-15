"""
Open-answer evaluation: EXACT_MATCH, ORDERED_MATCH, UNORDERED_MATCH, NUMERIC_EQUAL,
ORDERED_DIGITS, UNORDERED_DIGITS.

Evaluation uses normalized comparison; never rely on frontend letter (A/B/C), use option IDs for MC.
"""
import re
from collections import Counter
from decimal import Decimal, InvalidOperation


def _clean_for_digits(text: str) -> str:
    """Keep only digits, comma, space, dot, semicolon, hyphen. Strip."""
    if not text:
        return ""
    return re.sub(r"[^\d\s,\.\-;]", "", str(text).strip())


def normalize_digits_sequence(text: str) -> list[str]:
    """
    Extract digits as ordered list. For "1,3,5" or "135" or "1 3 5" or "1;3;5" or "1-3-5" -> ["1","3","5"].
    Keeps order. 1 5 3 -> wrong (order matters). Smart validation for ordered match.
    """
    if not text:
        return []
    cleaned = _clean_for_digits(text)
    # Split by comma, semicolon, hyphen or whitespace
    parts = re.split(r"[\s,;\-]+", cleaned)
    result = []
    for p in parts:
        p = p.strip()
        if not p:
            continue
        # If part is only digits, add each digit separately (135 -> 1,3,5)
        if p.isdigit():
            result.extend(list(p))
        else:
            # Might be "15.0" or mixed - extract digits only
            digits = re.findall(r"\d", p)
            result.extend(digits)
    return result


def normalize_numeric(text: str) -> Decimal | None:
    """
    Parse as single numeric value. Handles 15, 015, 15.0, 15,00 (EU decimal).
    Returns None if not parseable as one number.
    """
    if not text:
        return None
    cleaned = (text or "").strip()
    cleaned = cleaned.replace(",", ".")
    # Remove spaces
    cleaned = cleaned.replace(" ", "")
    try:
        return Decimal(cleaned)
    except (InvalidOperation, TypeError):
        return None


def normalize_whitespace(s: str) -> str:
    if s is None:
        return ""
    return " ".join(s.strip().split())


def tokens_ordered(s: str) -> list:
    """Split by comma or space, strip, filter empty. Legacy: "1,3,5" -> ["1","3","5"], "135" -> ["135"]."""
    if not s:
        return []
    parts = re.split(r"[\s,]+", s.strip())
    return [p.strip() for p in parts if p.strip()]


def tokens_unordered(s: str) -> list:
    """Same as ordered but sort for comparison."""
    return sorted(tokens_ordered(s))


def evaluate_open_single_value(
    student_answer: str,
    correct_answer,
    rule_type: str | None,
) -> bool:
    """
    correct_answer can be str or number (in JSON).
    rule_type: EXACT_MATCH, ORDERED_MATCH, UNORDERED_MATCH, NUMERIC_EQUAL,
               ORDERED_DIGITS, UNORDERED_DIGITS.
    """
    if correct_answer is None:
        return False
    student = (student_answer or "").strip()
    rule = (rule_type or "EXACT_MATCH").upper()

    # ORDERED_DIGITS: digits sequence, order matters. 135, 1 3 5, 1,3,5 -> correct; 153 -> wrong
    if rule == "ORDERED_DIGITS":
        student_digits = normalize_digits_sequence(student)
        correct_digits = normalize_digits_sequence(str(correct_answer))
        return student_digits == correct_digits

    # UNORDERED_DIGITS: same digits multiset, order irrelevant
    if rule == "UNORDERED_DIGITS":
        student_digits = normalize_digits_sequence(student)
        correct_digits = normalize_digits_sequence(str(correct_answer))
        return Counter(student_digits) == Counter(correct_digits)

    # NUMERIC_EQUAL: single number comparison. 15, 15.0, 015, 15,00 -> correct; 1,5 (two items) -> wrong
    if rule == "NUMERIC_EQUAL":
        a = normalize_numeric(student)
        b = normalize_numeric(str(correct_answer))
        if a is None or b is None:
            return False
        return a == b

    if rule == "EXACT_MATCH":
        return normalize_whitespace(student).lower() == normalize_whitespace(str(correct_answer)).lower()

    # ORDERED_MATCH: accept "1,3,5", "1 3 5", "135" (digit tokenization); order must match
    if rule == "ORDERED_MATCH":
        student_digits = normalize_digits_sequence(student)
        correct_digits = normalize_digits_sequence(str(correct_answer))
        if student_digits or correct_digits:
            return student_digits == correct_digits
        return tokens_ordered(student) == tokens_ordered(str(correct_answer))

    if rule == "UNORDERED_MATCH":
        return tokens_unordered(student) == tokens_unordered(str(correct_answer))

    return normalize_whitespace(student).lower() == normalize_whitespace(str(correct_answer)).lower()
