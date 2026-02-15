"""
Teacher API views
"""
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.conf import settings
from django.db import transaction, models
from django.db.models import Q, Count
from django.utils import timezone
from datetime import date
from accounts.permissions import IsTeacher
from students.models import StudentProfile
from groups.models import Group, GroupStudent
from groups.serializers import GroupSerializer
from groups.services import move_student, get_active_students_for_group
from payments.models import Payment
from payments.serializers import PaymentSerializer, PaymentCreateSerializer, TeacherPaymentSerializer
from attendance.models import AttendanceRecord
from coding.models import CodingTask
from django.contrib.auth import get_user_model
from students.serializers import StudentProfileSerializer, StudentProfileUpdateSerializer
from students.models import ParentProfile, ParentChild
from students.credentials import generate_credentials
from core.utils import filter_by_organization, belongs_to_user_organization

User = get_user_model()


def _active_students_queryset(request):
    qs = StudentProfile.objects.filter(is_deleted=False).select_related('user')
    return filter_by_organization(qs, request.user, 'user__organization')


def _deleted_students_queryset(request):
    qs = StudentProfile.objects.filter(is_deleted=True).select_related('user')
    return filter_by_organization(qs, request.user, 'user__organization')


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsTeacher])
def teacher_stats_view(request):
    """
    GET /api/teacher/stats
    Get teacher dashboard statistics
    """
    total_students = _active_students_queryset(request).count()
    active_students = total_students
    
    today = date.today()
    today_attendance = AttendanceRecord.objects.filter(
        lesson_date=today,
        status='present'
    ).count()
    
    coding_exercises_count = CodingTask.objects.filter(deleted_at__isnull=True).count()
    
    return Response({
        'totalStudents': total_students,
        'activeStudents': active_students,
        'todayAttendance': today_attendance,
        'codingExercisesCount': coding_exercises_count,
    })


@api_view(['GET', 'POST', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated, IsTeacher])
def teacher_students_view(request, pk=None):
    """
    GET /api/teacher/students?status=active|deleted
    POST /api/teacher/students — Create student with auto-generated credentials
    PATCH /api/teacher/students/{id}
    DELETE /api/teacher/students/{id} (soft delete)
    DELETE /api/teacher/students/{id}/hard (hard delete)
    """
    if request.method == 'GET':
        status_filter = request.query_params.get('status', 'active')
        if status_filter == 'deleted':
            students = _deleted_students_queryset(request)
        else:
            students = _active_students_queryset(request)
        if settings.DEBUG:
            import sys
            print(f'[teacher_students] count={students.count()}, org={getattr(request.user, "organization_id", None)}', file=sys.stderr)
        serializer = StudentProfileSerializer(students, many=True)
        return Response(serializer.data)

    if request.method == 'POST' and pk is None:
        data = request.data.copy()
        full_name = (data.get('fullName') or data.get('full_name') or '').strip()
        grade = (data.get('grade') or data.get('class') or '').strip() or None
        phone = (data.get('phone') or '').strip() or None
        balance = float(data.get('balance', 0))
        if not full_name:
            return Response({'detail': 'fullName is required'}, status=status.HTTP_400_BAD_REQUEST)

        creds = generate_credentials(full_name)
        org = request.user.organization
        for _ in range(5):
            if User.objects.filter(email=creds['student_email']).exists():
                creds = generate_credentials(full_name)
                continue
            break
        if User.objects.filter(email=creds['student_email']).exists():
            return Response({'detail': 'Could not generate unique email. Try again.'}, status=status.HTTP_409_CONFLICT)

        with transaction.atomic():
            student_user = User.objects.create_user(
                email=creds['student_email'],
                password=creds['student_password'],
                full_name=full_name,
                phone=phone,
                role='student',
                is_active=True,
                organization=org,
                must_change_password=True,
            )
            student_profile = StudentProfile.objects.create(
                user=student_user,
                grade=grade,
                balance=balance,
            )
            parent_user = User.objects.create_user(
                email=creds['parent_email'],
                password=creds['parent_password'],
                full_name=f'{full_name} — Valideyn',
                role='parent',
                is_active=True,
                organization=org,
                must_change_password=True,
            )
            ParentProfile.objects.create(user=parent_user)
            ParentChild.objects.create(parent=parent_user, student=student_user)

        result = StudentProfileSerializer(student_profile).data
        result['credentials'] = {
            'studentEmail': creds['student_email'],
            'studentPassword': creds['student_password'],
            'parentEmail': creds['parent_email'],
            'parentPassword': creds['parent_password'],
        }
        return Response(result, status=status.HTTP_201_CREATED)
    
    if request.method == 'PATCH':
        try:
            student = StudentProfile.objects.select_related('user').get(id=pk)
        except StudentProfile.DoesNotExist:
            return Response({'detail': 'Student not found'}, status=status.HTTP_404_NOT_FOUND)
        if not belongs_to_user_organization(student.user, request.user, 'organization'):
            return Response({'detail': 'Access denied'}, status=status.HTTP_403_FORBIDDEN)

        data = request.data.copy()
        if 'class' in data:
            data['grade'] = data.pop('class')
        serializer = StudentProfileUpdateSerializer(student, data=data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(StudentProfileSerializer(student).data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    
    if request.method == 'DELETE':
        try:
            student = StudentProfile.objects.select_related('user').get(id=pk)
        except StudentProfile.DoesNotExist:
            return Response({'detail': 'Student not found'}, status=status.HTTP_404_NOT_FOUND)
        if not belongs_to_user_organization(student.user, request.user, 'organization'):
            return Response({'detail': 'Access denied'}, status=status.HTTP_403_FORBIDDEN)

        # Check if hard delete
        if request.path.endswith('/hard') or request.path.endswith('/hard/'):
            student.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        # Soft delete
        from django.utils import timezone
        student.deleted_at = timezone.now()
        student.save(update_fields=['deleted_at', 'is_deleted', 'updated_at'])
        return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsTeacher])
