"""
Question Bank & Exam API (teacher + student).
Visibility: students see exams only when status=active and now in [start_time, end_time].
Results visible only when is_result_published and manual check done.
"""
import base64
import hashlib
import io
import logging
import os
import re
from decimal import Decimal
from django.core.files.base import ContentFile
from django.http import FileResponse
from django.utils import timezone
from django.views.decorators.clickjacking import xframe_options_exempt
from django.db import transaction
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.http import HttpResponse, JsonResponse
from accounts.permissions import IsTeacher, IsStudent, IsStudentOrSignedToken
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
    GradingAuditLog,
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
from tests.answer_key import validate_answer_key_json, validate_and_normalize_answer_key_json


def _now():
    return timezone.now()


def _auto_finish_exam_if_all_graded(exam):
    """
    Auto-transition exam to 'finished' when ALL submitted attempts are graded and published.
    Also moves exam to 'Köhnə testlər' by setting is_archived=False but status='finished'.
    """
    # Get all submitted (non-restarted) attempts
    attempts = ExamAttempt.objects.filter(
        exam=exam,
        status='SUBMITTED',
    ).exclude(is_archived=True)
    
    if not attempts.exists():
        return  # No submitted attempts yet
    
    # Check if ALL submitted attempts are checked and published
    all_graded = all(a.is_checked and a.is_result_published for a in attempts)
    
    if all_graded:
        exam.status = 'finished'
        exam.is_result_published = True
        exam.save(update_fields=['status', 'is_result_published'])
        
        # Also mark all runs as finished
        ExamRun.objects.filter(exam=exam).exclude(status='finished').update(status='finished')


def _auto_transition_run_status():
    """
    Background check: transition runs whose end_at has passed from 'active' → 'finished'.
    Also check if exam should move to waiting_for_grading.
    Called periodically or on view access.
    """
    now = _now()
    expired_runs = ExamRun.objects.filter(status='active', end_at__lt=now)
    for run in expired_runs:
        run.status = 'finished'
        run.save(update_fields=['status'])
    
    # For each exam with all runs finished, check if exam should transition
    exams_with_finished_runs = Exam.objects.filter(
        status='active',
        runs__status='finished'
    ).exclude(runs__status='active').distinct()
    
    for exam in exams_with_finished_runs:
        # If no active runs remain, exam goes to waiting_for_grading (handled by view)
        if not exam.runs.filter(status='active').exists():
            has_ungraded = ExamAttempt.objects.filter(
                exam=exam,
                status='SUBMITTED',
                is_checked=False,
            ).exists()
            if has_ungraded:
                # Still has ungraded attempts - keep as active but conceptually waiting
                pass
            else:
                # All graded - auto-finish
                _auto_finish_exam_if_all_graded(exam)


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
    # Relaxed validation: Allow any number of questions for now
    # We can add a 'strict_mode' flag later if needed for precise DIM exam simulation.
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
        # Auto-transition expired runs to 'finished' and check exam status
        try:
            _auto_transition_run_status()
        except Exception:
            pass  # Don't fail exam listing if auto-transition has issues
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

        # PDF/JSON: require answer_key (answer_key_json or json_import); normalize no/qtype/options/correct index
        answer_key = data.get('answer_key_json') or data.get('json_import')
        if source_type in ('PDF', 'JSON'):
            if not answer_key:
                return Response({'detail': 'answer_key_json or json_import required for PDF/JSON source'}, status=status.HTTP_400_BAD_REQUEST)
            is_valid, err, normalized = validate_and_normalize_answer_key_json(answer_key)
            if not is_valid:
                return Response({'detail': err[0] if err else 'Invalid answer key', 'errors': err or []}, status=status.HTTP_400_BAD_REQUEST)
            answer_key = normalized or answer_key
            exam_type = answer_key.get('type') or 'quiz'
            data['type'] = exam_type
            data['answer_key_json'] = answer_key
        if source_type == 'PDF':
            pdf_id = data.get('pdf_id') or data.get('pdfId')
            if pdf_id:
                try:
                    from django.conf import settings
                    qs = TeacherPDF.objects.filter(pk=int(pdf_id), is_archived=False, is_deleted=False)
                    if not getattr(settings, 'SINGLE_TENANT', True):
                        qs = qs.filter(teacher=request.user)
                    pdf = qs.get()
                    # Verify PDF file actually exists on disk
                    if not pdf.file or not pdf.file.storage.exists(pdf.file.name):
                        return Response({'detail': 'PDF file not found on disk'}, status=status.HTTP_400_BAD_REQUEST)
                    data['pdf_document'] = pdf.id
                except (TeacherPDF.DoesNotExist, ValueError, TypeError):
                    return Response({'detail': 'PDF not found or not owned by teacher'}, status=status.HTTP_400_BAD_REQUEST)
        elif source_type == 'BANK':
            data.pop('answer_key_json', None)
            data.pop('json_import', None)
            data.pop('pdf_document_id', None)
            data.pop('pdf_document', None)

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
        # Status cannot be changed directly - it's controlled by runs
        data = request.data.copy()
        data.pop('status', None)  # Remove status from update data
        s = ExamSerializer(exam, data=data, partial=True)
        if s.is_valid():
            s.save()
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
    start_time_str = request.data.get('startTime') or request.data.get('start_time')
    
    if not duration_minutes:
        return Response({'error': 'durationMinutes required'}, status=status.HTTP_400_BAD_REQUEST)
    
    if not group_ids and not student_id:
        return Response({'error': 'At least one target required: groupIds or studentId'}, status=status.HTTP_400_BAD_REQUEST)
    
    now = _now()
    # Parse start_time if provided, otherwise use now
    if start_time_str:
        try:
            from django.utils.dateparse import parse_datetime
            start_time = parse_datetime(start_time_str)
            if start_time is None:
                start_time = now
            elif start_time < now:
                return Response({'error': 'Start time cannot be in the past'}, status=status.HTTP_400_BAD_REQUEST)
        except Exception:
            start_time = now
    else:
        start_time = now
    end_time = start_time + timedelta(minutes=int(duration_minutes))
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
                ExamAssignment.objects.update_or_create(
                    exam=exam, group=group,
                    defaults={
                        'start_time': start_time,
                        'end_time': end_time,
                        'duration_minutes': duration_int,
                        'is_active': True,
                    }
                )
                # Create one ExamRun per group so students see this exam in their list
                ExamRun.objects.create(
                    exam=exam,
                    group=group,
                    student=None,
                    start_at=start_time,
                    end_at=end_time,
                    duration_minutes=duration_int,
                    status='active',
                    created_by=request.user,
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
                            'start_time': start_time,
                            'end_time': end_time,
                            'duration_minutes': duration_int,
                            'is_active': True,
                        }
                    )
                    # Create one ExamRun for this student so they see it in their list
                    ExamRun.objects.create(
                        exam=exam,
                        group=None,
                        student=student,
                        start_at=start_time,
                        end_at=end_time,
                        duration_minutes=duration_int,
                        status='active',
                        created_by=request.user,
                    )
            except (User.DoesNotExist, ValueError, TypeError):
                pass

    return Response(ExamSerializer(exam).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsTeacher])
