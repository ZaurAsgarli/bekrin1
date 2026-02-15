"""
Question Bank & Exam API (teacher + student).
Visibility: students see exams only when status=active and now in [start_time, end_time].
Results visible only when is_result_published and manual check done.
"""
import base64
import re
from decimal import Decimal
from django.core.files.base import ContentFile
from django.utils import timezone
from django.db import transaction
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from accounts.permissions import IsTeacher, IsStudent
from datetime import timedelta
from tests.models import (
    QuestionTopic,
    Question,
    QuestionOption,
    Exam,
    ExamRun,
    ExamQuestion,
    ExamAttempt,
    ExamAnswer,
    ExamAttemptCanvas,
    TeacherPDF,
    ExamAssignment,
    ExamStudentAssignment,
)
from groups.models import Group
from tests.serializers import (
    QuestionTopicSerializer,
    QuestionSerializer,
    QuestionCreateSerializer,
    QuestionOptionSerializer,
    ExamSerializer,
    ExamDetailSerializer,
    ExamQuestionSerializer,
    ExamRunSerializer,
    QuestionOptionPublicSerializer,
    QuestionPublicSerializer,
    TeacherPDFSerializer,
)
from tests.evaluate import evaluate_open_single_value
from tests.answer_key import validate_answer_key_json


def _now():
    return timezone.now()


def _build_canvas_response(canvas, request=None):
    """Build canvas dict with image_url."""
    if not canvas:
        return None
    data = {
        'canvasId': canvas.id,
        'questionId': canvas.question_id,
        'updatedAt': canvas.updated_at.isoformat(),
    }
    if canvas.image:
        if request:
            data['imageUrl'] = request.build_absolute_uri(canvas.image.url)
        else:
            data['imageUrl'] = canvas.image.url
    else:
        data['imageUrl'] = None
    return data


# ---------- Teacher: Question topics ----------
@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated, IsTeacher])
def teacher_question_topics_view(request):
    if request.method == 'GET':
        topics = QuestionTopic.objects.filter(is_active=True, is_archived=False).order_by('order', 'name')
        return Response(QuestionTopicSerializer(topics, many=True).data)
    if request.method == 'POST':
        s = QuestionTopicSerializer(data=request.data)
        if s.is_valid():
            s.save()
            return Response(s.data, status=status.HTTP_201_CREATED)
        return Response(s.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['DELETE'])
@permission_classes([IsAuthenticated, IsTeacher])
def teacher_question_topic_delete_view(request, pk):
    """Archive: set is_archived=True (soft delete)."""
    try:
        topic = QuestionTopic.objects.get(pk=pk)
    except QuestionTopic.DoesNotExist:
        return Response({'detail': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
    topic.is_archived = True
    topic.save(update_fields=['is_archived'])
    return Response(status=status.HTTP_204_NO_CONTENT)


# ---------- Teacher: Questions ----------
@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated, IsTeacher])
def teacher_questions_view(request):
    if request.method == 'GET':
        topic_id = request.query_params.get('topic', '').strip()
        type_filter = request.query_params.get('type', '').strip()
        qs = Question.objects.filter(is_active=True, is_archived=False).select_related('topic').prefetch_related('options')
        qs = qs.filter(topic__is_archived=False)
        if topic_id:
            try:
                qs = qs.filter(topic_id=int(topic_id))
            except ValueError:
                pass
        if type_filter:
            qs = qs.filter(type=type_filter)
        qs = qs.order_by('topic', 'id')
        return Response(QuestionSerializer(qs, many=True).data)
    if request.method == 'POST':
        s = QuestionCreateSerializer(data=request.data)
        if s.is_valid():
            q = s.save(created_by=request.user)
            return Response(QuestionSerializer(q).data, status=status.HTTP_201_CREATED)
        return Response(s.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated, IsTeacher])
def teacher_question_detail_view(request, pk):
    try:
        q = Question.objects.prefetch_related('options').get(pk=pk)
    except Question.DoesNotExist:
        return Response({'detail': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
    if request.method == 'GET':
        return Response(QuestionSerializer(q).data)
    if request.method == 'PATCH':
        s = QuestionCreateSerializer(q, data=request.data, partial=True)
        if s.is_valid():
            s.save()
            return Response(QuestionSerializer(q).data)
        return Response(s.errors, status=status.HTTP_400_BAD_REQUEST)
    if request.method == 'DELETE':
        now = _now()
        q.is_archived = True
        q.archived_at = now
        q.save(update_fields=['is_archived', 'archived_at'])
        return Response(status=status.HTTP_204_NO_CONTENT)


# ---------- Teacher: Exams ----------
def _validate_exam_composition(exam):
    """
    Validate question composition rules (MƏCBURİ).
    Quiz: 15 sual = 12 closed + 3 open, situasiya olmamalıdır.
    Exam: 30 sual = 22 closed + 5 open + 3 situation.
    Returns (is_valid, error_message).
    """
    # PDF/JSON: validate from answer_key_json
    if exam.source_type in ('PDF', 'JSON') and exam.answer_key_json and isinstance(exam.answer_key_json, dict):
        is_valid, err = _validate_exam_composition_from_answer_key(exam.answer_key_json)
        return is_valid, err
    # BANK
    eqs = list(ExamQuestion.objects.filter(exam=exam).select_related('question').order_by('order'))
    if not eqs:
        return False, "İmtahanda heç bir sual yoxdur"

    closed_count = sum(1 for eq in eqs if eq.question.type == 'MULTIPLE_CHOICE')
    open_count = sum(1 for eq in eqs if eq.question.type in ('OPEN_SINGLE_VALUE', 'OPEN_ORDERED', 'OPEN_UNORDERED'))
    situation_count = sum(1 for eq in eqs if eq.question.type == 'SITUATION')
    total = len(eqs)

    if exam.type == 'quiz':
        if total != 15:
            return False, f"Quiz 15 sual olmalıdır. Hazırda {total} sual var."
        if closed_count != 12:
            return False, f"Quiz-də dəqiq 12 qapalı sual olmalıdır. Hazırda {closed_count} var."
        if open_count != 3:
            return False, f"Quiz-də dəqiq 3 açıq sual olmalıdır. Hazırda {open_count} var."
        if situation_count != 0:
            return False, f"Quiz-də situasiya sualı olmamalıdır. Hazırda {situation_count} var."
    elif exam.type == 'exam':
        if total != 30:
            return False, f"İmtahan 30 sual olmalıdır. Hazırda {total} sual var."
        if closed_count != 22:
            return False, f"İmtahanda dəqiq 22 qapalı sual olmalıdır. Hazırda {closed_count} var."
        if open_count != 5:
            return False, f"İmtahanda dəqiq 5 açıq sual olmalıdır. Hazırda {open_count} var."
        if situation_count != 3:
            return False, f"İmtahanda dəqiq 3 situasiya sualı olmalıdır. Hazırda {situation_count} var."

    return True, None


def _validate_exam_composition_from_answer_key(answer_key):
    """Validate composition from answer_key_json. Returns (is_valid, error_message)."""
    is_valid, errors = validate_answer_key_json(answer_key)
    if not is_valid and errors:
        return False, errors[0] if len(errors) == 1 else '; '.join(errors[:5])
    return True, None


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated, IsTeacher])
def teacher_exams_view(request):
    if request.method == 'GET':
        exams = Exam.objects.filter(created_by=request.user, is_archived=False).select_related(
            'created_by', 'pdf_document'
        ).prefetch_related(
            'exam_questions__question', 'assignments__group', 'student_assignments'
        ).order_by('-start_time')
        return Response(ExamSerializer(exams, many=True).data)
    if request.method == 'POST':
        data = request.data.copy()
        source_type = (data.get('source_type') or 'BANK').upper()
        if source_type not in ('BANK', 'PDF', 'JSON'):
            return Response({'detail': 'source_type must be BANK, PDF, or JSON'}, status=status.HTTP_400_BAD_REQUEST)

        # PDF/JSON: require answer_key (answer_key_json or json_import)
        answer_key = data.get('answer_key_json') or data.get('json_import')
        if source_type in ('PDF', 'JSON'):
            if not answer_key:
                return Response({'detail': 'answer_key_json or json_import required for PDF/JSON source'}, status=status.HTTP_400_BAD_REQUEST)
            is_valid, err = _validate_exam_composition_from_answer_key(answer_key)
            if not is_valid:
                return Response({'detail': err, 'errors': err if isinstance(err, list) else [err]}, status=status.HTTP_400_BAD_REQUEST)
            exam_type = answer_key.get('type') or 'quiz'
            data['type'] = exam_type
            data['answer_key_json'] = answer_key
        if source_type == 'PDF':
            pdf_id = data.get('pdf_id') or data.get('pdfId')
            if pdf_id:
                try:
                    pdf = TeacherPDF.objects.get(pk=int(pdf_id), teacher=request.user, is_archived=False, is_deleted=False)
                    data['pdf_document_id'] = pdf.id
                except (TeacherPDF.DoesNotExist, ValueError, TypeError):
                    return Response({'detail': 'PDF not found or not owned by teacher'}, status=status.HTTP_400_BAD_REQUEST)
        elif source_type == 'BANK':
            data.pop('answer_key_json', None)
            data.pop('json_import', None)
            data.pop('pdf_document_id', None)

        s = ExamSerializer(data=data)
        if s.is_valid():
            exam = s.save(created_by=request.user)
            update_f = ['max_score']
            exam.source_type = source_type
            update_f.append('source_type')
            if not exam.max_score:
                exam.max_score = 100 if exam.type == 'quiz' else 150
            if source_type in ('PDF', 'JSON') and answer_key:
                exam.answer_key_json = answer_key
                update_f.append('answer_key_json')
            exam.save(update_fields=update_f)
            if source_type == 'BANK':
                question_ids = data.get('question_ids') or data.get('questionIds') or []
                if isinstance(question_ids, list) and question_ids:
                    for idx, qid in enumerate(question_ids):
                        try:
                            q = Question.objects.get(pk=int(qid), is_active=True, is_archived=False)
                            ExamQuestion.objects.get_or_create(exam=exam, question=q, defaults={'order': idx})
                        except (Question.DoesNotExist, ValueError, TypeError):
                            pass
            return Response(ExamSerializer(exam).data, status=status.HTTP_201_CREATED)
        return Response(s.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated, IsTeacher])