def teacher_student_restore_view(request, pk):
    """
    POST /api/teacher/students/{id}/restore
    Restore a soft-deleted student. Sets is_deleted=False, deleted_at=null.
    """
    try:
        student = StudentProfile.objects.select_related('user').get(id=pk)
    except StudentProfile.DoesNotExist:
        return Response({'detail': 'Student not found'}, status=status.HTTP_404_NOT_FOUND)
    if not belongs_to_user_organization(student.user, request.user, 'organization'):
        return Response({'detail': 'Access denied'}, status=status.HTTP_403_FORBIDDEN)

    if not student.is_deleted:
        return Response({'detail': 'Student is not deleted'}, status=status.HTTP_400_BAD_REQUEST)

    student.deleted_at = None
    student.is_deleted = False
    student.save(update_fields=['deleted_at', 'is_deleted', 'updated_at'])

    serializer = StudentProfileSerializer(student)
    return Response(serializer.data, status=status.HTTP_200_OK)


@api_view(['GET', 'POST', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated, IsTeacher])
def teacher_groups_view(request, pk=None):
    """
    GET /api/teacher/groups
    POST /api/teacher/groups
    PATCH /api/teacher/groups/{id}
    DELETE /api/teacher/groups/{id}
    """
    if request.method == 'GET':
        groups = Group.objects.filter(deleted_at__isnull=True).select_related('organization')
        groups = filter_by_organization(groups, request.user)
        serializer = GroupSerializer(groups, many=True)
        return Response(serializer.data)
    
    if request.method == 'POST':
        serializer = GroupSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save(created_by=request.user)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    
    if request.method == 'PATCH':
        try:
            group = Group.objects.get(id=pk)
        except Group.DoesNotExist:
            return Response({'detail': 'Group not found'}, status=status.HTTP_404_NOT_FOUND)
        if not belongs_to_user_organization(group, request.user):
            return Response({'detail': 'Access denied'}, status=status.HTTP_403_FORBIDDEN)

        serializer = GroupSerializer(group, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    
    if request.method == 'DELETE':
        try:
            group = Group.objects.get(id=pk)
        except Group.DoesNotExist:
            return Response({'detail': 'Group not found'}, status=status.HTTP_404_NOT_FOUND)
        if not belongs_to_user_organization(group, request.user):
            return Response({'detail': 'Access denied'}, status=status.HTTP_403_FORBIDDEN)

        # Soft delete (archive)
        group.is_active = False
        group.deleted_at = timezone.now()
        group.save(update_fields=['is_active', 'deleted_at'])
        return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['GET', 'POST', 'DELETE'])
