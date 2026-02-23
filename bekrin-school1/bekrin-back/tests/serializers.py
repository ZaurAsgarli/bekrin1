"""
Serializers for tests app (legacy Test + Question Bank & Exam)
"""
from rest_framework import serializers
from .models import (
    Test,
    TestResult,
    QuestionTopic,
    Question,
    QuestionOption,
    Exam,
    ExamRun,
    ExamQuestion,
    ExamAttempt,
    ExamAnswer,
    TeacherPDF,
)


class TestSerializer(serializers.ModelSerializer):
    """Test (quiz/exam) serializer"""
    type = serializers.ChoiceField(choices=[('quiz', 'Quiz'), ('exam', 'Exam')])

    class Meta:
        model = Test
        fields = ['id', 'type', 'title', 'pdf_url', 'is_active', 'config']
        read_only_fields = ['id']


class TestResultSerializer(serializers.ModelSerializer):
    """Test Result serializer"""
    testName = serializers.CharField(source='test_name', read_only=True)
    maxScore = serializers.IntegerField(source='max_score', read_only=True)
    groupName = serializers.CharField(source='group.name', read_only=True, allow_null=True)
    
    class Meta:
        model = TestResult
        fields = ['id', 'testName', 'score', 'maxScore', 'date', 'groupName']
        read_only_fields = ['id']


class TestResultCreateSerializer(serializers.Serializer):
    """TestResult create - for manual grade entry"""
    studentProfileId = serializers.IntegerField()
    groupId = serializers.IntegerField(required=False, allow_null=True)
    testName = serializers.CharField()
    maxScore = serializers.IntegerField()
    score = serializers.IntegerField()
    date = serializers.DateField()

    def create(self, validated_data):
        from students.models import StudentProfile
        from groups.models import Group
        sp_id = validated_data.pop('studentProfileId')
        group_id = validated_data.pop('groupId', None)
        validated_data['student_profile'] = StudentProfile.objects.get(id=sp_id)
        validated_data['group'] = Group.objects.get(id=group_id) if group_id and group_id > 0 else None
        validated_data['test_name'] = validated_data.pop('testName')
        validated_data['max_score'] = validated_data.pop('maxScore')
        instance = TestResult.objects.create(**validated_data)
        return instance


# ----- Question Bank & Exam -----

class QuestionTopicSerializer(serializers.ModelSerializer):
    class Meta:
        model = QuestionTopic
        fields = ['id', 'name', 'order', 'is_active']


class QuestionOptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = QuestionOption
        fields = ['id', 'text', 'is_correct', 'order']


class QuestionSerializer(serializers.ModelSerializer):
    options = QuestionOptionSerializer(many=True, read_only=True)

    class Meta:
        model = Question
        fields = [
            'id', 'topic', 'text', 'type', 'correct_answer', 'answer_rule_type',
            'created_at', 'is_active', 'options',
        ]
        read_only_fields = ['id', 'created_at']


class QuestionCreateSerializer(serializers.ModelSerializer):
    options = QuestionOptionSerializer(many=True, required=False)

    class Meta:
        model = Question
        fields = [
            'topic', 'text', 'type', 'correct_answer', 'answer_rule_type',
            'is_active', 'options',
        ]

    def create(self, validated_data):
        options_data = validated_data.pop('options', [])
        correct_answer = validated_data.get('correct_answer')
        q = Question.objects.create(**validated_data)
        correct_option_id = None
        for i, opt in enumerate(options_data):
            ob = QuestionOption.objects.create(
                question=q,
                order=opt.get('order', i),
                text=opt.get('text', ''),
                is_correct=opt.get('is_correct', False),
            )
            if opt.get('is_correct'):
                correct_option_id = ob.id
        if q.type == 'MULTIPLE_CHOICE' and correct_option_id is not None:
            q.correct_answer = correct_option_id
            q.save(update_fields=['correct_answer'])
        return q