def teacher_exam_detail_view(request, pk):
    try:
        exam = Exam.objects.prefetch_related(
            'exam_questions__question', 'assignments__group', 'runs__group', 'runs__student'
        ).select_related('pdf_document').get(pk=pk, created_by=request.user)
    except Exam.DoesNotExist:
        return Response({'detail': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
    if request.method == 'GET':
        return Response(ExamDetailSerializer(exam, context={'request': request}).data)
    if request.method == 'PATCH':
        s = ExamSerializer(exam, data=request.data, partial=True)
        if s.is_valid():
            s.save()
            # Validate composition if trying to activate
            if request.data.get('status') == 'active':
                is_valid, error_msg = _validate_exam_composition(exam)
                if not is_valid:
                    exam.status = 'draft'
                    exam.save(update_fields=['status'])
                    return Response({'detail': error_msg}, status=status.HTTP_400_BAD_REQUEST)
                # Ghost validation: require duration and at least one target
                if (exam.duration_minutes or 0) <= 0:
                    exam.status = 'draft'
                    exam.save(update_fields=['status'])
                    return Response({'detail': 'Aktiv imtahan üçün duration_minutes tələb olunur.'}, status=status.HTTP_400_BAD_REQUEST)
                has_group = ExamAssignment.objects.filter(exam=exam, is_active=True).exists()
                has_student = ExamStudentAssignment.objects.filter(exam=exam, is_active=True).exists()
                if not has_group and not has_student:
                    exam.status = 'draft'
                    exam.save(update_fields=['status'])
                    return Response({'detail': 'Aktiv imtahan üçün ən azı bir qrup və ya şagird təyin edilməlidir.'}, status=status.HTTP_400_BAD_REQUEST)
            return Response(ExamSerializer(exam).data)
        return Response(s.errors, status=status.HTTP_400_BAD_REQUEST)
    if request.method == 'DELETE':
        now = _now()
        exam.is_archived = True
        exam.archived_at = now
        exam.save(update_fields=['is_archived', 'archived_at'])
        return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsTeacher])
def teacher_exam_add_question_view(request, exam_id):
    try:
        exam = Exam.objects.get(pk=exam_id)
    except Exam.DoesNotExist:
        return Response({'detail': 'Exam not found'}, status=status.HTTP_404_NOT_FOUND)
    question_id = request.data.get('question_id') or request.data.get('questionId')
    if not question_id:
        return Response({'detail': 'question_id required'}, status=status.HTTP_400_BAD_REQUEST)
    try:
        question = Question.objects.get(pk=question_id, is_active=True, is_archived=False)
    except Question.DoesNotExist:
        return Response({'detail': 'Question not found'}, status=status.HTTP_404_NOT_FOUND)
    order = ExamQuestion.objects.filter(exam=exam).count()
    eq, created = ExamQuestion.objects.get_or_create(exam=exam, question=question, defaults={'order': order})
    if not created:
        return Response(ExamQuestionSerializer(eq).data)
    return Response(ExamQuestionSerializer(eq).data, status=status.HTTP_201_CREATED)


@api_view(['DELETE'])
@permission_classes([IsAuthenticated, IsTeacher])
def teacher_exam_remove_question_view(request, exam_id, question_id):
    try:
        exam = Exam.objects.get(pk=exam_id)
    except Exam.DoesNotExist:
        return Response({'detail': 'Exam not found'}, status=status.HTTP_404_NOT_FOUND)
    deleted, _ = ExamQuestion.objects.filter(exam=exam, question_id=question_id).delete()
    return Response(status=status.HTTP_204_NO_CONTENT if deleted else status.HTTP_404_NOT_FOUND)


@api_view(['POST', 'DELETE'])
@permission_classes([IsAuthenticated, IsTeacher])
def teacher_exam_assign_groups_view(request, exam_id):
    """Assign exam to groups. POST: assign groups, DELETE: remove assignment."""
    try:
        exam = Exam.objects.get(pk=exam_id, created_by=request.user)
    except Exam.DoesNotExist:
        return Response({'detail': 'Exam not found'}, status=status.HTTP_404_NOT_FOUND)
    
    if request.method == 'POST':
        group_ids = request.data.get('groupIds') or request.data.get('group_ids') or []
        if not isinstance(group_ids, list):
            return Response({'detail': 'groupIds must be a list'}, status=status.HTTP_400_BAD_REQUEST)
        
        groups = Group.objects.filter(id__in=group_ids, created_by=request.user)
        if groups.count() != len(group_ids):
            return Response({'detail': 'Some groups not found or not owned by teacher'}, status=status.HTTP_400_BAD_REQUEST)
        
        created = []
        for group in groups:
            assignment, _ = ExamAssignment.objects.get_or_create(exam=exam, group=group)
            created.append({'examId': exam.id, 'groupId': group.id, 'groupName': group.name})
        
        return Response({'assignments': created}, status=status.HTTP_201_CREATED)
    
    if request.method == 'DELETE':
        group_id = request.data.get('groupId') or request.data.get('group_id')
        if not group_id:
            return Response({'detail': 'groupId required'}, status=status.HTTP_400_BAD_REQUEST)
        deleted, _ = ExamAssignment.objects.filter(exam=exam, group_id=group_id).delete()
        return Response(status=status.HTTP_204_NO_CONTENT if deleted else status.HTTP_404_NOT_FOUND)


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsTeacher])
def teacher_exam_start_now_view(request, exam_id):
    """
    Activate exam for targets: group_ids and/or student_id.
    Per-assignment timing: each target gets start_time=now, end_time=now+duration.
    Does NOT remove existing assignments; adds/updates only the specified targets.
    """
    from datetime import timedelta
    from django.conf import settings
    try:
        exam = Exam.objects.get(pk=exam_id, created_by=request.user)
    except Exam.DoesNotExist:
        return Response({'error': 'Exam not found'}, status=status.HTTP_404_NOT_FOUND)
    
    is_valid, error_msg = _validate_exam_composition(exam)
    if not is_valid:
        return Response({'error': error_msg}, status=status.HTTP_400_BAD_REQUEST)
    
    group_ids = request.data.get('groupIds') or request.data.get('group_ids') or []
    if not isinstance(group_ids, list):
        group_ids = []
    student_id = request.data.get('studentId') or request.data.get('student_id')
    duration_minutes = request.data.get('durationMinutes') or request.data.get('duration_minutes') or exam.duration_minutes
    
    if not duration_minutes:
        return Response({'error': 'durationMinutes required'}, status=status.HTTP_400_BAD_REQUEST)
    
    if not group_ids and not student_id:
        return Response({'error': 'At least one target required: groupIds or studentId'}, status=status.HTTP_400_BAD_REQUEST)
    
    now = _now()
    end_time = now + timedelta(minutes=int(duration_minutes))
    duration_int = int(duration_minutes)
    
    with transaction.atomic():
        exam.status = 'active'
        exam.save(update_fields=['status'])
        
        # Per-assignment timing: add/update targets, do NOT delete existing
        if group_ids:
            groups_qs = Group.objects.filter(id__in=group_ids)
            if not getattr(settings, 'SINGLE_TENANT', True):
                groups_qs = groups_qs.filter(created_by=request.user)
            for group in groups_qs:
                ass, _ = ExamAssignment.objects.update_or_create(
                    exam=exam, group=group,
                    defaults={
                        'start_time': now,
                        'end_time': end_time,
                        'duration_minutes': duration_int,
                        'is_active': True,
                    }
                )
        
        if student_id:
            from accounts.models import User
            try:
                student = User.objects.get(pk=int(student_id), role='student')
                org_id = getattr(request.user, 'organization_id', None)
                if org_id and getattr(student, 'organization_id', None) != org_id:
                    pass
                else:
                    ExamStudentAssignment.objects.update_or_create(
                        exam=exam, student=student,
                        defaults={
                            'start_time': now,
                            'end_time': end_time,
                            'duration_minutes': duration_int,
                            'is_active': True,
                        }
                    )
            except (User.DoesNotExist, ValueError, TypeError):
                pass
    
    return Response(ExamSerializer(exam).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsTeacher])