@permission_classes([IsAuthenticated, IsTeacher])
def teacher_group_students_view(request, group_id, student_id=None):
    """
    GET /api/teacher/groups/{id}/students (list students in group)
    POST /api/teacher/groups/{id}/students (add students)
    DELETE /api/teacher/groups/{id}/students/{studentId} (remove)
    """
    try:
        group = Group.objects.get(id=group_id)
    except Group.DoesNotExist:
        return Response({'detail': 'Qrup tapılmadı'}, status=status.HTTP_404_NOT_FOUND)
    if not belongs_to_user_organization(group, request.user):
        return Response({'detail': 'Bu qrupa əlavə etmə icazəniz yoxdur'}, status=status.HTTP_403_FORBIDDEN)
    
    if request.method == 'GET':
        memberships = get_active_students_for_group(group)
        students = [m.student_profile for m in memberships]
        serializer = StudentProfileSerializer(students, many=True)
        return Response(serializer.data)
    
    if request.method == 'POST':
        student_ids = request.data.get('studentIds', [])
        if not isinstance(student_ids, list):
            return Response({'detail': 'studentIds siyahı olmalıdır'}, status=status.HTTP_400_BAD_REQUEST)
        if not student_ids:
            return Response({'detail': 'Əlavə ediləcək şagird seçilməyib'}, status=status.HTTP_400_BAD_REQUEST)
        
        teacher_org = getattr(request.user, 'organization_id', None)
        added = []
        errors = []
        for sid in student_ids:
            try:
                student = StudentProfile.objects.select_related('user').get(id=sid, is_deleted=False)
            except StudentProfile.DoesNotExist:
                errors.append(f'Şagird #{sid} tapılmadı')
                continue
            if teacher_org and getattr(student.user, 'organization_id', None) != teacher_org:
                errors.append(f'{student.user.full_name} sizin təşkilatınıza aid deyil')
                continue
            org_id = student.user.organization_id if hasattr(student.user, 'organization_id') else group.organization_id
            membership, created = GroupStudent.objects.get_or_create(
                group=group,
                student_profile=student,
                defaults={'active': True, 'organization_id': org_id}
            )
            if not created:
                membership.active = True
                membership.save()
            added.append(sid)
        
        if errors and not added:
            return Response({'detail': '; '.join(errors)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({'added': added, 'errors': errors if errors else None}, status=status.HTTP_200_OK)
    
    if request.method == 'DELETE':
        try:
            student = StudentProfile.objects.get(id=student_id)
            membership = GroupStudent.objects.get(group=group, student_profile=student)
            membership.active = False
            membership.save()
            return Response(status=status.HTTP_204_NO_CONTENT)
        except (StudentProfile.DoesNotExist, GroupStudent.DoesNotExist):
            return Response({'detail': 'Student or membership not found'}, status=status.HTTP_404_NOT_FOUND)


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsTeacher])
def teacher_move_student_view(request):
    """
    POST /api/teacher/groups/move-student
    Move student from one group to another
    """
    student_id = request.data.get('studentId')
    from_group_id = request.data.get('fromGroupId')
    to_group_id = request.data.get('toGroupId')
    
    if not all([student_id, from_group_id, to_group_id]):
        return Response(
            {'detail': 'studentId, fromGroupId, and toGroupId are required'},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    try:
        move_student(student_id, from_group_id, to_group_id)
        return Response({'detail': 'Student moved successfully'}, status=status.HTTP_200_OK)
    except Exception as e:
        return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'POST', 'DELETE'])
@permission_classes([IsAuthenticated, IsTeacher])
def teacher_payments_view(request, pk=None):
    """
    GET /api/teacher/payments?groupId=&studentId=
    POST /api/teacher/payments
    DELETE /api/teacher/payments/{id}
    """
    if request.method == 'GET':
        payments = Payment.objects.filter(deleted_at__isnull=True).select_related(
            'student_profile__user', 'group', 'organization'
        )
        payments = filter_by_organization(payments, request.user)
        
        group_id = request.query_params.get('groupId')
        student_id = request.query_params.get('studentId')
        
        if group_id:
            payments = payments.filter(group_id=group_id)
        if student_id:
            payments = payments.filter(student_profile_id=student_id)
        
        serializer = TeacherPaymentSerializer(payments, many=True)
        return Response(serializer.data)
    
    if request.method == 'POST':
        # Pass frontend format directly; PaymentCreateSerializer expects studentId, groupId
        serializer = PaymentCreateSerializer(data=request.data)
        if serializer.is_valid():
            payment = serializer.save(created_by=request.user, organization=request.user.organization)
            return Response(TeacherPaymentSerializer(payment).data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    
    if request.method == 'DELETE':
        try:
            payment = Payment.objects.get(id=pk)
            if not belongs_to_user_organization(payment, request.user):
                return Response({'detail': 'Access denied'}, status=status.HTTP_403_FORBIDDEN)
            payment.deleted_at = timezone.now()
            payment.save(update_fields=['deleted_at'])
            return Response(status=status.HTTP_204_NO_CONTENT)
        except Payment.DoesNotExist:
            return Response({'detail': 'Payment not found'}, status=status.HTTP_404_NOT_FOUND)