def _is_ghost_exam(exam):
    """Active exam is ghost if missing duration or at least one target (group/student)."""
    if exam.status != 'active':
        return False
    has_duration = (exam.duration_minutes or 0) > 0
    has_group = exam.assignments.filter(is_active=True).exists() if hasattr(exam, 'assignments') else False
    has_student = exam.student_assignments.filter(is_active=True).exists() if hasattr(exam, 'student_assignments') else False
    return not (has_duration and (has_group or has_student))


class ExamSerializer(serializers.ModelSerializer):
    assigned_groups = serializers.SerializerMethodField()
    is_ghost = serializers.SerializerMethodField()
    source_type = serializers.CharField(read_only=True)

    class Meta:
        model = Exam
        fields = [
            'id', 'title', 'type', 'source_type', 'start_time', 'end_time', 'status',
            'duration_minutes', 'max_score', 'pdf_file', 'pdf_document',
            'is_result_published', 'assigned_groups', 'is_ghost', 'created_at',
        ]
        read_only_fields = ['id', 'created_at']

    def get_assigned_groups(self, obj):
        if hasattr(obj, 'assignments'):
            return [{'id': a.group.id, 'name': a.group.name} for a in obj.assignments.all()]
        return []

    def get_is_ghost(self, obj):
        return _is_ghost_exam(obj)


class ExamRunSerializer(serializers.ModelSerializer):
    group_name = serializers.SerializerMethodField()
    student_name = serializers.SerializerMethodField()
    attempt_count = serializers.SerializerMethodField()

    class Meta:
        model = ExamRun
        fields = [
            'id', 'exam', 'group', 'student', 'group_name', 'student_name',
            'start_at', 'end_at', 'duration_minutes', 'status',
            'created_by', 'created_at', 'attempt_count',
        ]
        read_only_fields = ['id', 'created_at']

    def get_group_name(self, obj):
        return obj.group.name if obj.group else None

    def get_student_name(self, obj):
        return obj.student.full_name if obj.student else None

    def get_attempt_count(self, obj):
        if hasattr(obj, '_attempt_count'):
            return obj._attempt_count
        return obj.attempts.filter(is_archived=False).count()


class ExamQuestionSerializer(serializers.ModelSerializer):
    question_text = serializers.CharField(source='question.text', read_only=True)
    question_type = serializers.CharField(source='question.type', read_only=True)

    class Meta:
        model = ExamQuestion
        fields = ['id', 'exam', 'question', 'question_text', 'question_type', 'order']