def teacher_exam_stop_view(request, exam_id):
    """Stop exam: set status to finished. Students can no longer access."""
    try:
        exam = Exam.objects.get(pk=exam_id, created_by=request.user)
    except Exam.DoesNotExist:
        return Response({'error': 'Exam not found'}, status=status.HTTP_404_NOT_FOUND)
    
    exam.status = 'finished'
    exam.save(update_fields=['status'])
    return Response(ExamSerializer(exam).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsTeacher])
def teacher_exam_create_run_view(request, exam_id):
    """
    POST /api/teacher/exams/{id}/create-run
    Body: { groupId?, studentId?, duration_minutes, start_now?: true }
    Returns: { runId, start_at, end_at }
    """
    try:
        exam = Exam.objects.get(pk=exam_id, created_by=request.user)
    except Exam.DoesNotExist:
        return Response({'detail': 'Exam not found'}, status=status.HTTP_404_NOT_FOUND)
    is_valid, err = _validate_exam_composition(exam)
    if not is_valid:
        return Response({'detail': err}, status=status.HTTP_400_BAD_REQUEST)
    group_id = request.data.get('groupId') or request.data.get('group_id')
    student_id = request.data.get('studentId') or request.data.get('student_id')
    duration_minutes = request.data.get('duration_minutes') or request.data.get('durationMinutes')
    if not duration_minutes:
        return Response({'detail': 'duration_minutes required'}, status=status.HTTP_400_BAD_REQUEST)
    duration_minutes = int(duration_minutes)
    if not group_id and not student_id:
        return Response({'detail': 'groupId or studentId required'}, status=status.HTTP_400_BAD_REQUEST)
    now = _now()
    start_now = request.data.get('start_now') or request.data.get('startNow')
    start_at = now if start_now else now
    end_at = start_at + timedelta(minutes=duration_minutes)
    run = ExamRun.objects.create(
        exam=exam,
        group_id=int(group_id) if group_id else None,
        student_id=int(student_id) if student_id else None,
        start_at=start_at,
        end_at=end_at,
        duration_minutes=duration_minutes,
        status='active' if start_now else 'scheduled',
        created_by=request.user,
    )
    return Response({
        'runId': run.id,
        'start_at': run.start_at.isoformat(),
        'end_at': run.end_at.isoformat(),
        'duration_minutes': run.duration_minutes,
    }, status=status.HTTP_201_CREATED)


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsTeacher])
def teacher_exam_runs_list_view(request, exam_id):
    """GET /api/teacher/exams/{id}/runs - List runs for exam."""
    try:
        exam = Exam.objects.get(pk=exam_id, created_by=request.user)
    except Exam.DoesNotExist:
        return Response({'detail': 'Exam not found'}, status=status.HTTP_404_NOT_FOUND)
    from django.db.models import Count, Q
    runs = ExamRun.objects.filter(exam=exam).select_related('group', 'student').annotate(
        _attempt_count=Count('attempts', filter=Q(attempts__is_archived=False))
    ).order_by('-start_at')
    return Response(ExamRunSerializer(runs, many=True, context={'request': request}).data)


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsTeacher])
def teacher_run_attempts_view(request, run_id):
    """GET /api/teacher/runs/{runId}/attempts - List attempts for a run."""
    try:
        run = ExamRun.objects.select_related('exam').get(pk=run_id, exam__created_by=request.user)
    except ExamRun.DoesNotExist:
        return Response({'detail': 'Run not found'}, status=status.HTTP_404_NOT_FOUND)
    attempts = ExamAttempt.objects.filter(exam_run=run, is_archived=False).select_related(
        'student', 'student__student_profile'
    ).order_by('-started_at')
    data = []
    for a in attempts:
        exam = run.exam
        max_s = float(exam.max_score or (100 if exam.type == 'quiz' else 150))
        final = float(a.manual_score) if a.manual_score is not None else float(a.auto_score or 0)
        data.append({
            'id': a.id,
            'studentId': a.student_id,
            'studentName': a.student.full_name,
            'status': 'SUBMITTED' if a.finished_at else 'IN_PROGRESS',
            'startedAt': a.started_at.isoformat(),
            'finishedAt': a.finished_at.isoformat() if a.finished_at else None,
            'autoScore': float(a.auto_score or 0),
            'manualScore': float(a.manual_score) if a.manual_score is not None else None,
            'finalScore': final,
            'maxScore': max_s,
            'isChecked': a.is_checked,
            'isPublished': a.is_result_published,
        })
    return Response({'attempts': data})


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsTeacher])
def teacher_run_reset_student_view(request, run_id):
    """POST /api/teacher/runs/{runId}/reset-student - Body: { studentId }. Mark attempt RESTARTED, student can start again."""
    try:
        run = ExamRun.objects.get(pk=run_id, exam__created_by=request.user)
    except ExamRun.DoesNotExist:
        return Response({'detail': 'Run not found'}, status=status.HTTP_404_NOT_FOUND)
    student_id = request.data.get('studentId') or request.data.get('student_id')
    if not student_id:
        return Response({'detail': 'studentId required'}, status=status.HTTP_400_BAD_REQUEST)
    student_id = int(student_id)
    attempt = ExamAttempt.objects.filter(exam_run=run, student_id=student_id).order_by('-started_at').first()
    if not attempt:
        return Response({'detail': 'No attempt found for this student in this run'}, status=status.HTTP_404_NOT_FOUND)
    now = _now()
    with transaction.atomic():
        attempt.status = 'RESTARTED'
        attempt.save(update_fields=['status'])
        ExamStudentAssignment.objects.update_or_create(
            exam=run.exam,
            student_id=student_id,
            defaults={
                'start_time': now,
                'end_time': now + timedelta(minutes=run.duration_minutes),
                'duration_minutes': run.duration_minutes,
                'is_active': True,
            }
        )
    return Response({
        'message': 'Şagird yenidən başlaya bilər',
        'studentId': student_id,
        'runId': run.id,
    })


# ---------- Student: List active exam RUNS (per-run time window) ----------
@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStudent])
def student_exams_list_view(request):
    """Return ACTIVE runs available to student (by group membership or direct assignment)."""
    from groups.models import GroupStudent
    from students.models import StudentProfile
    from django.db.models import Q
    now = _now()
    try:
        student_profile = request.user.student_profile
    except StudentProfile.DoesNotExist:
        student_profile = None
    if not student_profile:
        return Response([])
    group_ids = list(
        GroupStudent.objects.filter(
            student_profile=student_profile,
            active=True,
            left_at__isnull=True,
        ).values_list('group_id', flat=True)
    )
    runs = ExamRun.objects.filter(
        status='active',
        exam__is_archived=False,
    ).filter(
        Q(group_id__in=group_ids) | Q(student=request.user)
    ).filter(
        start_at__lte=now,
        end_at__gte=now,
    ).select_related('exam').order_by('end_at')
    data = []
    for run in runs:
        remaining_seconds = max(0, int((run.end_at - now).total_seconds()))
        data.append({
            'runId': run.id,
            'examId': run.exam_id,
            'id': run.exam_id,
            'title': run.exam.title,
            'type': run.exam.type,
            'sourceType': run.exam.source_type,
            'startTime': run.start_at.isoformat(),
            'endTime': run.end_at.isoformat(),
            'durationMinutes': run.duration_minutes,
            'remainingSeconds': remaining_seconds,
        })
    return Response(data)


