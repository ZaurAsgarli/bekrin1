"""
Notification services: create, resolve, auto-resolve on balance changes.
"""
from decimal import Decimal
from django.db import transaction
from django.utils import timezone

from notifications.models import Notification
from students.models import StudentProfile


def create_balance_zero_notification(student_profile, group=None, created_by=None):
    """
    Create a BALANCE_ZERO notification for a student.
    Returns the created notification or None if one already exists.
    """
    # Check if active notification already exists (is_read=False means active)
    existing = Notification.objects.filter(
        student=student_profile,
        type=Notification.TYPE_BALANCE_ZERO,
        is_read=False,
    ).first()
    
    if existing:
        return existing
    
    message = f"{student_profile.user.full_name} şagirdinin balansı 0-a düşdü"
    if group:
        message += f" ({group.name} qrupu)"
    
    notification = Notification.objects.create(
        type=Notification.TYPE_BALANCE_ZERO,
        student=student_profile,
        group=group,
        message=message,
        created_by=created_by,
    )
    return notification


def auto_resolve_balance_notifications(student_profile):
    """
    Auto-resolve all BALANCE_ZERO notifications for a student if balance > 0.
    Called after balance top-up or increase.
    Marks as read (is_read=True) to remove from active notifications.
    """
    if student_profile.balance and student_profile.balance > Decimal('0'):
        updated = Notification.objects.filter(
            student=student_profile,
            type=Notification.TYPE_BALANCE_ZERO,
            is_read=False,
        ).update(
            is_read=True,
            is_resolved=True,
            resolved_at=timezone.now(),
        )
        return updated
    return 0


def check_and_create_balance_notifications(student_profile, group=None):
    """
    Check if student balance is zero and create notification if needed.
    Called after balance decreases (lesson charge).
    """
    if student_profile.balance is None or student_profile.balance <= Decimal('0'):
        create_balance_zero_notification(student_profile, group=group)
        return True
    return False