class ExamDetailSerializer(serializers.ModelSerializer):
    questions = ExamQuestionSerializer(source='exam_questions', many=True, read_only=True)
    assigned_groups = serializers.SerializerMethodField()
    source_type = serializers.CharField(read_only=True)
    pdf_url = serializers.SerializerMethodField()
    has_answer_key = serializers.SerializerMethodField()
    question_counts = serializers.SerializerMethodField()
    answer_key_preview = serializers.SerializerMethodField()
    runs = serializers.SerializerMethodField()

    class Meta:
        model = Exam
        fields = [
            'id', 'title', 'type', 'source_type', 'start_time', 'end_time', 'status',
            'duration_minutes', 'max_score', 'pdf_file', 'pdf_document', 'pdf_url',
            'is_result_published', 'has_answer_key', 'question_counts', 'answer_key_preview',
            'questions', 'assigned_groups', 'runs', 'created_at',
        ]

    def get_assigned_groups(self, obj):
        if hasattr(obj, 'assignments'):
            return [{'id': a.group.id, 'name': a.group.name} for a in obj.assignments.all()]
        return []

    def get_pdf_url(self, obj):
        request = self.context.get('request')
        if obj.pdf_document and obj.pdf_document.file:
            try:
                if not obj.pdf_document.file.storage.exists(obj.pdf_document.file.name):
                    return None
            except Exception:
                return None
            url = obj.pdf_document.file.url
            if request:
                return request.build_absolute_uri(url)
            return url
        if obj.pdf_file:
            try:
                if not obj.pdf_file.storage.exists(obj.pdf_file.name):
                    return None
            except Exception:
                return None
            url = obj.pdf_file.url
            if request:
                return request.build_absolute_uri(url)
            return url
        return None

    def get_has_answer_key(self, obj):
        return bool(obj.answer_key_json and isinstance(obj.answer_key_json, dict))

    def get_question_counts(self, obj):
        if obj.source_type == 'BANK' and hasattr(obj, 'exam_questions'):
            closed = open_c = situation = 0
            for eq in obj.exam_questions.all():
                t = getattr(eq.question, 'type', None)
                if t == 'MULTIPLE_CHOICE':
                    closed += 1
                elif t in ('OPEN_SINGLE_VALUE', 'OPEN_ORDERED', 'OPEN_UNORDERED'):
                    open_c += 1
                elif t == 'SITUATION':
                    situation += 1
            return {'closed': closed, 'open': open_c, 'situation': situation, 'total': closed + open_c + situation}
        if obj.answer_key_json and isinstance(obj.answer_key_json, dict):
            from .answer_key import get_answer_key_question_counts
            return get_answer_key_question_counts(obj.answer_key_json)
        return None

    def get_answer_key_preview(self, obj):
        """Teacher-only: list of { number, kind, correct, open_answer } from answer_key_json for Cavab vərəqi panel."""
        if obj.source_type not in ('PDF', 'JSON') or not obj.answer_key_json or not isinstance(obj.answer_key_json, dict):
            return None
        questions = obj.answer_key_json.get('questions') or []
        return [
            {
                'number': q.get('number'),
                'kind': (q.get('kind') or '').strip().lower(),
                'correct': q.get('correct'),
                'open_answer': q.get('open_answer') or q.get('answer'),
            }
            for q in questions if isinstance(q, dict)
        ]

    def get_runs(self, obj):
        if not hasattr(obj, 'runs'):
            return []
        from django.db.models import Count, Q
        runs = obj.runs.all().select_related('group', 'student').annotate(
            _attempt_count=Count('attempts', filter=Q(attempts__is_archived=False))
        )
        return ExamRunSerializer(runs, many=True, context=self.context).data


# Student-facing: question with options (IDs for submission), no correct_answer
class QuestionOptionPublicSerializer(serializers.ModelSerializer):
    class Meta:
        model = QuestionOption
        fields = ['id', 'text', 'order']


class QuestionPublicSerializer(serializers.ModelSerializer):
    options = QuestionOptionPublicSerializer(many=True, read_only=True)

    class Meta:
        model = Question
        fields = ['id', 'text', 'type', 'options']


class TeacherPDFSerializer(serializers.ModelSerializer):
    file_url = serializers.SerializerMethodField()
    file_size_mb = serializers.SerializerMethodField()

    class Meta:
        model = TeacherPDF
        fields = [
            'id', 'title', 'file', 'file_url', 'original_filename', 'file_size', 'file_size_mb',
            'page_count', 'tags', 'year', 'source', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'file_size']

    def get_file_url(self, obj):
        if obj.file:
            # Check if file actually exists on disk
            try:
                if not obj.file.storage.exists(obj.file.name):
                    return None
            except Exception:
                return None
            request = self.context.get('request')
            if request:
                # Build absolute URL for media file
                return request.build_absolute_uri(obj.file.url)
            # Fallback: relative URL
            return obj.file.url if obj.file else None
        return None

    def get_file_size_mb(self, obj):
        if obj.file_size:
            return round(obj.file_size / (1024 * 1024), 2)
        return None

    def create(self, validated_data):
        pdf = TeacherPDF.objects.create(**validated_data)
        if pdf.file:
            try:
                size = pdf.file.size
            except Exception:
                size = 0
            if size <= 0:
                pdf.delete()  # Do not keep 0-byte files (would show empty in viewer)
                raise serializers.ValidationError({'file': 'Uploaded file is empty or unreadable.'})
            pdf.file_size = size
            pdf.save(update_fields=['file_size'])
        return pdf