# ---------- Student: List my exam results (all submitted, published or not) ----------
@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStudent])
def student_exam_my_results_view(request):
    """GET /api/student/exams/my-results - List student's submitted exam attempts (incl. unpublished)."""
    exam_type = (request.query_params.get('type') or '').strip().lower()
    attempts = ExamAttempt.objects.filter(
        student=request.user,
        finished_at__isnull=False,
        is_archived=False,
    ).exclude(status='RESTARTED').select_related('exam').order_by('-finished_at')
    if exam_type in ('quiz', 'exam'):
        attempts = attempts.filter(exam__type=exam_type)
    data = []
    for a in attempts:
        max_score = float(a.exam.max_score or (100 if a.exam.type == 'quiz' else 150))
        is_published = a.exam.is_result_published and a.is_checked
        status_enum = 'PUBLISHED' if is_published else ('WAITING_MANUAL' if a.is_checked else 'SUBMITTED')
        data.append({
            'attemptId': a.id,
            'examId': a.exam_id,
            'examTitle': a.exam.title,
            'examType': a.exam.type,
            'title': a.exam.title,
            'status': status_enum,
            'is_result_published': is_published,
            'autoScore': float(a.auto_score or 0) if a.auto_score is not None else None,
            'manualScore': float(a.manual_score) if a.manual_score is not None else None,
            'totalScore': float(a.manual_score if a.manual_score is not None else a.auto_score or 0) if is_published else None,
            'maxScore': max_score,
            'score': float(a.manual_score if a.manual_score is not None else a.auto_score or 0) if is_published else None,
            'submittedAt': a.finished_at.isoformat() if a.finished_at else None,
            'finishedAt': a.finished_at.isoformat() if a.finished_at else None,
        })
    return Response(data)


def _get_student_assignment_context(exam, student):
    """Get assignment context for student: (start_time, end_time, duration_minutes). Uses assignment-level or exam-level."""
    from groups.models import GroupStudent
    from students.models import StudentProfile
    from django.db.models import Q
    now = timezone.now()
    try:
        sp = student.student_profile
    except Exception:
        sp = None
    group_ids = list(
        GroupStudent.objects.filter(
            student_profile=sp,
            active=True,
            left_at__isnull=True,
        ).values_list('group_id', flat=True)
    ) if sp else []
    # Group assignments
    for ass in ExamAssignment.objects.filter(exam=exam, group_id__in=group_ids, is_active=True):
        st = ass.start_time or exam.start_time
        et = ass.end_time or exam.end_time
        dur = ass.duration_minutes or exam.duration_minutes
        if st and et and st <= now <= et:
            return st, et, dur
    # Direct student assignment
    for ass in ExamStudentAssignment.objects.filter(exam=exam, student=student, is_active=True):
        st = ass.start_time or exam.start_time
        et = ass.end_time or exam.end_time
        dur = ass.duration_minutes or exam.duration_minutes
        if st and et and st <= now <= et:
            return st, et, dur
    # Legacy: exam-level timing
    if exam.start_time and exam.end_time and exam.start_time <= now <= exam.end_time:
        return exam.start_time, exam.end_time, exam.duration_minutes or 60
    return None, None, None


def _student_has_run_access(run, user):
    """Check if student has access to this run (group membership or direct)."""
    from groups.models import GroupStudent
    from students.models import StudentProfile
    if run.student_id == user.id:
        return True
    try:
        sp = user.student_profile
    except Exception:
        return False
    if run.group_id is None:
        return False
    return GroupStudent.objects.filter(
        group_id=run.group_id,
        student_profile=sp,
        active=True,
        left_at__isnull=True,
    ).exists()


def _build_pdf_json_questions(answer_key, request, shuffle_options=True):
    """Build questions list from answer_key_json: order mc, open, situation. Shuffle MC options."""
    import random
    questions_raw = answer_key.get('questions') or []
    kind_order = {'mc': 0, 'open': 1, 'situation': 2}
    sorted_q = sorted(questions_raw, key=lambda q: (kind_order.get((q.get('kind') or '').lower(), 99), q.get('number', 0)))
    out = []
    for q in sorted_q:
        num = q.get('number')
        kind = (q.get('kind') or 'mc').lower()
        prompt = q.get('prompt') or ''
        item = {'questionNumber': num, 'number': num, 'kind': kind, 'type': kind, 'prompt': prompt, 'text': prompt}
        if kind == 'mc':
            opts = list(q.get('options') or [])
            if shuffle_options and opts:
                random.shuffle(opts)
            item['options'] = [{'key': o.get('key', ''), 'text': o.get('text', '')} for o in opts]
        elif kind == 'open':
            item['options'] = []
        elif kind == 'situation':
            item['options'] = []
        out.append(item)
    return out


# ---------- Student: Start by RUN (creates attempt linked to run; returns questions per source type) ----------
@api_view(['POST'])
@permission_classes([IsAuthenticated, IsStudent])
def student_run_start_view(request, run_id):
    """
    POST /api/student/runs/{runId}/start
    Creates attempt for this run. Returns questions: BANK (from ExamQuestion, options shuffled),
    PDF (pdf_url + questions from answer_key), JSON (questions only).
    """
    from groups.models import GroupStudent
    from students.models import StudentProfile
    from django.db.models import Q
    import random
    now = _now()
    try:
        run = ExamRun.objects.select_related('exam', 'exam__pdf_document').get(pk=run_id)
    except ExamRun.DoesNotExist:
        return Response({'detail': 'Run not found'}, status=status.HTTP_404_NOT_FOUND)
    if run.status != 'active' or run.start_at > now or run.end_at < now:
        return Response({'detail': 'Run is not active'}, status=status.HTTP_403_FORBIDDEN)
    try:
        sp = request.user.student_profile
    except Exception:
        sp = None
    if not sp:
        return Response({'detail': 'Student profile required'}, status=status.HTTP_403_FORBIDDEN)
    group_ids = list(GroupStudent.objects.filter(student_profile=sp, active=True, left_at__isnull=True).values_list('group_id', flat=True))
    if run.group_id not in group_ids and run.student_id != request.user.id:
        return Response({'detail': 'You do not have access to this run'}, status=status.HTTP_403_FORBIDDEN)

    exam = run.exam
    existing = ExamAttempt.objects.filter(exam_run=run, student=request.user).exclude(status='RESTARTED').order_by('-started_at').first()
    attempt = None
    if existing:
        if existing.finished_at:
            return Response({'detail': 'Already submitted', 'attemptId': existing.id, 'status': 'SUBMITTED'}, status=status.HTTP_400_BAD_REQUEST)
        if existing.expires_at and now > existing.expires_at:
            existing.status = 'EXPIRED'
            existing.save(update_fields=['status'])
            return Response({'attemptId': existing.id, 'status': 'EXPIRED', 'questions': [], 'canvases': []})
        attempt = existing
    else:
        expires_at = run.end_at
        attempt = ExamAttempt.objects.create(
            exam=exam,
            exam_run=run,
            student=request.user,
            expires_at=expires_at,
            duration_minutes=run.duration_minutes,
            status='IN_PROGRESS',
        )

    # Build response by source type
    questions_data = []
    canvases_data = []
    pdf_url = None

    if exam.source_type == 'BANK':
        eqs = list(ExamQuestion.objects.filter(exam=exam).select_related('question').prefetch_related('question__options').order_by('order'))
        # Order: closed, open, situation
        type_order = {'MULTIPLE_CHOICE': 0, 'OPEN_SINGLE_VALUE': 1, 'OPEN_ORDERED': 1, 'OPEN_UNORDERED': 1, 'SITUATION': 2}
        eqs.sort(key=lambda eq: (type_order.get(eq.question.type, 99), eq.order))
        for eq in eqs:
            q = eq.question
            opts = list(q.options.order_by('order').values('id', 'text', 'order'))
            if q.type == 'MULTIPLE_CHOICE' and opts:
                random.shuffle(opts)
            questions_data.append({
                'examQuestionId': eq.id,
                'questionId': q.id,
                'questionNumber': q.id,
                'order': eq.order,
                'text': q.text,
                'type': q.type,
                'kind': 'mc' if q.type == 'MULTIPLE_CHOICE' else ('open' if q.type != 'SITUATION' else 'situation'),
                'options': [{'id': o['id'], 'text': o['text'], 'order': o['order']} for o in opts],
            })
        for c in ExamAttemptCanvas.objects.filter(attempt=attempt).select_related('question'):
            canvases_data.append(_build_canvas_response(c, request))
    else:
        # PDF or JSON
        if exam.pdf_document and exam.pdf_document.file:
            if request:
                pdf_url = request.build_absolute_uri(exam.pdf_document.file.url)
            else:
                pdf_url = exam.pdf_document.file.url
        ak = exam.answer_key_json or {}
        questions_data = _build_pdf_json_questions(ak, request, shuffle_options=True)
        for c in ExamAttemptCanvas.objects.filter(attempt=attempt):
            canvases_data.append({
                'canvasId': c.id,
                'questionId': c.question_id,
                'situationIndex': c.situation_index,
                'updatedAt': c.updated_at.isoformat(),
                'imageUrl': request.build_absolute_uri(c.image.url) if c.image and request else (c.image.url if c.image else None),
            })

    return Response({
        'attemptId': attempt.id,
        'examId': exam.id,
        'runId': run.id,
        'title': exam.title,
        'status': attempt.status,
        'sourceType': exam.source_type,
        'pdfUrl': pdf_url,
        'startedAt': attempt.started_at.isoformat(),
        'expiresAt': attempt.expires_at.isoformat() if attempt.expires_at else None,
        'endTime': run.end_at.isoformat(),
        'questions': questions_data,
        'canvases': canvases_data,
    })


