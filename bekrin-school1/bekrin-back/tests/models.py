"""
Tests (quiz/exam) + answer key, assignment, attempt (ERD parity).
config jsonb for future anti-cheat.
"""
from django.db import models
from accounts.models import User
from students.models import StudentProfile
from groups.models import Group


class Test(models.Model):
    """Test (quiz or exam) with optional pdf link and config."""
    TYPE_CHOICES = [
        ('quiz', 'Quiz'),
        ('exam', 'Exam'),
    ]
    organization = models.ForeignKey(
        'core.Organization',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='tests',
        db_column='organization_id',
    )
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='created_tests',
        limit_choices_to={'role': 'teacher'},
        db_column='created_by_id',
    )
    type = models.CharField(max_length=20, choices=TYPE_CHOICES)
    title = models.CharField(max_length=255)
    pdf_url = models.URLField(blank=True, null=True)
    config = models.JSONField(default=dict, blank=True, null=True)
    is_active = models.BooleanField(default=True)
    deleted_at = models.DateTimeField(null=True, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'tests'
        verbose_name = 'Test'
        verbose_name_plural = 'Tests'
        ordering = ['-created_at']

    def __str__(self):
        return self.title


class TestAnswerKey(models.Model):
    """Answer key for a test (mcq + numeric + written instructions)."""
    test = models.OneToOneField(
        Test,
        on_delete=models.CASCADE,
        related_name='answer_key',
    )
    mcq_answers = models.JSONField(default=dict, blank=True, null=True)
    numeric_answers = models.JSONField(default=dict, blank=True, null=True)
    written_instructions = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'test_answer_keys'
        verbose_name = 'Test Answer Key'
        verbose_name_plural = 'Test Answer Keys'

    def __str__(self):
        return f"Answer key for {self.test.title}"


class TestAssignment(models.Model):
    """Assignment of test to group or student."""
    organization = models.ForeignKey(
        'core.Organization',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='test_assignments',
        db_column='organization_id',
    )
    test = models.ForeignKey(
        Test,
        on_delete=models.CASCADE,
        related_name='assignments',
    )
    group = models.ForeignKey(
        Group,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='test_assignments',
    )
    student = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='test_assignments',
        limit_choices_to={'role': 'student'},
    )
    available_from = models.DateTimeField(null=True, blank=True)
    available_to = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'test_assignments'
        verbose_name = 'Test Assignment'
        verbose_name_plural = 'Test Assignments'

    def __str__(self):
        return f"{self.test.title} -> group/student"


class TestAttempt(models.Model):
    """Student attempt at a test."""
    STATUS_CHOICES = [
        ('started', 'Started'),
        ('submitted', 'Submitted'),
        ('graded', 'Graded'),
    ]
    organization = models.ForeignKey(
        'core.Organization',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='test_attempts',
        db_column='organization_id',
    )
    test = models.ForeignKey(
        Test,
        on_delete=models.CASCADE,
        related_name='attempts',
    )
    student = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='test_attempts',
        limit_choices_to={'role': 'student'},
    )
    started_at = models.DateTimeField(auto_now_add=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    answers = models.JSONField(default=dict, blank=True, null=True)
    score = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='started')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'test_attempts'
        verbose_name = 'Test Attempt'
        verbose_name_plural = 'Test Attempts'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['test']),
            models.Index(fields=['student', 'created_at']),
        ]

    def __str__(self):
        return f"{self.student.full_name} - {self.test.title} - {self.status}"


class TestResult(models.Model):
    """
    Simple test result (legacy / summary). Full attempt data in TestAttempt.
    """
    student_profile = models.ForeignKey(
        StudentProfile,
        on_delete=models.CASCADE,
        related_name='test_results',
    )
    group = models.ForeignKey(
        Group,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='test_results',
    )
    test_name = models.CharField(max_length=255)
    score = models.IntegerField()
    max_score = models.IntegerField()
    date = models.DateField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'test_results'
        verbose_name = 'Test Result'
        verbose_name_plural = 'Test Results'
        ordering = ['-date', '-created_at']

    def __str__(self):
        return f"{self.test_name} - {self.student_profile.user.full_name} - {self.score}/{self.max_score}"


# ========== Question Bank & Exam System (additive) ==========

class QuestionTopic(models.Model):
    """Topic for grouping questions."""
    name = models.CharField(max_length=255)
    order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)
    is_archived = models.BooleanField(default=False, db_index=True)

    class Meta:
        db_table = 'question_topics'
        verbose_name = 'Question Topic'
        verbose_name_plural = 'Question Topics'
        ordering = ['order', 'name']

    def __str__(self):
        return self.name


