"""
Group and Group-Student relationship (ERD: group, group_membership).
Schedule: days_of_week, start_time, display_name (auto or manual).
"""
from django.db import models
from accounts.models import User
from students.models import StudentProfile


class Group(models.Model):
    """
    Group — teacher's class group with optional schedule.
    display_name can be auto-generated from days_of_week + start_time (e.g. "Qrup1: 1-4 11:00").
    """
    organization = models.ForeignKey(
        'core.Organization',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='groups',
        db_column='organization_id',
    )
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='created_groups',
        limit_choices_to={'role': 'teacher'},
        db_column='teacher_id',
    )
    code = models.CharField(max_length=50, blank=True, null=True)
    name = models.CharField(max_length=255)
    # days_of_week: 1=Mon..7=Sun; stored as JSON list [1,2,3,4] for portability (Postgres ArrayField optional)
    days_of_week = models.JSONField(default=list, blank=True, help_text="e.g. [1,2,3,4]")
    start_time = models.TimeField(blank=True, null=True)
    display_name = models.CharField(max_length=255, blank=True, null=True, db_index=True)
    is_active = models.BooleanField(default=True)
    sort_order = models.IntegerField(null=True, blank=True, default=0)
    deleted_at = models.DateTimeField(null=True, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'groups'
        verbose_name = 'Group'
        verbose_name_plural = 'Groups'
        ordering = ['sort_order', 'name']

    def __str__(self):
        return self.display_name or self.name

    @property
    def student_count(self):
        return self.group_students.filter(active=True, left_at__isnull=True).count()


class GroupStudent(models.Model):
    """
    Group membership (ERD: group_membership). left_at for history.
    """
    organization = models.ForeignKey(
        'core.Organization',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='group_memberships',
        db_column='organization_id',
    )
    group = models.ForeignKey(
        Group,
        on_delete=models.CASCADE,
        related_name='group_students',
    )
    student_profile = models.ForeignKey(
        StudentProfile,
        on_delete=models.CASCADE,
        related_name='group_memberships',
    )
    joined_at = models.DateTimeField(auto_now_add=True)
    left_at = models.DateTimeField(null=True, blank=True)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'group_students'
        verbose_name = 'Group Student'
        verbose_name_plural = 'Group Students'
        unique_together = [['group', 'student_profile']]
        ordering = ['-joined_at']

    def __str__(self):
        return f"{self.group.name} - {self.student_profile.user.full_name}"