# ---------- Student: Start exam (create attempt, return questions; do NOT send correct_answer) ----------
@api_view(['POST'])
@permission_classes([IsAuthenticated, IsStudent])
def student_exam_start_view(request, exam_id):
    from datetime import timedelta
    try:
        exam = Exam.objects.get(pk=exam_id)
    except Exam.DoesNotExist:
        return Response({'detail': 'Exam not found'}, status=status.HTTP_404_NOT_FOUND)
    now = _now()
    if exam.status != 'active':
        return Response({'detail': 'Exam is not available'}, status=status.HTTP_403_FORBIDDEN)
    _, _, duration_minutes = _get_student_assignment_context(exam, request.user)
    if duration_minutes is None:
        return Response({'detail': 'Exam is not available for you at this time'}, status=status.HTTP_403_FORBIDDEN)
    
    existing = ExamAttempt.objects.filter(exam=exam, student=request.user).order_by('-started_at').first()
    attempt = None
    # RESTARTED attempts are ignored - teacher allowed new attempt
    if existing and existing.status == 'RESTARTED':
        existing = None
    
    if existing:
        if existing.finished_at is not None:
            return Response({
                'detail': 'İmtahan yoxlaması söndürülüb',
                'code': 'EXAM_REVIEW_DISABLED',
                'attemptId': existing.id,
                'status': 'SUBMITTED',
            }, status=status.HTTP_400_BAD_REQUEST)
        if existing.expires_at and now > existing.expires_at:
            existing.status = 'EXPIRED'
            existing.save(update_fields=['status'])
            return Response({
                'attemptId': existing.id,
                'examId': exam.id,
                'title': exam.title,
                'status': 'EXPIRED',
                'expiresAt': existing.expires_at.isoformat() if existing.expires_at else None,
                'questions': [],
                'canvases': [],
            })
        if existing.status == 'IN_PROGRESS' and existing.expires_at and now <= existing.expires_at:
            attempt = existing
    else:
        expires_at = now + timedelta(minutes=int(duration_minutes))
        attempt = ExamAttempt.objects.create(
            exam=exam,
            student=request.user,
            expires_at=expires_at,
            duration_minutes=int(duration_minutes),
            status='IN_PROGRESS',
        )
    
    eqs = ExamQuestion.objects.filter(exam=exam).select_related('question').prefetch_related('question__options').order_by('order')
    questions_data = []
    for eq in eqs:
        q = eq.question
        options = list(q.options.order_by('order').values('id', 'text', 'order'))
        questions_data.append({
            'examQuestionId': eq.id,
            'questionId': q.id,
            'order': eq.order,
            'text': q.text,
            'type': q.type,
            'options': options,
        })
    canvases_data = []
    for c in ExamAttemptCanvas.objects.filter(attempt=attempt).select_related('question'):
        canvases_data.append(_build_canvas_response(c, request))
    return Response({
        'attemptId': attempt.id,
        'examId': exam.id,
        'title': exam.title,
        'status': attempt.status,
        'startedAt': attempt.started_at.isoformat(),
        'expiresAt': attempt.expires_at.isoformat() if attempt.expires_at else None,
        'endTime': attempt.expires_at.isoformat() if attempt.expires_at else exam.end_time.isoformat(),
        'questions': questions_data,
        'canvases': canvases_data,
    })


# ---------- Student: Submit exam (evaluate by option ID for MC; open rules for OPEN_*) ----------
@api_view(['POST'])
@permission_classes([IsAuthenticated, IsStudent])
def student_exam_submit_view(request, exam_id):
    try:
        exam = Exam.objects.get(pk=exam_id)
    except Exam.DoesNotExist:
        return Response({'detail': 'Exam not found'}, status=status.HTTP_404_NOT_FOUND)
    attempt_id = request.data.get('attemptId') or request.data.get('attempt_id')
    answers_payload = request.data.get('answers') or request.data.get('answers_list') or []
    if not attempt_id:
        return Response({'detail': 'attemptId required'}, status=status.HTTP_400_BAD_REQUEST)
    try:
        attempt = ExamAttempt.objects.select_related('exam').prefetch_related('exam__exam_questions__question__options').get(
            pk=attempt_id, exam=exam, student=request.user
        )
    except ExamAttempt.DoesNotExist:
        return Response({'detail': 'Attempt not found'}, status=status.HTTP_404_NOT_FOUND)
    if attempt.finished_at is not None:
        return Response({'detail': 'Already submitted'}, status=status.HTTP_400_BAD_REQUEST)
    now = _now()
    if attempt.expires_at and now > attempt.expires_at:
        attempt.status = 'EXPIRED'
        attempt.save(update_fields=['status'])
        return Response({'detail': 'Time has expired'}, status=status.HTTP_400_BAD_REQUEST)

    answers_by_question_id = {}
    answers_by_question_number = {}
    for a in answers_payload:
        if not a:
            continue
        qid = a.get('questionId') or a.get('question_id')
        qnum = a.get('questionNumber') or a.get('question_number')
        if qid is not None:
            try:
                answers_by_question_id[int(qid)] = a
            except (TypeError, ValueError):
                pass
        if qnum is not None:
            try:
                answers_by_question_number[int(qnum)] = a
            except (TypeError, ValueError):
                pass

    is_quiz = exam.type == 'quiz'
    if is_quiz:
        pts_per_auto = Decimal('100') / 15
        max_score = Decimal('100')
    else:
        total_units = 22 + 5 + 3 * 2
        pts_per_auto = Decimal('150') / total_units
        max_score = Decimal('150')

    total_score = Decimal('0')

    with transaction.atomic():
        if exam.source_type in ('PDF', 'JSON') and exam.answer_key_json and isinstance(exam.answer_key_json, dict):
            questions_list = exam.answer_key_json.get('questions') or []
            kind_order = {'mc': 0, 'open': 1, 'situation': 2}
            sorted_q = sorted(questions_list, key=lambda q: (kind_order.get((q.get('kind') or '').lower(), 99), q.get('number', 0)))
            for q_def in sorted_q:
                num = q_def.get('number')
                kind = (q_def.get('kind') or 'mc').lower()
                ans = answers_by_question_number.get(num) or answers_by_question_number.get(int(num) if num is not None else None) or {}
                selected_key = (ans.get('selectedOptionKey') or ans.get('selected_option_key') or '').strip().upper()
                text_answer = (ans.get('textAnswer') or ans.get('text_answer') or '').strip()
                requires_manual = False
                auto_score = Decimal('0')
                if kind == 'mc':
                    correct_key = (str(q_def.get('correct') or '').strip().upper())
                    if correct_key and selected_key and selected_key == correct_key:
                        auto_score = pts_per_auto
                elif kind == 'open':
                    rule = (q_def.get('open_rule') or 'EXACT_MATCH').strip().upper()
                    open_ans = q_def.get('open_answer')
                    if open_ans is not None and rule:
                        if evaluate_open_single_value(text_answer, open_ans, rule):
                            auto_score = pts_per_auto
                else:
                    requires_manual = True
                total_score += auto_score
                ExamAnswer.objects.create(
                    attempt=attempt,
                    question=None,
                    question_number=num,
                    selected_option_key=selected_key or None,
                    text_answer=text_answer or None,
                    auto_score=auto_score,
                    requires_manual_check=requires_manual,
                )
        else:
            eqs = list(ExamQuestion.objects.filter(exam=exam).select_related('question').prefetch_related('question__options').order_by('order'))
            for eq in eqs:
                q = eq.question
                ans = answers_by_question_id.get(q.id) or {}
                selected_option_id = ans.get('selectedOptionId') or ans.get('selected_option_id')
                text_answer = ans.get('textAnswer') or ans.get('text_answer') or ''
                requires_manual = False
                auto_score = Decimal('0')
                if q.type == 'MULTIPLE_CHOICE':
                    correct_id = None
                    if isinstance(q.correct_answer, dict) and 'option_id' in q.correct_answer:
                        correct_id = q.correct_answer.get('option_id')
                    elif isinstance(q.correct_answer, (int, float)):
                        correct_id = int(q.correct_answer)
                    if correct_id is not None and selected_option_id is not None:
                        if int(selected_option_id) == int(correct_id):
                            auto_score = pts_per_auto
                elif q.type in ('OPEN_SINGLE_VALUE', 'OPEN_ORDERED', 'OPEN_UNORDERED'):
                    rule = q.answer_rule_type
                    if not rule and q.type == 'OPEN_ORDERED':
                        rule = 'ORDERED_DIGITS'
                    elif not rule and q.type == 'OPEN_UNORDERED':
                        rule = 'UNORDERED_DIGITS'
                    if rule and q.correct_answer is not None:
                        if evaluate_open_single_value(text_answer, q.correct_answer, rule):
                            auto_score = pts_per_auto
                elif q.type == 'SITUATION':
                    requires_manual = True
                total_score += auto_score
                ExamAnswer.objects.create(
                    attempt=attempt,
                    question=q,
                    selected_option_id=int(selected_option_id) if selected_option_id is not None else None,
                    text_answer=text_answer or None,
                    auto_score=auto_score,
                    requires_manual_check=requires_manual,
                )
        attempt.finished_at = now
        attempt.auto_score = total_score
        attempt.status = 'SUBMITTED'
        attempt.save(update_fields=['finished_at', 'auto_score', 'status'])

    return Response({
        'attemptId': attempt.id,
        'autoScore': float(total_score),
        'maxScore': float(max_score),
        'finishedAt': attempt.finished_at.isoformat(),
    }, status=status.HTTP_200_OK)