class Question(models.Model):
    """Reusable question for exams."""
    TYPE_CHOICES = [
        ('MULTIPLE_CHOICE', 'Multiple Choice'),
        ('OPEN_SINGLE_VALUE', 'Open Single Value'),
        ('OPEN_ORDERED', 'Open Ordered'),
        ('OPEN_UNORDERED', 'Open Unordered'),
        ('SITUATION', 'Situation'),
    ]
    ANSWER_RULE_CHOICES = [
        ('EXACT_MATCH', 'Exact Match'),
        ('ORDERED_MATCH', 'Ordered Match'),
        ('UNORDERED_MATCH', 'Unordered Match'),
        ('NUMERIC_EQUAL', 'Numeric Equal'),
        ('ORDERED_DIGITS', 'Ordered Digits (sequence matters)'),
        ('UNORDERED_DIGITS', 'Unordered Digits (set, order irrelevant)'),
    ]
    topic = models.ForeignKey(
        QuestionTopic,
        on_delete=models.CASCADE,
        related_name='questions',
        db_index=True,
    )
    text = models.TextField()
    type = models.CharField(max_length=30, choices=TYPE_CHOICES, db_index=True)
    correct_answer = models.JSONField(default=dict, blank=True, null=True)
    answer_rule_type = models.CharField(
        max_length=30,
        choices=ANSWER_RULE_CHOICES,
        null=True,
        blank=True,
    )
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='created_questions',
        limit_choices_to={'role': 'teacher'},
        db_column='created_by_id',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    is_active = models.BooleanField(default=True, db_index=True)
    is_archived = models.BooleanField(default=False, db_index=True)
    archived_at = models.DateTimeField(null=True, blank=True, db_index=True)

    class Meta:
        db_table = 'questions'
        verbose_name = 'Question'
        verbose_name_plural = 'Questions'
        ordering = ['topic', 'id']
        indexes = [
            models.Index(fields=['topic']),
            models.Index(fields=['type']),
            models.Index(fields=['is_active']),
        ]

    def __str__(self):
        return self.text[:50] + '...' if len(self.text) > 50 else self.text


class QuestionOption(models.Model):
    """Option for multiple choice questions."""
    question = models.ForeignKey(
        Question,
        on_delete=models.CASCADE,
        related_name='options',
        db_index=True,
    )
    text = models.TextField()
    is_correct = models.BooleanField(default=False)
    order = models.IntegerField(default=0)

    class Meta:
        db_table = 'question_options'
        verbose_name = 'Question Option'
        verbose_name_plural = 'Question Options'
        ordering = ['question', 'order']
        indexes = [models.Index(fields=['question'])]

    def __str__(self):
        return self.text[:30] + '...' if len(self.text) > 30 else self.text


