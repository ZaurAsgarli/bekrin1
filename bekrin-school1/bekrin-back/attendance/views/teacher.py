"""
Teacher attendance API.
Endpoints:
- GET  /attendance/group/{group_id}/daily?date=      Daily view: students + status for date
- POST /attendance/save                              Bulk save attendance
- GET  /attendance/group/{group_id}/monthly?month=&year=  Monthly stats per student
"""
from calendar import monthrange
from datetime import date, datetime, timedelta
from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from accounts.permissions import IsTeacher
from core.utils import filter_by_organization, belongs_to_user_organization
from groups.models import Group
from groups.services import get_active_students_for_group
from students.models import StudentProfile
from attendance.models import AttendanceRecord


VALID_STATUSES = {"present", "absent", "late", "excused"}
DEFAULT_STATUS = "present"


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsTeacher])
def attendance_group_daily_view(request, group_id):
    """
    GET /api/teacher/attendance/group/{group_id}/daily?date=2025-02-07
    Returns students in group with status for that date.
    """
    date_str = request.query_params.get("date")
    if not date_str:
        return Response(
            {"detail": "date query param required (YYYY-MM-DD)"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    try:
        target_date = datetime.strptime(date_str[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return Response(
            {"detail": "Invalid date format"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        group = Group.objects.get(id=group_id)
    except Group.DoesNotExist:
        return Response({"detail": "Group not found"}, status=status.HTTP_404_NOT_FOUND)
    if not belongs_to_user_organization(group, request.user):
        return Response({"detail": "Access denied"}, status=status.HTTP_403_FORBIDDEN)

    memberships = get_active_students_for_group(group)
    students = [m.student_profile for m in memberships if not m.student_profile.is_deleted]

    # Fetch existing records for this date (by student only - unique per student/date)
    student_ids = [s.id for s in students]
    records = AttendanceRecord.objects.filter(
        student_profile_id__in=student_ids,
        lesson_date=target_date,
    ).select_related("student_profile")

    record_map = {r.student_profile_id: r.status for r in records}

    result = {
        "date": target_date.isoformat(),
        "groupId": str(group.id),
        "groupName": group.name,
        "students": [],
    }
    for sp in students:
        result["students"].append({
            "id": str(sp.id),
            "fullName": sp.user.full_name,
            "email": sp.user.email,
            "status": record_map.get(sp.id, DEFAULT_STATUS),
        })

    return Response(result)


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsTeacher])
def attendance_save_view(request):
    """
    POST /api/teacher/attendance/save
    Body: { date: "YYYY-MM-DD", groupId: "…", records: [{ studentId, status }] }
    Creates or updates attendance in transaction.
    """
    date_str = request.data.get("date")
    group_id = request.data.get("groupId")
    records_data = request.data.get("records", [])

    if not date_str or not group_id:
        return Response(
            {"detail": "date and groupId are required"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    try:
        target_date = datetime.strptime(date_str[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return Response(
            {"detail": "Invalid date format"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        group = Group.objects.get(id=group_id)
    except Group.DoesNotExist:
        return Response({"detail": "Group not found"}, status=status.HTTP_404_NOT_FOUND)
    if not belongs_to_user_organization(group, request.user):
        return Response({"detail": "Access denied"}, status=status.HTTP_403_FORBIDDEN)

    with transaction.atomic():
        saved = 0
        for item in records_data:
            student_id = item.get("studentId")
            status_val = item.get("status", DEFAULT_STATUS)
            if not student_id or status_val not in VALID_STATUSES:
                continue
            try:
                student = StudentProfile.objects.get(
                    id=student_id, is_deleted=False
                )
            except StudentProfile.DoesNotExist:
                continue
            if not belongs_to_user_organization(student.user, request.user, "organization"):
                continue

            AttendanceRecord.objects.update_or_create(
                student_profile=student,
                lesson_date=target_date,
                defaults={
                    "status": status_val,
                    "group": group,
                    "organization": request.user.organization,
                    "marked_by": request.user,
                    "marked_at": timezone.now(),
                },
            )
            saved += 1

    return Response({"saved": saved, "message": "Davamiyyət saxlanıldı"})


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsTeacher])
def attendance_group_monthly_view(request, group_id):
    """
    GET /api/teacher/attendance/group/{group_id}/monthly?month=2&year=2025
    Returns per-student stats: Present, Absent, Late, Excused, Attendance %
    """
    year = request.query_params.get("year", str(date.today().year))
    month = request.query_params.get("month", str(date.today().month))
    try:
        year = int(year)
        month = int(month)
    except ValueError:
        return Response(
            {"detail": "Invalid year or month"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        group = Group.objects.get(id=group_id)
    except Group.DoesNotExist:
        return Response({"detail": "Group not found"}, status=status.HTTP_404_NOT_FOUND)
    if not belongs_to_user_organization(group, request.user):
        return Response({"detail": "Access denied"}, status=status.HTTP_403_FORBIDDEN)

    _, last_day = monthrange(year, month)
    start_date = date(year, month, 1)
    end_date = date(year, month, last_day)

    memberships = get_active_students_for_group(group)
    students = [m.student_profile for m in memberships if not m.student_profile.is_deleted]
    student_ids = [s.id for s in students]

    from django.db.models import Count

    records = (
        AttendanceRecord.objects.filter(
            student_profile_id__in=student_ids,
            lesson_date__gte=start_date,
            lesson_date__lte=end_date,
        )
        .values("student_profile", "status")
        .annotate(cnt=Count("id"))
    )

    # Build counts per student
    stats = {}
    for r in records:
        sid = r["student_profile"]
        if sid not in stats:
            stats[sid] = {"present": 0, "absent": 0, "late": 0, "excused": 0}
        stats[sid][r["status"]] = r["cnt"]

    total_days = (end_date - start_date).days + 1
    result = {
        "year": year,
        "month": month,
        "groupId": str(group.id),
        "groupName": group.name,
        "students": [],
    }
    for sp in students:
        s = stats.get(sp.id, {"present": 0, "absent": 0, "late": 0, "excused": 0})
        total = s["present"] + s["absent"] + s["late"] + s["excused"]
        pct = round((s["present"] / total * 100), 1) if total > 0 else 0
        result["students"].append({
            "id": str(sp.id),
            "fullName": sp.user.full_name,
            "email": sp.user.email,
            "present": s["present"],
            "absent": s["absent"],
            "late": s["late"],
            "excused": s["excused"],
            "attendancePercent": pct,
        })

    return Response(result)


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsTeacher])
def attendance_student_daily_view(request, group_id, student_id):
    """
    GET /api/teacher/attendance/group/{group_id}/student/{student_id}/daily?year=&month=
    Returns daily breakdown for a student in a month (for modal).
    """
    year = request.query_params.get("year", str(date.today().year))
    month = request.query_params.get("month", str(date.today().month))
    try:
        year = int(year)
        month = int(month)
    except ValueError:
        return Response(
            {"detail": "Invalid year or month"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        group = Group.objects.get(id=group_id)
    except Group.DoesNotExist:
        return Response({"detail": "Group not found"}, status=status.HTTP_404_NOT_FOUND)
    if not belongs_to_user_organization(group, request.user):
        return Response({"detail": "Access denied"}, status=status.HTTP_403_FORBIDDEN)

    try:
        student = StudentProfile.objects.get(id=student_id, is_deleted=False)
    except StudentProfile.DoesNotExist:
        return Response({"detail": "Student not found"}, status=status.HTTP_404_NOT_FOUND)

    _, last_day = monthrange(year, month)
    start_date = date(year, month, 1)
    end_date = date(year, month, last_day)

    records = AttendanceRecord.objects.filter(
        student_profile=student,
        lesson_date__gte=start_date,
        lesson_date__lte=end_date,
    ).values_list("lesson_date", "status")

    record_map = {d.isoformat(): s for d, s in records}
    result = []
    for i in range(last_day):
        d = start_date + timedelta(days=i)
        ds = d.isoformat()
        result.append({"date": ds, "status": record_map.get(ds)})
    return Response({"studentId": str(student_id), "year": year, "month": month, "records": result})


# Legacy: keep grid view for backward compat during transition
@api_view(["GET"])
@permission_classes([IsAuthenticated, IsTeacher])
def teacher_attendance_grid_view(request):
    """
    GET /api/teacher/attendance?year=2026&month=2
    Returns full month grid (all groups) for legacy UI.
    """
    year = request.query_params.get("year", str(date.today().year))
    month = request.query_params.get("month", str(date.today().month))
    try:
        year = int(year)
        month = int(month)
    except ValueError:
        return Response(
            {"detail": "Invalid year or month"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    _, last_day = monthrange(year, month)
    start_date = date(year, month, 1)
    end_date = date(year, month, last_day)
    dates_list = [start_date + timedelta(days=i) for i in range(last_day)]

    groups_qs = Group.objects.filter(is_active=True).order_by("sort_order", "name")
    groups_qs = filter_by_organization(groups_qs, request.user)

    grid = {
        "year": year,
        "month": month,
        "dates": [d.isoformat() for d in dates_list],
        "groups": [],
    }

    for group in groups_qs:
        memberships = get_active_students_for_group(group)
        students = [m.student_profile for m in memberships if not m.student_profile.is_deleted]

        student_ids = [s.id for s in students]
        records = AttendanceRecord.objects.filter(
            student_profile_id__in=student_ids,
            lesson_date__gte=start_date,
            lesson_date__lte=end_date,
        ).select_related("student_profile")

        record_map = {(r.student_profile_id, r.lesson_date.isoformat()): r.status for r in records}

        group_data = {
            "id": str(group.id),
            "name": group.name,
            "students": [],
        }
        for sp in students:
            student_row = {
                "id": str(sp.id),
                "fullName": sp.user.full_name,
                "email": sp.user.email,
                "records": {},
            }
            for d in dates_list:
                ds = d.isoformat()
                student_row["records"][ds] = record_map.get((sp.id, ds))
            group_data["students"].append(student_row)
        grid["groups"].append(group_data)

    return Response(grid)


@api_view(["POST", "PATCH"])
@permission_classes([IsAuthenticated, IsTeacher])
def teacher_attendance_update_view(request):
    """
    POST/PATCH /api/teacher/attendance/update
    Body: { groupId, studentId, date, status }
    Single record update (legacy, for grid auto-save).
    """
    group_id = request.data.get("groupId")
    student_id = request.data.get("studentId")
    lesson_date = request.data.get("date")
    status_val = request.data.get("status")

    if not all([group_id, student_id, lesson_date, status_val]):
        return Response(
            {"detail": "groupId, studentId, date, and status are required"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if status_val not in VALID_STATUSES:
        return Response({"detail": "Invalid status"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        target_date = datetime.strptime(str(lesson_date)[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return Response(
            {"detail": "Invalid date format"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        group = Group.objects.get(id=group_id)
        student = StudentProfile.objects.get(id=student_id, is_deleted=False)
    except (Group.DoesNotExist, StudentProfile.DoesNotExist):
        return Response(
            {"detail": "Group or student not found"},
            status=status.HTTP_404_NOT_FOUND,
        )
    if not belongs_to_user_organization(group, request.user):
        return Response({"detail": "Access denied"}, status=status.HTTP_403_FORBIDDEN)
    if not belongs_to_user_organization(student.user, request.user, "organization"):
        return Response({"detail": "Access denied"}, status=status.HTTP_403_FORBIDDEN)

    record, created = AttendanceRecord.objects.update_or_create(
        student_profile=student,
        lesson_date=target_date,
        defaults={
            "status": status_val,
            "group": group,
            "marked_by": request.user,
            "marked_at": timezone.now(),
            "organization": request.user.organization,
        },
    )
    from attendance.serializers import AttendanceRecordSerializer
    return Response(
        AttendanceRecordSerializer(record).data,
        status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
    )