# ---------- Student: Save canvas (SITUATION question drawing) ----------
@api_view(['POST', 'PUT'])
@permission_classes([IsAuthenticated, IsStudent])
def student_exam_canvas_save_view(request, attempt_id):
    """
    POST/PUT /api/student/exams/attempts/<attempt_id>/canvas
    Body: { questionId?, question_id?, situationIndex?, situation_index?, imageBase64?, strokes? }
    For BANK: questionId required. For PDF/JSON: situationIndex required.
    """
    try:
        attempt = ExamAttempt.objects.select_related('exam').get(pk=attempt_id, student=request.user)
    except ExamAttempt.DoesNotExist:
        return Response({'detail': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
    if attempt.finished_at is not None:
        return Response({'detail': 'Exam already submitted'}, status=status.HTTP_400_BAD_REQUEST)
    question_id = request.data.get('questionId') or request.data.get('question_id')
    situation_index = request.data.get('situationIndex') or request.data.get('situation_index')
    if situation_index is not None:
        try:
            situation_index = int(situation_index)
        except (TypeError, ValueError):
            situation_index = None
    if not question_id and situation_index is None:
        return Response({'detail': 'questionId or situationIndex required'}, status=status.HTTP_400_BAD_REQUEST)
    question = None
    if question_id:
        try:
            question = Question.objects.get(pk=question_id)
        except Question.DoesNotExist:
            return Response({'detail': 'Question not found'}, status=status.HTTP_404_NOT_FOUND)
        if question.type != 'SITUATION':
            return Response({'detail': 'Only SITUATION questions support canvas'}, status=status.HTTP_400_BAD_REQUEST)
        eq = ExamQuestion.objects.filter(exam=attempt.exam, question=question).first()
        if not eq:
            return Response({'detail': 'Question not in this exam'}, status=status.HTTP_400_BAD_REQUEST)
    image_base64 = request.data.get('imageBase64') or request.data.get('image_base64')
    strokes = request.data.get('strokes')
    if not image_base64 and not strokes:
        return Response({'detail': 'imageBase64 or strokes required'}, status=status.HTTP_400_BAD_REQUEST)
    if question is not None:
        canvas, created = ExamAttemptCanvas.objects.get_or_create(
            attempt=attempt, question=question,
            defaults={'strokes_json': strokes}
        )
    else:
        canvas, created = ExamAttemptCanvas.objects.get_or_create(
            attempt=attempt, situation_index=situation_index,
            defaults={'strokes_json': strokes}
        )
    if image_base64:
        m = re.match(r'^data:image/(\w+);base64,(.+)$', image_base64)
        if m:
            fmt, b64 = m.group(1), m.group(2)
        else:
            b64 = image_base64
            fmt = 'png'
        try:
            raw = base64.b64decode(b64)
        except Exception:
            return Response({'detail': 'Invalid base64'}, status=status.HTTP_400_BAD_REQUEST)
        if len(raw) > 3 * 1024 * 1024:
            return Response({'detail': 'Image too large (max 3MB)'}, status=status.HTTP_400_BAD_REQUEST)
        ext = 'png' if fmt.lower() == 'png' else 'jpg'
        canvas.image.save(f'q{question_id}_{attempt_id}.{ext}', ContentFile(raw), save=False)
    if strokes is not None:
        canvas.strokes_json = strokes
    canvas.save()
    return Response(_build_canvas_response(canvas, request), status=status.HTTP_200_OK)


# ---------- Student: Get attempt result (no questions/canvases; teacher-only for full detail) ----------
@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStudent])
def student_exam_result_view(request, exam_id, attempt_id):
    try:
        attempt = ExamAttempt.objects.select_related('exam').get(pk=attempt_id, exam_id=exam_id, student=request.user)
    except ExamAttempt.DoesNotExist:
        return Response({'detail': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
    if attempt.finished_at is None:
        return Response({'detail': 'Attempt not submitted yet'}, status=status.HTTP_400_BAD_REQUEST)
    if not attempt.exam.is_result_published:
        return Response({
            'attemptId': attempt.id,
            'examId': attempt.exam_id,
            'title': attempt.exam.title,
            'status': 'pending_manual',
            'message': 'Müəllim yoxlaması gözlənilir',
            'autoScore': None,
            'manualScore': None,
            'score': None,
            'maxScore': float(attempt.exam.max_score or 150),
            'finishedAt': attempt.finished_at.isoformat() if attempt.finished_at else None,
            'questions': [],
            'canvases': [],
        }, status=status.HTTP_200_OK)
    manual = attempt.manual_score
    auto = attempt.auto_score
    score = manual if manual is not None else auto
    return Response({
        'attemptId': attempt.id,
        'examId': attempt.exam_id,
        'title': attempt.exam.title,
        'status': 'published',
        'autoScore': float(attempt.auto_score or 0),
        'manualScore': float(manual) if manual is not None else None,
        'score': float(score) if score is not None else None,
        'maxScore': float(attempt.exam.max_score or 150),
        'finishedAt': attempt.finished_at.isoformat() if attempt.finished_at else None,
        'questions': [],
        'canvases': [],
    })


# ---------- Teacher: Grading ----------
@api_view(['GET'])
@permission_classes([IsAuthenticated, IsTeacher])
def teacher_exam_attempts_view(request, exam_id):
    """List attempts for an exam, filterable by group and status."""
    from django.conf import settings
    try:
        qs = Exam.objects.filter(pk=exam_id)
        if not getattr(settings, 'SINGLE_TENANT', True):
            qs = qs.filter(created_by=request.user)
        exam = qs.get()
    except Exam.DoesNotExist:
        return Response({'detail': 'Exam not found'}, status=status.HTTP_404_NOT_FOUND)
    
    group_id = request.query_params.get('groupId') or request.query_params.get('group_id')
    status_filter = request.query_params.get('status', '').strip()
    
    qs = ExamAttempt.objects.filter(exam=exam).select_related('student', 'student__student_profile').order_by('-started_at')
    show_archived = request.query_params.get('showArchived', 'false').lower() == 'true'
    if not show_archived:
        qs = qs.filter(is_archived=False)
    
    group_obj = None
    if group_id:
        try:
            gs = Group.objects.filter(pk=int(group_id))
            if not getattr(settings, 'SINGLE_TENANT', True):
                gs = gs.filter(created_by=request.user)
            group_obj = gs.get()
            student_ids = list(group_obj.group_students.filter(active=True, left_at__isnull=True).values_list('student_profile__user_id', flat=True))
            qs = qs.filter(student_id__in=student_ids)
        except (Group.DoesNotExist, ValueError):
            pass
    
    if status_filter == 'submitted':
        qs = qs.filter(finished_at__isnull=False)
    elif status_filter == 'waiting_manual':
        qs = qs.filter(finished_at__isnull=False).filter(
            answers__requires_manual_check=True
        ).distinct()
    elif status_filter == 'graded':
        qs = qs.filter(manual_score__isnull=False, is_checked=True)
    elif status_filter == 'published':
        qs = qs.filter(is_checked=True).filter(exam__is_result_published=True)
    
    attempts_data = []
    for attempt in qs:
        manual_pending = ExamAnswer.objects.filter(attempt=attempt, requires_manual_check=True).count()
        final_score = float(attempt.manual_score) if attempt.manual_score is not None else float(attempt.auto_score or 0)
        gid = group_obj.id if group_obj else None
        gname = group_obj.name if group_obj else None
        attempts_data.append({
            'id': attempt.id,
            'studentId': attempt.student.id,
            'studentName': attempt.student.full_name,
            'groupId': gid,
            'groupName': gname,
            'status': 'SUBMITTED' if attempt.finished_at else (getattr(attempt, 'status', None) or 'IN_PROGRESS'),
            'startedAt': attempt.started_at.isoformat(),
            'finishedAt': attempt.finished_at.isoformat() if attempt.finished_at else None,
            'submittedAt': attempt.finished_at.isoformat() if attempt.finished_at else None,
            'autoScore': float(attempt.auto_score or 0),
            'manualScore': float(attempt.manual_score) if attempt.manual_score is not None else None,
            'finalScore': final_score,
            'maxScore': float(exam.max_score or (100 if exam.type == 'quiz' else 150)),
            'manualPendingCount': manual_pending,
            'isChecked': attempt.is_checked,
            'isPublished': exam.is_result_published and attempt.is_checked,
            'isArchived': attempt.is_archived,
        })
    
    return Response({'attempts': attempts_data})


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsTeacher])
def teacher_exam_attempts_cleanup_view(request, exam_id):
    """
    Archive exam attempts (teacher cleanup). Does NOT delete data - sets is_archived=True.
    scope: exam | group | student
    group_id, student_id: optional, for scope
    only_unpublished: true (default) - only archive unpublished attempts
    """
    try:
        exam = Exam.objects.get(pk=exam_id, created_by=request.user)
    except Exam.DoesNotExist:
        return Response({'detail': 'Exam not found'}, status=status.HTTP_404_NOT_FOUND)
    
    scope = request.data.get('scope', 'exam')
    group_id = request.data.get('group_id') or request.data.get('groupId')
    student_id = request.data.get('student_id') or request.data.get('studentId')
    only_unpublished = request.data.get('only_unpublished', True)
    
    qs = ExamAttempt.objects.filter(exam=exam)
    if only_unpublished:
        qs = qs.filter(exam__is_result_published=False)
    if scope == 'group' and group_id:
        from groups.models import GroupStudent
        student_ids = list(GroupStudent.objects.filter(
            group_id=int(group_id),
            active=True,
            left_at__isnull=True,
        ).values_list('student_profile__user_id', flat=True))
        student_ids = [x for x in student_ids if x]
        qs = qs.filter(student_id__in=student_ids)
    elif scope == 'student' and student_id:
        qs = qs.filter(student_id=int(student_id))
    
    updated = qs.update(is_archived=True)
    return Response({'archived': updated, 'message': f'{updated} attempt(s) archived'})


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsTeacher])
def teacher_attempt_detail_view(request, attempt_id):
    """Get attempt detail with all answers for grading (BANK and PDF/JSON)."""
    from django.conf import settings
    try:
        qs = ExamAttempt.objects.select_related('exam', 'student').prefetch_related(
            'answers__question', 'answers__selected_option'
        ).filter(pk=attempt_id)
        if not getattr(settings, 'SINGLE_TENANT', True):
            qs = qs.filter(exam__created_by=request.user)
        attempt = qs.get()
    except ExamAttempt.DoesNotExist:
        return Response({'detail': 'Not found'}, status=status.HTTP_404_NOT_FOUND)

    answers_qs = attempt.answers.all()
    if attempt.exam.source_type == 'BANK':
        answers_qs = answers_qs.order_by('question__exam_questions__order')
    else:
        answers_qs = answers_qs.order_by('question_number')

    answers_data = []
    for answer in answers_qs:
        if answer.question_id:
            answers_data.append({
                'id': answer.id,
                'questionId': answer.question.id,
                'questionNumber': answer.question_number,
                'questionText': answer.question.text,
                'questionType': answer.question.type,
                'selectedOptionId': answer.selected_option_id,
                'selectedOptionKey': answer.selected_option_key,
                'textAnswer': answer.text_answer,
                'autoScore': float(answer.auto_score or 0),
                'requiresManualCheck': answer.requires_manual_check,
                'manualScore': float(answer.manual_score) if answer.manual_score is not None else None,
            })
        else:
            answers_data.append({
                'id': answer.id,
                'questionId': None,
                'questionNumber': answer.question_number,
                'questionText': f'Sual {answer.question_number}',
                'questionType': 'situation' if answer.requires_manual_check else 'open',
                'selectedOptionId': None,
                'selectedOptionKey': answer.selected_option_key,
                'textAnswer': answer.text_answer,
                'autoScore': float(answer.auto_score or 0),
                'requiresManualCheck': answer.requires_manual_check,
                'manualScore': float(answer.manual_score) if answer.manual_score is not None else None,
            })

    canvases_list = list(ExamAttemptCanvas.objects.filter(attempt=attempt).order_by('situation_index', 'question_id'))
    canvases_data = []
    for c in canvases_list:
        rec = _build_canvas_response(c, request) or {}
        if c.situation_index is not None:
            rec['situationIndex'] = c.situation_index
        canvases_data.append(rec)

    return Response({
        'attemptId': attempt.id,
        'examId': attempt.exam.id,
        'examTitle': attempt.exam.title,
        'sourceType': attempt.exam.source_type,
        'studentId': attempt.student.id,
        'studentName': attempt.student.full_name,
        'startedAt': attempt.started_at.isoformat(),
        'finishedAt': attempt.finished_at.isoformat() if attempt.finished_at else None,
        'autoScore': float(attempt.auto_score or 0),
        'manualScore': float(attempt.manual_score) if attempt.manual_score is not None else None,
        'maxScore': float(attempt.exam.max_score or (100 if attempt.exam.type == 'quiz' else 150)),
        'answers': answers_data,
        'canvases': canvases_data,
    })


