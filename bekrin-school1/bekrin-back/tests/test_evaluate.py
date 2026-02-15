"""
Unit tests for open-answer evaluation (ORDERED_DIGITS, UNORDERED_DIGITS, NUMERIC_EQUAL).
"""
import django
import os
import sys

# Setup Django for standalone test run
if __name__ == "__main__":
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings")
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    django.setup()

from django.test import TestCase
from tests.evaluate import (
    evaluate_open_single_value,
    normalize_digits_sequence,
    normalize_numeric,
)


class TestNormalizeDigitsSequence(TestCase):
    def test_ordered_digits_comma(self):
        self.assertEqual(normalize_digits_sequence("1,3,5"), ["1", "3", "5"])

    def test_ordered_digits_space(self):
        self.assertEqual(normalize_digits_sequence("1 3 5"), ["1", "3", "5"])

    def test_ordered_digits_concat(self):
        self.assertEqual(normalize_digits_sequence("135"), ["1", "3", "5"])

    def test_ordered_digits_mixed(self):
        self.assertEqual(normalize_digits_sequence("1, 3, 5"), ["1", "3", "5"])

    def test_empty(self):
        self.assertEqual(normalize_digits_sequence(""), [])
        self.assertEqual(normalize_digits_sequence("   "), [])


class TestOrderedDigitsEvaluation(TestCase):
    """correct_answer=1,3,5"""

    def setUp(self):
        self.correct = "1,3,5"
        self.rule = "ORDERED_DIGITS"

    def test_student_135_correct(self):
        self.assertTrue(evaluate_open_single_value("135", self.correct, self.rule))

    def test_student_1_3_5_correct(self):
        self.assertTrue(evaluate_open_single_value("1 3 5", self.correct, self.rule))

    def test_student_1_comma_3_comma_5_correct(self):
        self.assertTrue(evaluate_open_single_value("1, 3, 5", self.correct, self.rule))

    def test_student_153_wrong(self):
        self.assertFalse(evaluate_open_single_value("153", self.correct, self.rule))

    def test_student_3_1_5_wrong(self):
        self.assertFalse(evaluate_open_single_value("3,1,5", self.correct, self.rule))

    def test_student_531_wrong(self):
        self.assertFalse(evaluate_open_single_value("531", self.correct, self.rule))


class TestUnorderedDigitsEvaluation(TestCase):
    """correct_answer=1,3,5 - order irrelevant"""

    def setUp(self):
        self.correct = "1,3,5"
        self.rule = "UNORDERED_DIGITS"

    def test_student_3_1_5_correct(self):
        self.assertTrue(evaluate_open_single_value("3,1,5", self.correct, self.rule))

    def test_student_531_correct(self):
        self.assertTrue(evaluate_open_single_value("531", self.correct, self.rule))

    def test_student_1_5_3_correct(self):
        self.assertTrue(evaluate_open_single_value("1 5 3", self.correct, self.rule))

    def test_student_1_3_wrong(self):
        self.assertFalse(evaluate_open_single_value("1,3", self.correct, self.rule))

    def test_student_1_3_3_5_wrong(self):
        self.assertFalse(evaluate_open_single_value("1,3,3,5", self.correct, self.rule))


class TestNumericEqualEvaluation(TestCase):
    """correct_answer=15"""

    def setUp(self):
        self.correct = "15"
        self.rule = "NUMERIC_EQUAL"

    def test_student_15_correct(self):
        self.assertTrue(evaluate_open_single_value("15", self.correct, self.rule))

    def test_student_15_0_correct(self):
        self.assertTrue(evaluate_open_single_value("15.0", self.correct, self.rule))

    def test_student_015_correct(self):
        self.assertTrue(evaluate_open_single_value("015", self.correct, self.rule))

    def test_student_15_comma_00_correct(self):
        self.assertTrue(evaluate_open_single_value("15,00", self.correct, self.rule))

    def test_student_1_5_wrong(self):
        self.assertFalse(evaluate_open_single_value("1,5", self.correct, self.rule))

    def test_student_1_comma_5_as_two_digits_wrong(self):
        # 1,5 with comma as decimal -> 1.5 != 15
        self.assertFalse(evaluate_open_single_value("1,5", self.correct, self.rule))


class TestNormalizeNumeric(TestCase):
    def test_15(self):
        from decimal import Decimal
        self.assertEqual(normalize_numeric("15"), Decimal("15"))

    def test_15_0(self):
        from decimal import Decimal
        self.assertEqual(normalize_numeric("15.0"), Decimal("15.0"))

    def test_15_comma_00(self):
        from decimal import Decimal
        self.assertEqual(normalize_numeric("15,00"), Decimal("15.00"))