def teacher_exam_stop_view(request, exam_id):
    """Stop exam: set all active runs to finished, then exam status to finished if all runs finished."""
    try:
        exam = Exam.objects.prefetch_related('runs').get(pk=exam_id, created_by=request.user)
    except Exam.DoesNotExist:
        return Response({'error': 'Exam not found'}, status=status.HTTP_404_NOT_FOUND)
    
    # Set all active runs to finished
    active_runs = exam.runs.filter(status='active')
    active_runs.update(status='finished')
    
    # If all runs are finished, set exam status to finished
    remaining_active = exam.runs.filter(status='active').exists()
    if not remaining_active:
        exam.status = 'finished'
        exam.save(update_fields=['status'])
    
    return Response(ExamSerializer(exam).data)


@api_view(['PATCH'])
@permission_classes([IsAuthenticated, IsTeacher])
def teacher_run_update_view(request, run_id):
    """Update run duration: extend end_at by new duration_minutes."""
    try:
        run = ExamRun.objects.select_related('exam').get(pk=run_id, exam__created_by=request.user)
    except ExamRun.DoesNotExist:
        return Response({'detail': 'Run not found'}, status=status.HTTP_404_NOT_FOUND)
    
    if run.status != 'active':
        return Response({'detail': 'Can only update active runs'}, status=status.HTTP_400_BAD_REQUEST)
    
    duration_minutes = request.data.get('duration_minutes') or request.data.get('durationMinutes')
    if duration_minutes:
        duration_minutes = int(duration_minutes)
        run.duration_minutes = duration_minutes
        run.end_at = run.start_at + timedelta(minutes=duration_minutes)
        run.save(update_fields=['duration_minutes', 'end_at'])
    
    return Response(ExamRunSerializer(run).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsTeacher])
