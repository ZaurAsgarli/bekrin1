"""
Attendance model: one record per student per day.
Unique constraint: (student_profile, lesson_date).
"""
from django.db import models
from students.models import StudentProfile


class AttendanceRecord(models.Model):
    """
    Daily attendance record. One record per student per day globally.
    Unique: (student_profile, lesson_date).
    """
    STATUS_PRESENT = "present"
    STATUS_ABSENT = "absent"
    STATUS_LATE = "late"
    STATUS_EXCUSED = "excused"

    STATUS_CHOICES = [
        (STATUS_PRESENT, "Present"),
        (STATUS_ABSENT, "Absent"),
        (STATUS_LATE, "Late"),
        (STATUS_EXCUSED, "Excused"),
    ]

    student_profile = models.ForeignKey(
        StudentProfile,
        on_delete=models.CASCADE,
        related_name="attendance_records",
    )
    lesson_date = models.DateField(db_column="lesson_date")
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default=STATUS_PRESENT,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # Optional: group for audit (which group context when marked)
    group = models.ForeignKey(
        "groups.Group",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="attendance_records",
    )
    organization = models.ForeignKey(
        "core.Organization",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="attendance_records",
        db_column="organization_id",
    )
    marked_by = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="marked_attendance",
        db_column="marked_by_id",
    )
    marked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "attendance_records"
        verbose_name = "Attendance Record"
        verbose_name_plural = "Attendance Records"
        unique_together = [["student_profile", "lesson_date"]]
        ordering = ["-lesson_date", "student_profile"]
        indexes = [
            models.Index(fields=["student_profile", "lesson_date"]),
            models.Index(fields=["lesson_date"]),
        ]

    def __str__(self):
        return f"{self.student_profile.user.full_name} - {self.lesson_date} - {self.status}"