class Exam(models.Model):
    """Exam built from question bank, PDF+answer key, or JSON only."""
    SOURCE_TYPE_CHOICES = [
        ('BANK', 'Question Bank'),
        ('PDF', 'PDF + Answer Key'),
        ('JSON', 'JSON Only'),
    ]
    TYPE_CHOICES = [('quiz', 'Quiz'), ('exam', 'Exam')]
    STATUS_CHOICES = [
        ('draft', 'Draft'),
        ('active', 'Active'),
        ('finished', 'Finished'),
        ('archived', 'Archived'),
    ]
    title = models.CharField(max_length=255)
    type = models.CharField(max_length=20, choices=TYPE_CHOICES)
    source_type = models.CharField(
        max_length=20,
        choices=SOURCE_TYPE_CHOICES,
        default='BANK',
        db_index=True,
    )
    start_time = models.DateTimeField()
    end_time = models.DateTimeField()
    duration_minutes = models.IntegerField(null=True, blank=True, help_text='Duration in minutes')
    max_score = models.IntegerField(null=True, blank=True, help_text='Total points (defaults: Quiz=100, Exam=150)')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='draft', db_index=True)
    pdf_file = models.FileField(upload_to='exams/%Y/%m/', blank=True, null=True)
    pdf_document = models.ForeignKey(
        'TeacherPDF',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='exams',
        help_text='PDF from library (alternative to pdf_file)',
    )
    answer_key_json = models.JSONField(null=True, blank=True)
    meta_json = models.JSONField(null=True, blank=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='created_exams',
        limit_choices_to={'role': 'teacher'},
        db_column='created_by_id',
    )
    is_result_published = models.BooleanField(default=False)
    is_archived = models.BooleanField(default=False, db_index=True)
    archived_at = models.DateTimeField(null=True, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'exams'
        verbose_name = 'Exam'
        verbose_name_plural = 'Exams'
        ordering = ['-start_time']
        indexes = [
            models.Index(fields=['start_time']),
            models.Index(fields=['end_time']),
            models.Index(fields=['status']),
        ]

    def __str__(self):
        return self.title


class ExamRun(models.Model):
    """Per-group or per-student run with independent time window."""
    STATUS_CHOICES = [
        ('scheduled', 'Scheduled'),
        ('active', 'Active'),
        ('finished', 'Finished'),
    ]
    exam = models.ForeignKey(
        Exam,
        on_delete=models.CASCADE,
        related_name='runs',
    )
    group = models.ForeignKey(
        Group,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='exam_runs',
    )
    student = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='exam_runs',
        limit_choices_to={'role': 'student'},
    )
    start_at = models.DateTimeField()
    end_at = models.DateTimeField()
    duration_minutes = models.IntegerField()
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default='scheduled',
        db_index=True,
    )
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='created_exam_runs',
        limit_choices_to={'role': 'teacher'},
        db_column='created_by_id',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'exam_runs'
        verbose_name = 'Exam Run'
        verbose_name_plural = 'Exam Runs'
        ordering = ['-start_at']

    def __str__(self):
        target = self.group.name if self.group else (self.student.full_name if self.student else '?')
        return f"{self.exam.title} -> {target}"


class ExamQuestion(models.Model):
    """Link exam to questions with order."""
    exam = models.ForeignKey(
        Exam,
        on_delete=models.CASCADE,
        related_name='exam_questions',
    )
    question = models.ForeignKey(
        Question,
        on_delete=models.CASCADE,
        related_name='exam_questions',
    )
    order = models.IntegerField(default=0)

    class Meta:
        db_table = 'exam_questions'
        verbose_name = 'Exam Question'
        verbose_name_plural = 'Exam Questions'
        ordering = ['exam', 'order']

    def __str__(self):
        return f"{self.exam.title} - Q{self.order}"


class ExamAttempt(models.Model):
    """Student attempt at an exam (optionally tied to an ExamRun)."""
    STATUS_CHOICES = [
        ('IN_PROGRESS', 'In Progress'),
        ('SUBMITTED', 'Submitted'),
        ('EXPIRED', 'Expired'),
        ('RESTARTED', 'Restarted'),
    ]
    exam = models.ForeignKey(
        Exam,
        on_delete=models.CASCADE,
        related_name='attempts',
    )
    exam_run = models.ForeignKey(
        'ExamRun',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='attempts',
    )
    student = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='exam_attempts',
        limit_choices_to={'role': 'student'},
    )
    started_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    duration_minutes = models.IntegerField(null=True, blank=True)
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default='IN_PROGRESS',
        db_index=True,
    )
    auto_score = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    manual_score = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    total_score = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    is_checked = models.BooleanField(default=False)
    is_result_published = models.BooleanField(default=False, db_index=True)
    is_archived = models.BooleanField(default=False, db_index=True, help_text='Archived by teacher cleanup')

    class Meta:
        db_table = 'exam_attempts'
        verbose_name = 'Exam Attempt'
        verbose_name_plural = 'Exam Attempts'
        ordering = ['-started_at']
        indexes = [
            models.Index(fields=['student']),
            models.Index(fields=['exam']),
            models.Index(fields=['exam_run']),
        ]

    def __str__(self):
        return f"{self.student.full_name} - {self.exam.title}"


class ExamAttemptCanvas(models.Model):
    """Canvas drawing for a SITUATION question (BANK: question FK; PDF/JSON: situation_index)."""
    attempt = models.ForeignKey(
        ExamAttempt,
        on_delete=models.CASCADE,
        related_name='canvases',
        db_index=True,
    )
    question = models.ForeignKey(
        Question,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='exam_attempt_canvases',
        db_index=True,
    )
    situation_index = models.PositiveIntegerField(null=True, blank=True)
    image = models.ImageField(upload_to='exam_canvases/%Y/%m/', null=True, blank=True)
    strokes_json = models.JSONField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'exam_attempt_canvases'
        verbose_name = 'Exam Attempt Canvas'
        verbose_name_plural = 'Exam Attempt Canvases'
        indexes = [
            models.Index(fields=['attempt']),
            models.Index(fields=['question']),
        ]

    def __str__(self):
        return f"Attempt {self.attempt_id} - Q{self.question_id or self.situation_index}"


