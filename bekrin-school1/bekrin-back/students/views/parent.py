"""
Parent API views. ParentChild links parent User to student User; child profile via student.student_profile.
"""
from calendar import monthrange
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from accounts.permissions import IsParent
from django.db.models import Count
from datetime import date, timedelta
from students.models import ParentChild, StudentProfile
from attendance.models import AttendanceRecord
from attendance.serializers import AttendanceRecordSerializer
from payments.models import Payment
from payments.serializers import PaymentSerializer
from tests.models import TestResult
from coding.models import CodingTask, CodingSubmission


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsParent])
def parent_children_view(request):
    """
    GET /api/parent/children
    Get parent's children (via ParentChild.student -> StudentProfile) with stats.
    """
    parent_children = ParentChild.objects.filter(
        parent=request.user
    ).select_related('student', 'student__student_profile')
    
    result = []
    for pc in parent_children:
        student_user = pc.student
        try:
            child = student_user.student_profile
        except StudentProfile.DoesNotExist:
            continue
        
        thirty_days_ago = date.today() - timedelta(days=30)
        attendance_records = AttendanceRecord.objects.filter(
            student_profile=child,
            lesson_date__gte=thirty_days_ago
        )
        total_days = attendance_records.count()
        present_days = attendance_records.filter(status='present').count()
        attendance_percent = int((present_days / total_days * 100)) if total_days > 0 else 0
        
        last_test = TestResult.objects.filter(
            student_profile=child
        ).order_by('-date').first()
        
        total_tasks = CodingTask.objects.filter(
            deleted_at__isnull=True,
            is_active=True,
        ).count() or 1
        solved_count = CodingSubmission.objects.filter(
            student_id=student_user.id,
            status='passed',
            task__deleted_at__isnull=True,
        ).values('task_id').distinct().count()
        coding_percent = int((solved_count / total_tasks * 100)) if total_tasks > 0 else 0
        last_submission = CodingSubmission.objects.filter(
            student_id=student_user.id,
        ).order_by('-created_at').values_list('created_at', flat=True).first()

        result.append({
            'id': child.id,
            'email': child.user.email,
            'fullName': child.user.full_name,
            'class': child.grade,
            'attendancePercent': attendance_percent,
            'balance': float(child.balance),
            'lastTest': {
                'name': last_test.test_name,
                'score': last_test.score,
                'maxScore': last_test.max_score,
                'date': last_test.date.isoformat(),
            } if last_test else None,
            'codingSolvedCount': solved_count,
            'codingTotalTasks': total_tasks,
            'codingPercent': coding_percent,
            'codingLastActivity': last_submission.isoformat() if last_submission else None,
        })
    
    return Response(result)


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsParent])
def parent_attendance_view(request):
    """
    GET /api/parent/attendance?studentId=
    studentId = StudentProfile.id (child's profile id).
    """
    student_id = request.query_params.get('studentId')
    if not student_id:
        return Response({'detail': 'studentId is required'}, status=status.HTTP_400_BAD_REQUEST)
    
    try:
        ParentChild.objects.get(
            parent=request.user,
            student__student_profile__id=student_id
        )
    except ParentChild.DoesNotExist:
        return Response({'detail': 'Access denied'}, status=status.HTTP_403_FORBIDDEN)
    
    attendance = AttendanceRecord.objects.filter(
        student_profile_id=student_id
    ).select_related('group').order_by('-lesson_date')
    
    serializer = AttendanceRecordSerializer(attendance, many=True)
    return Response(serializer.data)


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsParent])
def parent_attendance_monthly_view(request):
    """
    GET /api/parent/attendance/monthly?studentId=&month=&year=
    Returns monthly stats for parent's child: Present, Absent, Late, Excused, Attendance %
    """
    student_id = request.query_params.get('studentId')
    month = request.query_params.get('month', str(date.today().month))
    year = request.query_params.get('year', str(date.today().year))

    if not student_id:
        return Response(
            {'detail': 'studentId is required'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    try:
        month = int(month)
        year = int(year)
    except ValueError:
        return Response(
            {'detail': 'Invalid month or year'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        ParentChild.objects.get(
            parent=request.user,
            student__student_profile__id=student_id,
        )
    except ParentChild.DoesNotExist:
        return Response({'detail': 'Access denied'}, status=status.HTTP_403_FORBIDDEN)

    _, last_day = monthrange(year, month)
    start_date = date(year, month, 1)
    end_date = date(year, month, last_day)

    records = (
        AttendanceRecord.objects.filter(
            student_profile_id=student_id,
            lesson_date__gte=start_date,
            lesson_date__lte=end_date,
        )
        .values('status')
        .annotate(cnt=Count('id'))
    )
    stats = {'present': 0, 'absent': 0, 'late': 0, 'excused': 0}
    for r in records:
        if r['status'] in stats:
            stats[r['status']] = r['cnt']

    total = stats['present'] + stats['absent'] + stats['late'] + stats['excused']
    pct = round((stats['present'] / total * 100), 1) if total > 0 else 0

    return Response({
        'year': year,
        'month': month,
        'studentId': student_id,
        'present': stats['present'],
        'absent': stats['absent'],
        'late': stats['late'],
        'excused': stats['excused'],
        'attendancePercent': pct,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsParent])
def parent_payments_view(request):
    """
    GET /api/parent/payments?studentId=
    studentId = StudentProfile.id.
    """
    student_id = request.query_params.get('studentId')
    if not student_id:
        return Response({'detail': 'studentId is required'}, status=status.HTTP_400_BAD_REQUEST)
    
    try:
        ParentChild.objects.get(
            parent=request.user,
            student__student_profile__id=student_id
        )
    except ParentChild.DoesNotExist:
        return Response({'detail': 'Access denied'}, status=status.HTTP_403_FORBIDDEN)
    
    payments = Payment.objects.filter(
        student_profile_id=student_id,
        deleted_at__isnull=True
    ).select_related('group').order_by('-payment_date')
    
    serializer = PaymentSerializer(payments, many=True)
    return Response(serializer.data)


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsParent])
def parent_test_results_view(request):
    """
    GET /api/parent/test-results?studentId=
    studentId = StudentProfile.id
    """
    from tests.models import TestResult
    from tests.serializers import TestResultSerializer

    student_id = request.query_params.get('studentId')
    if not student_id:
        return Response({'detail': 'studentId is required'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        ParentChild.objects.get(
            parent=request.user,
            student__student_profile__id=student_id
        )
    except ParentChild.DoesNotExist:
        return Response({'detail': 'Access denied'}, status=status.HTTP_403_FORBIDDEN)

    results = TestResult.objects.filter(
        student_profile_id=student_id
    ).select_related('group').order_by('-date')

    serializer = TestResultSerializer(results, many=True)
    return Response(serializer.data)


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsParent])
def parent_exam_attempt_detail_view(request, exam_id, attempt_id):
    """
    GET /api/parent/exams/<exam_id>/attempts/<attempt_id>/detail?studentId=
    Returns published attempt detail with canvases. studentId required to verify parent owns child.
    """
    from tests.models import ExamAttempt
    student_id = request.query_params.get('studentId')
    if not student_id:
        return Response({'detail': 'studentId required'}, status=status.HTTP_400_BAD_REQUEST)
    try:
        pc = ParentChild.objects.get(
            parent=request.user,
            student__student_profile__id=student_id,
        )
    except ParentChild.DoesNotExist:
        return Response({'detail': 'Access denied'}, status=status.HTTP_403_FORBIDDEN)
    try:
        attempt = ExamAttempt.objects.select_related('exam', 'student').get(
            pk=attempt_id,
            exam_id=exam_id,
            student=pc.student,
            finished_at__isnull=False,
        )
    except ExamAttempt.DoesNotExist:
        return Response({'detail': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
    if not attempt.exam.is_result_published:
        return Response({'detail': 'Results not yet published'}, status=status.HTTP_403_FORBIDDEN)
    manual = attempt.manual_score
    auto = attempt.auto_score
    score = manual if manual is not None else auto
    return Response({
        'attemptId': attempt.id,
        'examId': attempt.exam_id,
        'title': attempt.exam.title,
        'autoScore': float(attempt.auto_score or 0),
        'manualScore': float(manual) if manual is not None else None,
        'score': float(score) if score is not None else None,
        'finishedAt': attempt.finished_at.isoformat() if attempt.finished_at else None,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsParent])
def parent_exam_results_view(request):
    """
    GET /api/parent/exam-results?studentId=
    studentId = StudentProfile.id. Returns child's exam attempts (submitted + published).
    Mask score when not published; show status.
    """
    from tests.models import ExamAttempt

    student_id = request.query_params.get('studentId')
    if not student_id:
        return Response({'detail': 'studentId is required'}, status=status.HTTP_400_BAD_REQUEST)
    try:
        pc = ParentChild.objects.get(
            parent=request.user,
            student__student_profile__id=student_id,
        )
    except ParentChild.DoesNotExist:
        return Response({'detail': 'Access denied'}, status=status.HTTP_403_FORBIDDEN)
    student_user = pc.student
    attempts = ExamAttempt.objects.filter(
        student=student_user,
        finished_at__isnull=False,
        is_archived=False,
    ).select_related('exam').order_by('-finished_at')
    data = []
    for a in attempts:
        is_published = a.exam.is_result_published and a.is_checked
        max_score = float(a.exam.max_score or (100 if a.exam.type == 'quiz' else 150))
        data.append({
            'attemptId': a.id,
            'examId': a.exam_id,
            'title': a.exam.title,
            'status': 'PUBLISHED' if is_published else ('WAITING_MANUAL' if a.is_checked else 'SUBMITTED'),
            'is_result_published': is_published,
            'score': float(a.manual_score if a.manual_score is not None else a.auto_score or 0) if is_published else None,
            'maxScore': max_score,
            'finishedAt': a.finished_at.isoformat() if a.finished_at else None,
        })
    return Response(data)