def _situation_fraction_to_points(fraction, is_quiz, max_situation_points=None):
    """Map fraction 0, 2/3, 1, 4/3, 2 to points. One situation full = 1 * unit; 2x weight = 2*unit."""
    if max_situation_points is not None:
        unit = max_situation_points
    else:
        unit = Decimal('100') / 15 if is_quiz else (Decimal('150') / (22 + 5 + 3 * 2)) * 2
    if fraction in (0, '0'):
        return Decimal('0')
    if fraction in (2/3, '2/3', 0.667):
        return (unit * 2 / 3).quantize(Decimal('0.01'))
    if fraction in (1, '1'):
        return unit
    if fraction in (4/3, '4/3', 1.333):
        return (unit * 4 / 3).quantize(Decimal('0.01'))
    if fraction in (2, '2'):
        return (unit * 2).quantize(Decimal('0.01'))
    try:
        return Decimal(str(fraction)) * unit
    except Exception:
        return Decimal('0')


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsTeacher])
def teacher_attempt_grade_view(request, attempt_id):
    """Grade manual answers (manualScores by answer id, or per_situation_scores by situation index) and optionally publish."""
    try:
        attempt = ExamAttempt.objects.select_related('exam').prefetch_related('answers').get(pk=attempt_id, exam__created_by=request.user)
    except ExamAttempt.DoesNotExist:
        return Response({'detail': 'Not found'}, status=status.HTTP_404_NOT_FOUND)

    exam = attempt.exam
    is_quiz = exam.type == 'quiz'
    max_score = float(exam.max_score or (100 if is_quiz else 150))
    manual_scores = request.data.get('manualScores') or request.data.get('manual_scores') or {}
    per_situation_scores = request.data.get('per_situation_scores') or request.data.get('perSituationScores') or []
    publish = request.data.get('publish', False)
    notes = request.data.get('notes', '')

    total_manual = Decimal('0')
    with transaction.atomic():
        for answer_id_str, score_value in manual_scores.items():
            try:
                answer_id = int(answer_id_str)
                score = Decimal(str(score_value))
                answer = ExamAnswer.objects.get(pk=answer_id, attempt=attempt)
                answer.manual_score = score
                answer.save(update_fields=['manual_score'])
                total_manual += score
            except (ValueError, ExamAnswer.DoesNotExist):
                continue

        # per_situation_scores: [{index: 1, fraction: 0|"2/3"|1|"4/3"|2}, ...] - index 1-based situation order
        situation_answers = list(attempt.answers.filter(requires_manual_check=True).order_by('question_number'))
        for item in per_situation_scores:
            if not isinstance(item, dict):
                continue
            idx = item.get('index') or item.get('situationIndex')
            fraction = item.get('fraction') or item.get('score')
            if idx is None:
                continue
            try:
                idx = int(idx)
            except (TypeError, ValueError):
                continue
            if idx < 1 or idx > len(situation_answers):
                continue
            pts = _situation_fraction_to_points(fraction, is_quiz)
            ans = situation_answers[idx - 1]
            ans.manual_score = pts
            ans.save(update_fields=['manual_score'])
            total_manual += pts

        auto_total = sum(float(a.auto_score or 0) for a in attempt.answers.filter(requires_manual_check=False))
        attempt.manual_score = total_manual
        attempt.auto_score = Decimal(str(auto_total))
        attempt.is_checked = True
        attempt.save(update_fields=['manual_score', 'auto_score', 'is_checked'])

        if publish:
            attempt.exam.is_result_published = True
            attempt.exam.save(update_fields=['is_result_published'])

    final = float(total_manual) + sum(float(a.auto_score or 0) for a in attempt.answers.filter(requires_manual_check=False))
    if final > max_score:
        final = max_score
    return Response({
        'attemptId': attempt.id,
        'manualScore': float(attempt.manual_score or 0),
        'autoScore': float(attempt.auto_score or 0),
        'finalScore': final,
        'isPublished': attempt.exam.is_result_published,
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsTeacher])
def teacher_attempt_publish_view(request, attempt_id):
    """Publish/unpublish attempt result."""
    try:
        attempt = ExamAttempt.objects.select_related('exam').get(pk=attempt_id, exam__created_by=request.user)
    except ExamAttempt.DoesNotExist:
        return Response({'detail': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
    
    publish = request.data.get('publish', True)
    attempt.exam.is_result_published = publish
    attempt.exam.save(update_fields=['is_result_published'])
    
    return Response({'isPublished': publish})


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsTeacher])
def teacher_exam_reset_student_view(request, exam_id):
    """POST /api/teacher/exams/{examId}/reset-student - Reset latest attempt for a student. Body: { studentId }."""
    from datetime import timedelta
    try:
        exam = Exam.objects.get(pk=exam_id, created_by=request.user)
    except Exam.DoesNotExist:
        return Response({'detail': 'Exam not found'}, status=status.HTTP_404_NOT_FOUND)
    student_id = request.data.get('studentId') or request.data.get('student_id')
    if not student_id:
        return Response({'detail': 'studentId required'}, status=status.HTTP_400_BAD_REQUEST)
    attempt = ExamAttempt.objects.filter(exam=exam, student_id=student_id).order_by('-started_at').first()
    if not attempt:
        return Response({'detail': 'No attempt found for this student'}, status=status.HTTP_404_NOT_FOUND)
    duration_minutes = request.data.get('durationMinutes') or request.data.get('duration_minutes') or exam.duration_minutes or 60
    now = _now()
    end_time = now + timedelta(minutes=int(duration_minutes))
    with transaction.atomic():
        attempt.status = 'RESTARTED'
        attempt.save(update_fields=['status'])
        ExamStudentAssignment.objects.update_or_create(
            exam=exam,
            student_id=student_id,
            defaults={
                'start_time': now,
                'end_time': end_time,
                'duration_minutes': int(duration_minutes),
                'is_active': True,
            }
        )
    return Response({
        'message': 'Şagird yenidən başlaya bilər',
        'studentId': int(student_id),
        'durationMinutes': int(duration_minutes),
        'endTime': end_time.isoformat(),
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsTeacher])
def teacher_attempt_restart_view(request, attempt_id):
    """Restart exam for a single student: mark attempt as RESTARTED, create new assignment with duration."""
    from datetime import timedelta
    try:
        attempt = ExamAttempt.objects.select_related('exam', 'student').get(pk=attempt_id, exam__created_by=request.user)
    except ExamAttempt.DoesNotExist:
        return Response({'detail': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
    duration_minutes = request.data.get('durationMinutes') or request.data.get('duration_minutes') or attempt.exam.duration_minutes or 60
    now = _now()
    end_time = now + timedelta(minutes=int(duration_minutes))
    with transaction.atomic():
        attempt.status = 'RESTARTED'
        attempt.save(update_fields=['status'])
        ExamStudentAssignment.objects.update_or_create(
            exam=attempt.exam,
            student=attempt.student,
            defaults={
                'start_time': now,
                'end_time': end_time,
                'duration_minutes': int(duration_minutes),
                'is_active': True,
            }
        )
    return Response({
        'message': 'Attempt restarted. Student can now start a new attempt.',
        'studentId': attempt.student.id,
        'durationMinutes': int(duration_minutes),
        'endTime': end_time.isoformat(),
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsTeacher])
def teacher_attempt_reopen_view(request, attempt_id):
    """Reopen attempt for re-grading."""
    try:
        attempt = ExamAttempt.objects.select_related('exam').get(pk=attempt_id, exam__created_by=request.user)
    except ExamAttempt.DoesNotExist:
        return Response({'detail': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
    
    attempt.is_checked = False
    attempt.exam.is_result_published = False
    attempt.save(update_fields=['is_checked'])
    attempt.exam.save(update_fields=['is_result_published'])
    
    return Response({'message': 'Attempt reopened for re-grading'})


# ---------- Teacher: PDF Library ----------
@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated, IsTeacher])
def teacher_pdfs_view(request):
    """GET: List PDFs (filtered by search, year, tags). POST: Upload new PDF."""
    if request.method == 'GET':
        from django.conf import settings
        qs = TeacherPDF.objects.filter(is_deleted=False, is_archived=False).order_by('-created_at')
        if not getattr(settings, 'SINGLE_TENANT', True):
            qs = qs.filter(teacher=request.user)
        search = request.query_params.get('q', '').strip()
        year = request.query_params.get('year', '').strip()
        tag = request.query_params.get('tag', '').strip()
        if search:
            qs = qs.filter(title__icontains=search)
        if year:
            try:
                qs = qs.filter(year=int(year))
            except ValueError:
                pass
        if tag:
            qs = qs.filter(tags__contains=[tag])
        serializer = TeacherPDFSerializer(qs, many=True, context={'request': request})
        return Response(serializer.data)
    if request.method == 'POST':
        data = request.data.copy()
        data['teacher'] = request.user.id
        if 'file' not in request.FILES and 'file' not in (request.data or {}):
            return Response({'error': 'file is required'}, status=status.HTTP_400_BAD_REQUEST)
        file_obj = request.FILES.get('file') or (request.data.get('file') if hasattr(request.data, 'get') else None)
        if not file_obj:
            return Response({'error': 'file is required'}, status=status.HTTP_400_BAD_REQUEST)
        data['file'] = file_obj
        if not data.get('title'):
            data['title'] = getattr(file_obj, 'name', '') or 'PDF'
        if not data.get('original_filename'):
            data['original_filename'] = getattr(file_obj, 'name', '') or ''
        org_id = getattr(request.user, 'organization_id', None)
        serializer = TeacherPDFSerializer(data=data, context={'request': request})
        if serializer.is_valid():
            pdf = serializer.save(teacher=request.user, organization_id=org_id)
            return Response(TeacherPDFSerializer(pdf, context={'request': request}).data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated, IsTeacher])
def teacher_pdf_detail_view(request, pk):
    """GET: Get PDF. PATCH: Update metadata (title, tags, year, source). DELETE: Soft delete."""
    from django.conf import settings
    try:
        qs = TeacherPDF.objects.filter(pk=pk, is_deleted=False, is_archived=False)
        if not getattr(settings, 'SINGLE_TENANT', True):
            qs = qs.filter(teacher=request.user)
        pdf = qs.get()
    except TeacherPDF.DoesNotExist:
        return Response({'detail': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
    if request.method == 'GET':
        return Response(TeacherPDFSerializer(pdf, context={'request': request}).data)
    if request.method == 'PATCH':
        serializer = TeacherPDFSerializer(pdf, data=request.data, partial=True, context={'request': request})
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    if request.method == 'DELETE':
        now = _now()
        pdf.is_archived = True
        pdf.archived_at = now
        pdf.save(update_fields=['is_archived', 'archived_at'])
        return Response(status=status.HTTP_204_NO_CONTENT)