class ExamAnswer(models.Model):
    """Single answer within an attempt (BANK: question FK; PDF/JSON: question_number + selected_option_key)."""
    attempt = models.ForeignKey(
        ExamAttempt,
        on_delete=models.CASCADE,
        related_name='answers',
        db_index=True,
    )
    question = models.ForeignKey(
        Question,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='exam_answers',
        db_index=True,
    )
    question_number = models.PositiveIntegerField(null=True, blank=True)
    selected_option = models.ForeignKey(
        QuestionOption,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='+',
    )
    selected_option_key = models.CharField(max_length=10, null=True, blank=True)
    text_answer = models.TextField(blank=True, null=True)
    auto_score = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    manual_score = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True, help_text='Teacher-assigned score for manual questions')
    score_awarded = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    is_correct = models.BooleanField(null=True, blank=True)
    requires_manual_check = models.BooleanField(default=False)

    class Meta:
        db_table = 'exam_answers'
        verbose_name = 'Exam Answer'
        verbose_name_plural = 'Exam Answers'
        indexes = [
            models.Index(fields=['attempt']),
            models.Index(fields=['question']),
        ]

    def __str__(self):
        return f"Attempt {self.attempt_id} - Q{self.question_id or self.question_number}"


class ExamAssignment(models.Model):
    """Assignment of exam to group(s) with per-assignment timing."""
    exam = models.ForeignKey(
        Exam,
        on_delete=models.CASCADE,
        related_name='assignments',
    )
    group = models.ForeignKey(
        Group,
        on_delete=models.CASCADE,
        related_name='exam_assignments',
    )
    start_time = models.DateTimeField(null=True, blank=True)
    end_time = models.DateTimeField(null=True, blank=True)
    duration_minutes = models.IntegerField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'exam_assignments'
        verbose_name = 'Exam Assignment'
        verbose_name_plural = 'Exam Assignments'
        unique_together = [['exam', 'group']]
        indexes = [
            models.Index(fields=['exam']),
            models.Index(fields=['group']),
        ]

    def __str__(self):
        return f"{self.exam.title} -> {self.group.name}"


class ExamStudentAssignment(models.Model):
    """Assignment of exam to a single student with per-assignment timing."""
    exam = models.ForeignKey(
        Exam,
        on_delete=models.CASCADE,
        related_name='student_assignments',
    )
    student = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='exam_student_assignments',
        limit_choices_to={'role': 'student'},
    )
    start_time = models.DateTimeField(null=True, blank=True)
    end_time = models.DateTimeField(null=True, blank=True)
    duration_minutes = models.IntegerField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'exam_student_assignments'
        verbose_name = 'Exam Student Assignment'
        verbose_name_plural = 'Exam Student Assignments'
        unique_together = [['exam', 'student']]
        indexes = [
            models.Index(fields=['exam']),
            models.Index(fields=['student']),
        ]

    def __str__(self):
        return f"{self.exam.title} -> {self.student.full_name}"


class TeacherPDF(models.Model):
    """PDF document uploaded by teacher (library/archive)."""
    organization = models.ForeignKey(
        'core.Organization',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='teacher_pdfs',
        db_column='organization_id',
    )
    teacher = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='uploaded_pdfs',
        limit_choices_to={'role': 'teacher'},
        db_column='teacher_id',
    )
    title = models.CharField(max_length=255)
    file = models.FileField(upload_to='teacher_pdfs/%Y/%m/')
    original_filename = models.CharField(max_length=255, blank=True)
    file_size = models.BigIntegerField(null=True, blank=True, help_text='Size in bytes')
    page_count = models.IntegerField(null=True, blank=True)
    tags = models.JSONField(default=list, blank=True, help_text='List of tag strings')
    year = models.IntegerField(null=True, blank=True)
    source = models.CharField(max_length=255, blank=True)
    is_deleted = models.BooleanField(default=False, db_index=True)
    is_archived = models.BooleanField(default=False, db_index=True)
    archived_at = models.DateTimeField(null=True, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'teacher_pdfs'
        verbose_name = 'Teacher PDF'
        verbose_name_plural = 'Teacher PDFs'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['teacher', 'is_deleted']),
            models.Index(fields=['created_at']),
        ]

    def __str__(self):
        return self.title