def teacher_exam_create_run_view(request, exam_id):
    """
    POST /api/teacher/exams/{id}/create-run
    Body: { groupId?, studentId?, duration_minutes, startTime? }
    Returns: { runId, start_at, end_at }
    Creates run and automatically activates exam.
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
    start_time_str = request.data.get('startTime') or request.data.get('start_time')
    if not duration_minutes:
        return Response({'detail': 'duration_minutes required'}, status=status.HTTP_400_BAD_REQUEST)
    duration_minutes = int(duration_minutes)
    if not group_id and not student_id:
        return Response({'detail': 'groupId or studentId required'}, status=status.HTTP_400_BAD_REQUEST)
    now = _now()
    if start_time_str:
        try:
            from django.utils.dateparse import parse_datetime
            start_at = parse_datetime(start_time_str)
            if start_at is None:
                start_at = now
            elif start_at < now:
                return Response({'detail': 'Start time cannot be in the past'}, status=status.HTTP_400_BAD_REQUEST)
        except Exception:
            start_at = now
    else:
        start_at = now
    end_at = start_at + timedelta(minutes=duration_minutes)
    
    with transaction.atomic():
        # Automatically activate exam when run is created
        if exam.status == 'draft':
            exam.status = 'active'
            exam.save(update_fields=['status'])
        
        run = ExamRun.objects.create(
            exam=exam,
            group_id=int(group_id) if group_id else None,
            student_id=int(student_id) if student_id else None,
            start_at=start_at,
            end_at=end_at,
            duration_minutes=duration_minutes,
            status='active' if start_at <= now else 'scheduled',
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
    """GET /api/teacher/runs/{runId}/attempts - List attempts for a run. Shows all students in group, even if they never started."""
    try:
        run = ExamRun.objects.select_related('exam', 'group', 'student').get(pk=run_id, exam__created_by=request.user)
    except ExamRun.DoesNotExist:
        return Response({'detail': 'Run not found'}, status=status.HTTP_404_NOT_FOUND)
    
    exam = run.exam
    max_s = float(exam.max_score or (100 if exam.type == 'quiz' else 150))
    
    # Get all attempts for this run
    attempts = ExamAttempt.objects.filter(exam_run=run, is_archived=False).select_related(
        'student', 'student__student_profile'
    ).order_by('-started_at')
    
    # If run is for a group, include all students in group (even if they never started)
    if run.group:
        from groups.services import get_active_students_for_group
        memberships = get_active_students_for_group(run.group)
        student_ids_in_group = {m.student_profile.user_id for m in memberships}
        attempt_by_student = {a.student_id: a for a in attempts}
        
        data = []
        for student_id in student_ids_in_group:
            attempt = attempt_by_student.get(student_id)
            if attempt:
                auto = float(attempt.auto_score or 0)
                manual = float(attempt.manual_score or 0) if attempt.manual_score is not None else 0
                final = float(attempt.total_score) if attempt.total_score is not None else (auto + manual)
                data.append({
                    'id': attempt.id,
                    'studentId': attempt.student_id,
                    'studentName': attempt.student.full_name,
                    'status': 'SUBMITTED' if attempt.finished_at else ('EXPIRED' if attempt.status == 'EXPIRED' else 'IN_PROGRESS'),
                    'startedAt': attempt.started_at.isoformat(),
                    'finishedAt': attempt.finished_at.isoformat() if attempt.finished_at else None,
                    'autoScore': auto,
                    'manualScore': float(attempt.manual_score) if attempt.manual_score is not None else None,
                    'finalScore': min(final, max_s),
                    'maxScore': max_s,
                    'isChecked': attempt.is_checked,
                    'isPublished': attempt.is_result_published,
                })
            else:
                # Student never started - show as not started
                from accounts.models import User
                try:
                    student = User.objects.get(id=student_id, role='student')
                    data.append({
                        'id': None,
                        'studentId': student.id,
                        'studentName': student.full_name,
                        'status': 'NOT_STARTED',
                        'startedAt': None,
                        'finishedAt': None,
                        'autoScore': 0,
                        'manualScore': None,
                        'finalScore': 0,
                        'maxScore': max_s,
                        'isChecked': False,
                        'isPublished': False,
                    })
                except User.DoesNotExist:
                    pass
        return Response({'attempts': data})
    else:
        # Individual student run
        data = []
        for a in attempts:
            auto = float(a.auto_score or 0)
            manual = float(a.manual_score or 0) if a.manual_score is not None else 0
            final = float(a.total_score) if a.total_score is not None else (auto + manual)
            data.append({
                'id': a.id,
                'studentId': a.student_id,
                'studentName': a.student.full_name,
                'status': 'SUBMITTED' if a.finished_at else ('EXPIRED' if a.status == 'EXPIRED' else 'IN_PROGRESS'),
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

    # Exclude runs where student already submitted and attempt is locked (unless teacher reopened)
    submitted_run_ids = set(
        ExamAttempt.objects.filter(
            student=request.user,
            exam_run_id__isnull=False,
            finished_at__isnull=False,
            is_visible_to_student=False,  # Only hide if locked
        ).exclude(status='RESTARTED').values_list('exam_run_id', flat=True)
    )
    runs = [r for r in runs if r.id not in submitted_run_ids]

    # Prefer at most one run per exam (avoid multiple entries for same exam): keep run with latest end_at per exam_id
    seen_exam_ids = set()
    deduped = []
    for r in sorted(runs, key=lambda x: (x.exam_id, -x.end_at.timestamp())):
        if r.exam_id not in seen_exam_ids:
            seen_exam_ids.add(r.exam_id)
            deduped.append(r)
    runs = deduped

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
        is_published = a.is_result_published and a.is_checked
        status_enum = 'PUBLISHED' if is_published else ('WAITING_MANUAL' if a.is_checked else 'SUBMITTED')
        auto_s = float(a.auto_score or 0) if a.auto_score is not None else None
        manual_s = float(a.manual_score) if a.manual_score is not None else None
        total_s = float(a.total_score) if a.total_score is not None else (float(a.auto_score or 0) + float(a.manual_score or 0)) if a.auto_score is not None else None
        data.append({
            'attemptId': a.id,
            'examId': a.exam_id,
            'examTitle': a.exam.title,
            'examType': a.exam.type,
            'title': a.exam.title,
            'status': status_enum,
            'is_result_published': is_published,
            'autoScore': auto_s if is_published else None,
            'manualScore': manual_s if is_published else None,
            'totalScore': total_s if is_published else None,
            'maxScore': max_score,
            'score': total_s if is_published else None,
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


logger = logging.getLogger(__name__)


@xframe_options_exempt
def student_run_pdf_view(request, run_id):
    """
    Protected PDF: require run accessible + within time + attempt exists + attempt not submitted.
    Returns 403 if any check fails. Streams PDF file.
    
    Authentication:
    - Normal API access: JWT Bearer token in Authorization header
    - Iframe access: Signed token in ?token= query parameter (iframes cannot send headers)
    
    NOTE: This is a regular Django view (not DRF @api_view) to prevent DRF renderers
    from corrupting binary PDF data. Authentication/permissions are handled manually.
    """
    # Manual DRF authentication (JWT)
    from rest_framework.request import Request
    from rest_framework.views import APIView
    from rest_framework_simplejwt.authentication import JWTAuthentication
    
    # Wrap request in DRF Request for authentication/permission checking
    drf_request = Request(request)
    
    # Try JWT authentication first
    jwt_auth = JWTAuthentication()
    try:
        user, token = jwt_auth.authenticate(drf_request)
        if user:
            request.user = user
    except Exception:
        # JWT auth failed, will check for signed token in permission
        pass
    
    # Check permission (handles both JWT and signed token)
    permission = IsStudentOrSignedToken()
    
    # Create a mock view object with kwargs
    class MockView(APIView):
        def __init__(self, run_id):
            self.kwargs = {'run_id': run_id}
    
    mock_view = MockView(run_id)
    
    # Check permission (this will also handle signed token auth if JWT failed)
    if not permission.has_permission(drf_request, mock_view):
        return JsonResponse({'detail': 'Authentication credentials were not provided.'}, status=401)
    
    # Ensure request.user is set (permission class sets it for token auth)
    if not hasattr(request, 'user') or not request.user.is_authenticated:
        return JsonResponse({'detail': 'Authentication credentials were not provided.'}, status=401)
    
    # Now proceed with business logic
    now = _now()
    try:
        run = ExamRun.objects.select_related('exam', 'exam__pdf_document').get(pk=run_id)
    except ExamRun.DoesNotExist:
        logger.warning("student_run_pdf run_id=%s user_id=%s run_not_found", run_id, getattr(request.user, 'id', None))
        return JsonResponse({'detail': 'Run not found'}, status=404)
    if run.status != 'active' or run.start_at > now or run.end_at < now:
        logger.warning("student_run_pdf run_id=%s exam_id=%s user_id=%s run_not_active_or_outside_window", run_id, run.exam_id, getattr(request.user, 'id', None))
        return JsonResponse({'detail': 'Run is not active or outside time window'}, status=403)
    if not _student_has_run_access(run, request.user):
        logger.warning("student_run_pdf run_id=%s exam_id=%s user_id=%s no_access", run_id, run.exam_id, getattr(request.user, 'id', None))
        return JsonResponse({'detail': 'You do not have access to this run'}, status=403)
    attempt = ExamAttempt.objects.filter(exam_run=run, student=request.user).order_by('-started_at').first()
    if not attempt:
        logger.warning("student_run_pdf run_id=%s exam_id=%s user_id=%s no_attempt", run_id, run.exam_id, getattr(request.user, 'id', None))
        return JsonResponse({'detail': 'Start the exam first to view the PDF'}, status=403)
    if attempt.finished_at is not None:
        logger.warning("student_run_pdf run_id=%s attempt_id=%s user_id=%s already_submitted", run_id, attempt.id, getattr(request.user, 'id', None))
        return JsonResponse({'detail': 'Exam already submitted; PDF no longer available'}, status=403)
    if attempt.status == 'RESTARTED':
        logger.warning("student_run_pdf run_id=%s attempt_id=%s user_id=%s attempt_restarted", run_id, attempt.id, getattr(request.user, 'id', None))
        return JsonResponse({'detail': 'This attempt was reset'}, status=403)
    exam = run.exam
    pdf_file = None
    pdf_source = None
    
    # STEP 1: Identify PDF source and get file reference
    if exam.pdf_document and exam.pdf_document.file:
        pdf_file = exam.pdf_document.file
        pdf_source = f"TeacherPDF(id={exam.pdf_document.id})"
        model_size = exam.pdf_document.file_size
    elif exam.pdf_file:
        pdf_file = exam.pdf_file
        pdf_source = f"Exam.pdf_file(exam_id={exam.id})"
        model_size = pdf_file.size if hasattr(pdf_file, 'size') else None
    else:
        logger.warning("student_run_pdf run_id=%s exam_id=%s user_id=%s no_pdf", run_id, run.exam_id, getattr(request.user, 'id', None))
        return JsonResponse({'detail': 'No PDF for this exam'}, status=404)
    
    # Verify file exists and has size
    if not pdf_file.storage.exists(pdf_file.name):
        logger.error(f"PDF file not found in storage: {pdf_file.name}")
        return JsonResponse({'detail': 'PDF file not found on storage'}, status=404)
    file_size = getattr(pdf_file, 'size', None)
    if file_size is None or file_size == 0:
        logger.error(f"PDF file is empty or size unknown: {pdf_file.name}, size={file_size}")
        return JsonResponse({'detail': 'PDF file is empty'}, status=500)

    try:
        absolute_path = None
        try:
            absolute_path = pdf_file.path
        except (AttributeError, NotImplementedError):
            pass

        # STEP 4 test: force full body response to rule out streaming issues
        if request.GET.get('force_body') == '1':
            if absolute_path and os.path.exists(absolute_path):
                with open(absolute_path, 'rb') as f:
                    data = f.read()
            else:
                with pdf_file.open('rb') as f:
                    data = f.read()
            response = HttpResponse(data, content_type='application/pdf')
            response['Content-Disposition'] = 'inline'
            logger.info(f"PDF served (force_body) run_id={run_id} size={len(data)}")
            return response

        # Minimal response: file handle + content-type + Content-Disposition only.
        # No Content-Length, Accept-Ranges, Cache-Control — let Django handle streaming.
        if absolute_path and os.path.exists(absolute_path):
            file_handle = open(absolute_path, 'rb')
        else:
            file_handle = pdf_file.open('rb')

        response = FileResponse(file_handle, content_type='application/pdf', as_attachment=False)
        response['Content-Disposition'] = 'inline'
        logger.info(f"PDF served run_id={run_id} source={pdf_source} file={pdf_file.name} size={file_size}")
        return response

    except Exception as e:
        logger.exception(
            f"student_run_pdf error run_id={run_id}, exam_id={run.exam_id}, user_id={getattr(request.user, 'id', None)}, error={e}"
        )
        return JsonResponse({'detail': 'Could not serve PDF'}, status=500)


def _build_blueprint_bank(exam):
    """Build attempt blueprint for BANK exam: stable option ids (option PK), shuffled display order, correctOptionId."""
    import random
    eqs = list(
        ExamQuestion.objects.filter(exam=exam)
        .select_related('question')
        .prefetch_related('question__options')
        .order_by('order')
    )
    type_order = {'MULTIPLE_CHOICE': 0, 'OPEN_SINGLE_VALUE': 1, 'OPEN_ORDERED': 1, 'OPEN_UNORDERED': 1, 'SITUATION': 2}
    eqs.sort(key=lambda eq: (type_order.get(eq.question.type, 99), eq.order))
    blueprint = []
    for eq in eqs:
        q = eq.question
        kind = 'mc' if q.type == 'MULTIPLE_CHOICE' else ('open' if q.type != 'SITUATION' else 'situation')
        opts = list(q.options.order_by('order'))
        correct_option_id = None
        if q.type == 'MULTIPLE_CHOICE' and q.correct_answer is not None:
            try:
                correct_option_id = int(q.correct_answer) if not isinstance(q.correct_answer, dict) else q.correct_answer.get('option_id')
            except (TypeError, ValueError, AttributeError):
                pass
        if kind == 'mc' and opts:
            random.shuffle(opts)
            options_blueprint = [{'id': str(o.id), 'text': o.text} for o in opts]
            correctOptionId = str(correct_option_id) if correct_option_id and any(o.id == correct_option_id for o in opts) else (str(opts[0].id) if opts else None)
            blueprint.append({
                'questionId': q.id,
                'questionNumber': eq.order + 1,
                'kind': kind,
                'options': options_blueprint,
                'correctOptionId': correctOptionId,
            })
        else:
            blueprint.append({
                'questionId': q.id,
                'questionNumber': eq.order + 1,
                'kind': kind,
                'options': [],
                'correctOptionId': None,
            })
    return blueprint


def _build_blueprint_pdf_json(answer_key):
    """Build attempt blueprint for PDF/JSON: stable option ids opt_1..opt_n, shuffled display order, correctOptionId."""
    import random
    questions_raw = answer_key.get('questions') or []
    kind_order = {'mc': 0, 'open': 1, 'situation': 2}
    sorted_q = sorted(questions_raw, key=lambda q: (kind_order.get((q.get('kind') or '').lower(), 99), q.get('number', 0)))
    blueprint = []
    for q in sorted_q:
        num = q.get('number')
        kind = (q.get('kind') or 'mc').lower()
        if kind == 'mc':
            opts = list(q.get('options') or [])
            if opts:
                correct_key = (str(q.get('correct') or '').strip().upper())
                # Assign stable id per option (by original order), then shuffle display order
                opts_with_id = [{'id': f'opt_{i+1}', 'key': (o.get('key') or '').strip().upper(), 'text': o.get('text', '')} for i, o in enumerate(opts)]
                key_to_id = {o['key'] or o['id']: o['id'] for o in opts_with_id}
                random.shuffle(opts_with_id)
                options_blueprint = [{'id': o['id'], 'text': o['text']} for o in opts_with_id]
                correctOptionId = key_to_id.get(correct_key)
                if not correctOptionId and opts_with_id:
                    correctOptionId = opts_with_id[0]['id']
                blueprint.append({'questionNumber': num, 'kind': kind, 'options': options_blueprint, 'correctOptionId': correctOptionId})
            else:
                blueprint.append({'questionNumber': num, 'kind': kind, 'options': [], 'correctOptionId': None})
        else:
            blueprint.append({'questionNumber': num, 'kind': kind, 'options': [], 'correctOptionId': None})
    return blueprint


def _questions_data_from_blueprint(blueprint):
    """Student-facing: from blueprint return list with only id and text for options (no correctOptionId)."""
    out = []
    for item in blueprint:
        qno = item.get('questionNumber') or item.get('questionId')
        kind = item.get('kind', 'mc')
        opts = item.get('options') or []
        out.append({
            'questionNumber': qno,
            'questionId': item.get('questionId'),
            'number': qno,
            'kind': kind,
            'type': kind,
            'options': [{'id': o.get('id'), 'text': o.get('text', '')} for o in opts],
        })
    return out


def _build_pdf_json_questions(answer_key, request, shuffle_options=True):
    """Build questions list from answer_key_json: order mc, open, situation. Shuffle MC options. (Legacy helper.)"""
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
        logger.warning("student_run_start run_id=%s user_id=%s run_not_found", run_id, getattr(request.user, 'id', None))
        return Response({'detail': 'Run not found'}, status=status.HTTP_404_NOT_FOUND)
    if run.status != 'active' or run.start_at > now or run.end_at < now:
        logger.warning("student_run_start run_id=%s exam_id=%s user_id=%s run_not_active", run_id, run.exam_id, getattr(request.user, 'id', None))
        return Response({'detail': 'Run is not active'}, status=status.HTTP_403_FORBIDDEN)
    try:
        sp = request.user.student_profile
    except Exception:
        sp = None
    if not sp:
        logger.warning("student_run_start run_id=%s user_id=%s no_student_profile", run_id, getattr(request.user, 'id', None))
        return Response({'detail': 'Student profile required'}, status=status.HTTP_403_FORBIDDEN)
    group_ids = list(GroupStudent.objects.filter(student_profile=sp, active=True, left_at__isnull=True).values_list('group_id', flat=True))
    if run.group_id not in group_ids and run.student_id != request.user.id:
        logger.warning("student_run_start run_id=%s exam_id=%s user_id=%s no_access", run_id, run.exam_id, getattr(request.user, 'id', None))
        return Response({'detail': 'You do not have access to this run'}, status=status.HTTP_403_FORBIDDEN)

    exam = run.exam
    try:
        existing = ExamAttempt.objects.filter(exam_run=run, student=request.user).exclude(status='RESTARTED').order_by('-started_at').first()
        attempt = None
        if existing:
            if existing.finished_at:
                logger.warning("student_run_start run_id=%s attempt_id=%s user_id=%s already_submitted", run_id, existing.id, getattr(request.user, 'id', None))
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

        # Ensure attempt has a frozen blueprint (build once per attempt; never expose correctOptionId to student)
        if not attempt.attempt_blueprint:
            if exam.source_type == 'BANK':
                attempt.attempt_blueprint = _build_blueprint_bank(exam)
            else:
                attempt.attempt_blueprint = _build_blueprint_pdf_json(exam.answer_key_json or {})
            # Save question order and option order for grading accuracy
            question_order = []
            option_order = {}
            for item in (attempt.attempt_blueprint or []):
                qno = item.get('questionNumber') or item.get('questionId')
                if qno is not None:
                    question_order.append(qno)
                    opts = item.get('options') or []
                    if opts:
                        option_order[str(qno)] = [opt.get('id') for opt in opts]
            attempt.question_order = question_order
            attempt.option_order = option_order
            attempt.save(update_fields=['attempt_blueprint', 'question_order', 'option_order'])

        # Build response from blueprint: only qno, kind, options (id + text) — never answer_key_json or correct
        questions_data = _questions_data_from_blueprint(attempt.attempt_blueprint or [])
    # Add examQuestionId for BANK where needed (for backward compat)
        if exam.source_type == 'BANK' and attempt.attempt_blueprint:
            eqs = list(ExamQuestion.objects.filter(exam=exam).select_related('question').order_by('order'))
            type_order = {'MULTIPLE_CHOICE': 0, 'OPEN_SINGLE_VALUE': 1, 'OPEN_ORDERED': 1, 'OPEN_UNORDERED': 1, 'SITUATION': 2}
            eqs.sort(key=lambda eq: (type_order.get(eq.question.type, 99), eq.order))
            for i, item in enumerate(questions_data):
                if i < len(eqs):
                    item['examQuestionId'] = eqs[i].id
                    item['order'] = eqs[i].order
                    item['text'] = eqs[i].question.text

        canvases_data = []
        for c in ExamAttemptCanvas.objects.filter(attempt=attempt).order_by('situation_index', 'question_id'):
            canvases_data.append(_build_canvas_response(c, request) or {
                'canvasId': c.id,
                'questionId': c.question_id,
                'situationIndex': c.situation_index,
                'updatedAt': c.updated_at.isoformat(),
                'imageUrl': request.build_absolute_uri(c.image.url) if c.image and request else (c.image.url if c.image else None),
            })

        # Protected PDF URL only (no raw MEDIA); frontend will GET this URL to display PDF
        # Include signed token for iframe access (iframes cannot send Authorization headers)
        pdf_url = None
        if exam.source_type in ('PDF', 'JSON') and (exam.pdf_document and exam.pdf_document.file or exam.pdf_file):
            from tests.pdf_auth import generate_pdf_access_token
            token = generate_pdf_access_token(request.user.id, run.id)
            if request:
                pdf_url = request.build_absolute_uri(f'/api/student/runs/{run.id}/pdf?token={token}')
            else:
                pdf_url = f'/api/student/runs/{run.id}/pdf?token={token}'

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
    except Exception as e:
        logger.exception(
            "student_run_start error run_id=%s exam_id=%s user_id=%s: %s",
            run_id, run.exam_id, getattr(request.user, 'id', None), e
        )
        return Response({'detail': 'Could not start exam'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


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
        logger.warning("student_exam_submit exam_id=%s user_id=%s exam_not_found", exam_id, getattr(request.user, 'id', None))
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
        logger.warning("student_exam_submit exam_id=%s attempt_id=%s user_id=%s attempt_not_found", exam_id, attempt_id, getattr(request.user, 'id', None))
        return Response({'detail': 'Attempt not found'}, status=status.HTTP_404_NOT_FOUND)
    if attempt.finished_at is not None:
        logger.warning("student_exam_submit exam_id=%s attempt_id=%s user_id=%s already_submitted", exam_id, attempt.id, getattr(request.user, 'id', None))
        return Response({'detail': 'Already submitted'}, status=status.HTTP_400_BAD_REQUEST)
    now = _now()
    if attempt.expires_at and now > attempt.expires_at:
        attempt.status = 'EXPIRED'
        attempt.save(update_fields=['status'])
        logger.warning("student_exam_submit exam_id=%s attempt_id=%s user_id=%s time_expired", exam_id, attempt.id, getattr(request.user, 'id', None))
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
        # QUIZ: 15 questions = 100 points, each question = 100/15
        pts_per_auto = Decimal('100') / 15
        max_score = Decimal('100')
    else:
        # İMTAHAN: 27 normal questions (x each) + 3 situasiya (2x each) = 27x + 6x = 33x = 150
        # So x = 150/33
        total_units = 27 + (3 * 2)  # 27 normal + 3 situasiya (each worth 2 units)
        pts_per_auto = Decimal('150') / Decimal('33')
        max_score = Decimal('150')

    total_score = Decimal('0')

    try:
        with transaction.atomic():
            blueprint = attempt.attempt_blueprint or []
            if exam.source_type in ('PDF', 'JSON') and (blueprint or (exam.answer_key_json and isinstance(exam.answer_key_json, dict))):
                # Prefer blueprint for grading (correctOptionId); fallback to answer_key_json
                if blueprint:
                    for item in blueprint:
                        num = item.get('questionNumber')
                        kind = (item.get('kind') or 'mc').lower()
                        ans = answers_by_question_number.get(num) or answers_by_question_number.get(int(num) if num is not None else None) or {}
                        selected_id = (ans.get('selectedOptionId') or ans.get('selected_option_id'))
                        if selected_id is not None:
                            selected_id = str(selected_id).strip()
                        selected_key = (ans.get('selectedOptionKey') or ans.get('selected_option_key') or '').strip().upper()
                        text_answer = (ans.get('textAnswer') or ans.get('text_answer') or '').strip()
                        requires_manual = False
                        auto_score = Decimal('0')
                        if kind == 'mc':
                            correct_option_id = item.get('correctOptionId')
                            if correct_option_id and selected_id and str(selected_id).strip() == str(correct_option_id).strip():
                                auto_score = pts_per_auto
                        elif kind == 'open':
                            ak = exam.answer_key_json or {}
                            q_def = next((x for x in (ak.get('questions') or []) if x.get('number') == num), {})
                            rule = (q_def.get('open_rule') or 'EXACT_MATCH').strip().upper()
                            open_ans = q_def.get('open_answer')
                            if open_ans is not None and rule and evaluate_open_single_value(text_answer, open_ans, rule):
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
                # BANK: use blueprint correctOptionId when available, else question.correct_answer
                eqs = list(ExamQuestion.objects.filter(exam=exam).select_related('question').prefetch_related('question__options').order_by('order'))
                type_order = {'MULTIPLE_CHOICE': 0, 'OPEN_SINGLE_VALUE': 1, 'OPEN_ORDERED': 1, 'OPEN_UNORDERED': 1, 'SITUATION': 2}
                eqs.sort(key=lambda eq: (type_order.get(eq.question.type, 99), eq.order))
                blueprint_by_qid = {}
                if blueprint:
                    for b in blueprint:
                        qid = b.get('questionId')
                        if qid is not None:
                            blueprint_by_qid[qid] = b
                for eq in eqs:
                    q = eq.question
                    ans = answers_by_question_id.get(q.id) or {}
                    selected_option_id = ans.get('selectedOptionId') or ans.get('selected_option_id')
                    text_answer = (ans.get('textAnswer') or ans.get('text_answer') or '').strip()
                    requires_manual = False
                    auto_score = Decimal('0')
                    if q.type == 'MULTIPLE_CHOICE':
                        correct_id = None
                        bp = blueprint_by_qid.get(q.id)
                        if bp and bp.get('correctOptionId') is not None:
                            correct_id = bp.get('correctOptionId')
                            try:
                                correct_id = int(correct_id)
                            except (TypeError, ValueError):
                                pass
                        if correct_id is None and q.correct_answer is not None:
                            if isinstance(q.correct_answer, dict) and 'option_id' in q.correct_answer:
                                correct_id = q.correct_answer.get('option_id')
                            elif isinstance(q.correct_answer, (int, float)):
                                correct_id = int(q.correct_answer)
                        if correct_id is not None and selected_option_id is not None:
                            if str(selected_option_id).strip() == str(correct_id).strip():
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
            attempt.total_score = total_score  # Will be updated when manual grading is done
            attempt.status = 'SUBMITTED'
            attempt.is_visible_to_student = False  # Lock attempt after submission
            attempt.save(update_fields=['finished_at', 'auto_score', 'total_score', 'status', 'is_visible_to_student'])

        return Response({
            'attemptId': attempt.id,
            'autoScore': float(total_score),
            'maxScore': float(max_score),
            'finishedAt': attempt.finished_at.isoformat(),
        }, status=status.HTTP_200_OK)
    except Exception as e:
        logger.exception(
            "student_exam_submit error exam_id=%s attempt_id=%s user_id=%s: %s",
            exam_id, attempt.id, getattr(request.user, 'id', None), e
        )
        return Response({'detail': 'Could not submit'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


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
    if not attempt.exam.is_result_published and not attempt.is_result_published:
        return Response({
            'attemptId': attempt.id,
            'examId': attempt.exam_id,
            'title': attempt.exam.title,
            'status': 'pending_manual',
            'message': 'Müəllim yoxlaması gözlənilir',
            'autoScore': None,
            'manualScore': None,
            'totalScore': None,
            'score': None,
            'maxScore': float(attempt.exam.max_score or 150),
            'finishedAt': attempt.finished_at.isoformat() if attempt.finished_at else None,
            'questions': [],
            'canvases': [],
        }, status=status.HTTP_200_OK)
    manual = attempt.manual_score
    auto = attempt.auto_score
    total = float(attempt.total_score) if attempt.total_score is not None else (float(auto or 0) + float(manual or 0))
    max_s = float(attempt.exam.max_score or 150)
    return Response({
        'attemptId': attempt.id,
        'examId': attempt.exam_id,
        'title': attempt.exam.title,
        'status': 'published',
        'autoScore': float(attempt.auto_score or 0),
        'manualScore': float(manual) if manual is not None else None,
        'totalScore': min(total, max_s),
        'score': min(total, max_s),
        'maxScore': max_s,
        'finishedAt': attempt.finished_at.isoformat() if attempt.finished_at else None,
        'questions': [],
        'canvases': [],
    })


# ---------- Teacher: Grading ----------
@api_view(['GET'])
@permission_classes([IsAuthenticated, IsTeacher])
def teacher_exam_attempts_view(request, exam_id):
    """List attempts for an exam, grouped by runs if assigned to groups."""
    from django.conf import settings
    from django.db.models import Count, Q
    try:
        qs = Exam.objects.filter(pk=exam_id)
        if not getattr(settings, 'SINGLE_TENANT', True):
            qs = qs.filter(created_by=request.user)
        exam = qs.get()
    except Exam.DoesNotExist:
        return Response({'detail': 'Exam not found'}, status=status.HTTP_404_NOT_FOUND)
    
    group_id = request.query_params.get('groupId') or request.query_params.get('group_id')
    status_filter = request.query_params.get('status', '').strip()
    show_archived = request.query_params.get('showArchived', 'false').lower() == 'true'
    
    # Check if exam is assigned to groups or individual students
    runs = ExamRun.objects.filter(exam=exam).select_related('group', 'student').annotate(
        attempt_count=Count('attempts', filter=Q(attempts__is_archived=False))
    ).order_by('-start_at')
    
    if group_id:
        try:
            gs = Group.objects.filter(pk=int(group_id))
            if not getattr(settings, 'SINGLE_TENANT', True):
                gs = gs.filter(created_by=request.user)
            group_obj = gs.get()
            runs = runs.filter(group=group_obj)
        except (Group.DoesNotExist, ValueError):
            pass
    
    # Group attempts by run
    runs_data = []
    for run in runs:
        qs_attempts = ExamAttempt.objects.filter(exam_run=run).select_related('student', 'student__student_profile')
        if not show_archived:
            qs_attempts = qs_attempts.filter(is_archived=False)
        
        if status_filter == 'submitted':
            qs_attempts = qs_attempts.filter(finished_at__isnull=False)
        elif status_filter == 'waiting_manual':
            qs_attempts = qs_attempts.filter(finished_at__isnull=False).filter(
                answers__requires_manual_check=True
            ).distinct()
        elif status_filter == 'graded':
            qs_attempts = qs_attempts.filter(manual_score__isnull=False, is_checked=True)
        elif status_filter == 'published':
            qs_attempts = qs_attempts.filter(is_checked=True).filter(exam__is_result_published=True)
        
        attempts_data = []
        for attempt in qs_attempts.order_by('-started_at'):
            manual_pending = ExamAnswer.objects.filter(attempt=attempt, requires_manual_check=True).count()
            auto_s = float(attempt.auto_score or 0)
            manual_s = float(attempt.manual_score or 0) if attempt.manual_score is not None else 0
            final_score = float(attempt.total_score) if attempt.total_score is not None else (auto_s + manual_s)
            max_s = float(exam.max_score or (100 if exam.type == 'quiz' else 150))
            attempts_data.append({
                'id': attempt.id,
                'studentId': attempt.student.id,
                'studentName': attempt.student.full_name,
                'status': 'SUBMITTED' if attempt.finished_at else (getattr(attempt, 'status', None) or 'IN_PROGRESS'),
                'startedAt': attempt.started_at.isoformat(),
                'finishedAt': attempt.finished_at.isoformat() if attempt.finished_at else None,
                'submittedAt': attempt.finished_at.isoformat() if attempt.finished_at else None,
                'autoScore': auto_s,
                'manualScore': float(attempt.manual_score) if attempt.manual_score is not None else None,
                'finalScore': min(final_score, max_s),
                'maxScore': max_s,
                'manualPendingCount': manual_pending,
                'isChecked': attempt.is_checked,
                'isPublished': attempt.is_result_published,
                'isArchived': attempt.is_archived,
            })
        
        runs_data.append({
            'runId': run.id,
            'examId': exam.id,
            'examTitle': exam.title,
            'groupName': run.group.name if run.group else None,
            'studentName': run.student.full_name if run.student else None,
            'startAt': run.start_at.isoformat(),
            'endAt': run.end_at.isoformat(),
            'durationMinutes': run.duration_minutes,
            'status': run.status,
            'attemptCount': run.attempt_count,
            'attempts': attempts_data,
        })
    
    # If no runs exist, fallback to old behavior (attempts without runs)
    if not runs_data:
        qs = ExamAttempt.objects.filter(exam=exam, exam_run__isnull=True).select_related('student', 'student__student_profile').order_by('-started_at')
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
            auto_s = float(attempt.auto_score or 0)
            manual_s = float(attempt.manual_score or 0) if attempt.manual_score is not None else 0
            final_score = float(attempt.total_score) if attempt.total_score is not None else (auto_s + manual_s)
            max_s = float(exam.max_score or (100 if exam.type == 'quiz' else 150))
            attempts_data.append({
                'id': attempt.id,
                'studentId': attempt.student.id,
                'studentName': attempt.student.full_name,
                'groupId': group_obj.id if group_obj else None,
                'groupName': group_obj.name if group_obj else None,
                'status': 'SUBMITTED' if attempt.finished_at else (getattr(attempt, 'status', None) or 'IN_PROGRESS'),
                'startedAt': attempt.started_at.isoformat(),
                'finishedAt': attempt.finished_at.isoformat() if attempt.finished_at else None,
                'submittedAt': attempt.finished_at.isoformat() if attempt.finished_at else None,
                'autoScore': auto_s,
                'manualScore': float(attempt.manual_score) if attempt.manual_score is not None else None,
                'finalScore': min(final_score, max_s),
                'maxScore': max_s,
                'manualPendingCount': manual_pending,
                'isChecked': attempt.is_checked,
                'isPublished': attempt.is_result_published,
                'isArchived': attempt.is_archived,
            })
        return Response({'attempts': attempts_data})
    
    return Response({'runs': runs_data})


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

    # Get PDF URL if exam is PDF/JSON and attempt has a run
    # Include signed token for iframe access (iframes cannot send Authorization headers)
    pdf_url = None
    if attempt.exam_run and attempt.exam.source_type in ('PDF', 'JSON'):
        from tests.pdf_auth import generate_pdf_access_token
        token = generate_pdf_access_token(attempt.student.id, attempt.exam_run.id)
        pdf_url = request.build_absolute_uri(f'/api/student/runs/{attempt.exam_run.id}/pdf?token={token}')
    
    return Response({
        'attemptId': attempt.id,
        'examId': attempt.exam.id,
        'examTitle': attempt.exam.title,
        'sourceType': attempt.exam.source_type,
        'studentId': attempt.student.id,
        'studentName': attempt.student.full_name,
        'runId': attempt.exam_run.id if attempt.exam_run else None,
        'pdfUrl': pdf_url,
        'startedAt': attempt.started_at.isoformat(),
        'finishedAt': attempt.finished_at.isoformat() if attempt.finished_at else None,
        'autoScore': float(attempt.auto_score or 0),
        'manualScore': float(attempt.manual_score) if attempt.manual_score is not None else None,
        'maxScore': float(attempt.exam.max_score or (100 if attempt.exam.type == 'quiz' else 150)),
        'attemptBlueprint': attempt.attempt_blueprint,
        'answers': answers_data,
        'canvases': canvases_data,
        'situationScoringSet': 'SET2',  # Use SET2: [0, 2/3, 1, 4/3, 2]
    })


# Option Set 1 (default): multipliers apply to situation max only. Quiz=100, Exam=150; exam units = 22+5+3*2 = 33.
SITUATION_MULTIPLIERS_SET1 = (0, 1/3, 1/2, 2/3, 1)
SITUATION_MULTIPLIERS_SET2 = (0, 2/3, 1, 4/3, 2)


def _situation_max_per_question(is_quiz):
    """Strict unit-based: situation max = 2 units. Exam total units 33, so 150/33*2 per situation."""
    if is_quiz:
        return Decimal('0')  # quiz has 0 situation
    # İMTAHAN: 150/33 per unit, situasiya = 2 units, so 150/33*2
    return (Decimal('150') / Decimal('33')) * Decimal('2')


def _situation_fraction_to_points(fraction, is_quiz, max_situation_points=None, use_set2=False):
    """
    Option Set 1: fraction in [0, 1/3, 1/2, 2/3, 1]. Points = situation_max_per_question * fraction.
    Option Set 2: fraction in [0, 2/3, 1, 4/3, 2]. Points = situation_max_per_question * fraction.
    """
    situation_max = max_situation_points if max_situation_points is not None else _situation_max_per_question(is_quiz)
    if situation_max == 0:
        return Decimal('0')
    
    if use_set2:
        # SET2: [0, 2/3, 1, 4/3, 2]
        if fraction in (0, '0'):
            return Decimal('0')
        if fraction in (2/3, '2/3', 0.667, '0.667'):
            return (Decimal('2') / Decimal('3') * situation_max).quantize(Decimal('0.01'))
        if fraction in (1, '1'):
            return situation_max.quantize(Decimal('0.01'))
        if fraction in (4/3, '4/3', 1.333, '1.333'):
            return (Decimal('4') / Decimal('3') * situation_max).quantize(Decimal('0.01'))
        if fraction in (2, '2'):
            return (Decimal('2') * situation_max).quantize(Decimal('0.01'))
    else:
        # SET1: [0, 1/3, 1/2, 2/3, 1]
        if fraction in (0, '0'):
            return Decimal('0')
        if fraction in (1/3, '1/3', 0.333):
            return (Decimal('1') / Decimal('3') * situation_max).quantize(Decimal('0.01'))
        if fraction in (1/2, '1/2', 0.5):
            return (Decimal('1') / Decimal('2') * situation_max).quantize(Decimal('0.01'))
        if fraction in (2/3, '2/3', 0.667):
            return (Decimal('2') / Decimal('3') * situation_max).quantize(Decimal('0.01'))
        if fraction in (1, '1'):
            return situation_max.quantize(Decimal('0.01'))
    
    try:
        return (Decimal(str(fraction)) * situation_max).quantize(Decimal('0.01'))
    except Exception:
        return Decimal('0')


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsTeacher])
def teacher_attempt_grade_view(request, attempt_id):
    """Grade manual answers (manualScores by answer id, or per_situation_scores by situation index) and optionally publish."""
    try:
        attempt = ExamAttempt.objects.select_related('exam').prefetch_related('answers').get(pk=attempt_id, exam__created_by=request.user)
    except ExamAttempt.DoesNotExist:
        logger.warning("teacher_attempt_grade attempt_id=%s user_id=%s not_found", attempt_id, getattr(request.user, 'id', None))
        return Response({'detail': 'Not found'}, status=status.HTTP_404_NOT_FOUND)

    exam = attempt.exam
    is_quiz = exam.type == 'quiz'
    max_score = float(exam.max_score or (100 if is_quiz else 150))
    manual_scores = request.data.get('manualScores') or request.data.get('manual_scores') or {}
    per_situation_scores = request.data.get('per_situation_scores') or request.data.get('perSituationScores') or []
    publish = request.data.get('publish', False)
    notes = request.data.get('notes', '')

    try:
        total_manual = Decimal('0')
        old_total_score = (attempt.auto_score or Decimal('0')) + (attempt.manual_score or Decimal('0'))
        with transaction.atomic():
            for answer_id_str, score_value in manual_scores.items():
                try:
                    answer_id = int(answer_id_str)
                    score = Decimal(str(score_value))
                    answer = ExamAnswer.objects.get(pk=answer_id, attempt=attempt)
                    old_answer_score = answer.manual_score or Decimal('0')
                    answer.manual_score = score
                    answer.save(update_fields=['manual_score'])
                    total_manual += score
                    # Log audit if score changed
                    if old_answer_score != score:
                        GradingAuditLog.objects.create(
                            attempt=attempt,
                            teacher=request.user,
                            answer=answer,
                            old_score=old_answer_score,
                            new_score=score,
                        )
                except (ValueError, ExamAnswer.DoesNotExist):
                    continue

            # per_situation_scores: [{index: 1, fraction: 0|2/3|1|4/3|2 (Option Set 2)}, ...] - index 1-based
            situation_max = _situation_max_per_question(is_quiz)
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
                # Use SET2: [0, 2/3, 1, 4/3, 2]
                pts = _situation_fraction_to_points(fraction, is_quiz, max_situation_points=situation_max, use_set2=True)
                ans = situation_answers[idx - 1]
                old_answer_score = ans.manual_score or Decimal('0')
                ans.manual_score = pts
                ans.save(update_fields=['manual_score'])
                total_manual += pts
                # Log audit if score changed
                if old_answer_score != pts:
                    GradingAuditLog.objects.create(
                        attempt=attempt,
                        teacher=request.user,
                        answer=ans,
                        old_score=old_answer_score,
                        new_score=pts,
                    )

            auto_total = sum(float(a.auto_score or 0) for a in attempt.answers.filter(requires_manual_check=False))
            attempt.manual_score = total_manual
            attempt.auto_score = Decimal(str(auto_total))
            attempt.is_checked = True
            new_total_score = attempt.auto_score + attempt.manual_score
            # Validate: total_score must not exceed max_score
            if new_total_score > Decimal(str(max_score)):
                new_total_score = Decimal(str(max_score))
            attempt.total_score = new_total_score
            attempt.save(update_fields=['manual_score', 'auto_score', 'total_score', 'is_checked'])
            # Log total score change if different
            if old_total_score != new_total_score:
                GradingAuditLog.objects.create(
                    attempt=attempt,
                    teacher=request.user,
                    answer=None,
                    old_total_score=old_total_score,
                    new_total_score=new_total_score,
                )

            if publish:
                # Lock scores permanently: set is_result_published on ATTEMPT level
                attempt.is_result_published = True
                attempt.save(update_fields=['is_result_published'])
                # Also set on exam level
                attempt.exam.is_result_published = True
                attempt.exam.save(update_fields=['is_result_published'])
                # Auto-finish exam if all attempts are graded and published
                _auto_finish_exam_if_all_graded(attempt.exam)

        final = float(attempt.total_score or 0)
        if final > max_score:
            final = max_score
        return Response({
            'attemptId': attempt.id,
            'manualScore': float(attempt.manual_score or 0),
            'autoScore': float(attempt.auto_score or 0),
            'totalScore': final,
            'finalScore': final,
            'isPublished': attempt.is_result_published,
        })
    except Exception as e:
        logger.exception(
            "teacher_attempt_grade error attempt_id=%s exam_id=%s user_id=%s: %s",
            attempt_id, attempt.exam_id, getattr(request.user, 'id', None), e
        )
        return Response({'detail': 'Could not grade'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsTeacher])
def teacher_attempt_publish_view(request, attempt_id):
    """Publish/unpublish attempt result. Locks scores permanently on publish."""
    try:
        attempt = ExamAttempt.objects.select_related('exam').get(pk=attempt_id, exam__created_by=request.user)
    except ExamAttempt.DoesNotExist:
        return Response({'detail': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
    
    publish = request.data.get('publish', True)
    
    with transaction.atomic():
        # Set per-attempt publish flag (locks scores)
        attempt.is_result_published = publish
        attempt.save(update_fields=['is_result_published'])
        # Also set on exam level
        attempt.exam.is_result_published = publish
        attempt.exam.save(update_fields=['is_result_published'])
        if publish:
            _auto_finish_exam_if_all_graded(attempt.exam)
    
    return Response({
        'isPublished': publish,
        'totalScore': float(attempt.total_score or 0),
        'autoScore': float(attempt.auto_score or 0),
        'manualScore': float(attempt.manual_score or 0),
    })


# Removed duplicate teacher_attempt_reopen_view - the canonical one is defined later (line ~2141)


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
        # Filter out PDFs where file doesn't exist on disk
        valid_pdfs = []
        for pdf in qs:
            try:
                if pdf.file and pdf.file.storage.exists(pdf.file.name):
                    valid_pdfs.append(pdf)
            except Exception:
                # Skip PDFs with storage errors
                continue
        serializer = TeacherPDFSerializer(valid_pdfs, many=True, context={'request': request})
        return Response(serializer.data)
    if request.method == 'POST':
        data = request.data.copy()
        data['teacher'] = request.user.id
        if 'file' not in request.FILES and 'file' not in (request.data or {}):
            return Response({'error': 'file is required'}, status=status.HTTP_400_BAD_REQUEST)
        file_obj = request.FILES.get('file') or (request.data.get('file') if hasattr(request.data, 'get') else None)
        if not file_obj:
            return Response({'error': 'file is required'}, status=status.HTTP_400_BAD_REQUEST)
        # Reset file pointer so storage saves full content (avoid 0-byte / 0-page PDFs if anything read the file earlier)
        if hasattr(file_obj, 'seek') and callable(file_obj.seek):
            file_obj.seek(0)
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
