"""
Lesson finalize service: when teacher clicks Save, finalize the lesson and charge students.
Uses LessonHeld and BalanceLedger for idempotent charging.
"""
import logging
from decimal import Decimal
from django.db import transaction
from django.conf import settings

from groups.models import Group
from groups.services import get_active_students_for_group
from attendance.models import LessonHeld, AttendanceRecord
from students.models import StudentProfile, BalanceLedger
from notifications.services import check_and_create_balance_notifications

logger = logging.getLogger(__name__)


def _weekday_iso(lesson_date):
    """Python date.weekday(): Mon=0, Sun=6. Map to Mon=1..Sun=7."""
    return lesson_date.weekday() + 1


def _per_lesson_fee(group: Group):
    """per_lesson_fee = monthly_fee / monthly_lessons_count, quantize 0.01."""
    fee = group.monthly_fee
    count = group.monthly_lessons_count or 8
    if fee is None or fee <= 0 or count <= 0:
        return Decimal("0.00")
    return (Decimal(fee) / Decimal(count)).quantize(Decimal("0.01"))


def finalize_lesson_and_charge(group: Group, lesson_date, created_by=None):
    """
    Finalize a lesson (teacher clicked Save) and charge all active students.
    Idempotent: if LessonHeld already exists for (group, date), no charge is made.
    
    Returns:
        (lesson_held_created: bool, students_charged: int, charge_details: list)
        charge_details: [{studentId, oldBalance, newBalance, chargeAmount}]
    """
    logger.info(f"[finalize_lesson] Called: group_id={group.id}, name={group.name}, date={lesson_date}, created_by={created_by}")
    
    # Check if lesson date matches group schedule
    schedule_days = getattr(group, "schedule_days", None) or getattr(group, "days_of_week", None) or []
    logger.info(f"[finalize_lesson] schedule_days={schedule_days}, days_of_week={getattr(group, 'days_of_week', None)}")
    
    if schedule_days:
        weekday = _weekday_iso(lesson_date)
        valid_days = set(int(d) for d in schedule_days if 1 <= int(d) <= 7)
        logger.info(f"[finalize_lesson] weekday={weekday}, valid_days={valid_days}")
        if weekday not in valid_days:
            logger.warning(f"[finalize_lesson] Weekday {weekday} not in {valid_days}, skipping charge (but lesson can still be finalized)")
            # NOTE: We still allow finalizing even if schedule doesn't match (teacher override)
            # If you want strict schedule check, uncomment:
            # return False, 0
    
    per_lesson = _per_lesson_fee(group)
    logger.info(f"[finalize_lesson] monthly_fee={group.monthly_fee}, lessons_count={group.monthly_lessons_count}, per_lesson={per_lesson}")
    
    if per_lesson <= 0:
        logger.warning(f"[finalize_lesson] per_lesson={per_lesson} <= 0, cannot charge. Check group.monthly_fee and monthly_lessons_count")
        return False, 0, []
    
    with transaction.atomic():
        # Create LessonHeld record (idempotent)
        lesson_held, created = LessonHeld.objects.get_or_create(
            group=group,
            date=lesson_date,
            defaults={'created_by': created_by, 'is_finalized': True},
        )
        # If already exists but not finalized, finalize it now
        if not created and not lesson_held.is_finalized:
            lesson_held.is_finalized = True
            lesson_held.save(update_fields=['is_finalized'])
        
        logger.info(f"[finalize_lesson] LessonHeld get_or_create: created={created}, id={lesson_held.id}")
        
        if not created:
            # Lesson already finalized, no charge
            logger.info(f"[finalize_lesson] Lesson already finalized (id={lesson_held.id}), skipping charge (idempotent)")
            return False, 0, []
        
        # Get active students
        memberships = get_active_students_for_group(group)
        students = [m.student_profile for m in memberships if not m.student_profile.is_deleted]
        
        logger.info(f"[finalize_lesson] Active students: {len(students)}")
        
        if not students:
            logger.warning(f"[finalize_lesson] No active students in group, cannot charge")
            return True, 0, []
        
        # Get attendance records for this lesson date to check excused status
        attendance_records = {
            ar.student_profile_id: ar.status
            for ar in AttendanceRecord.objects.filter(
                group=group,
                lesson_date=lesson_date
            ).select_related('student_profile')
        }
        
        debit_amount = -per_lesson
        logger.info(f"[finalize_lesson] Charge amount per student: {debit_amount} (per_lesson={per_lesson})")
        
        # Create ledger entries and update balances
        ledger_entries = []
        student_updates = []
        charge_details = []
        
        for sp in students:
            # Check if student is excused (uzrlu) - skip charging
            attendance_status = attendance_records.get(sp.id)
            if attendance_status == AttendanceRecord.STATUS_EXCUSED:
                logger.info(f"[finalize_lesson] Student {sp.id} ({sp.user.full_name}) is excused (uzrlu), skipping charge")
                continue
            
            # Refresh to get latest balance
            sp.refresh_from_db()
            old_balance = sp.balance or Decimal("0")
            new_balance = old_balance + debit_amount
            
            logger.info(f"[finalize_lesson] Student {sp.id} ({sp.user.full_name}): balance {old_balance} -> {new_balance} (charge: {debit_amount})")
            
            # Store charge details for response
            charge_details.append({
                "studentId": str(sp.id),
                "oldBalance": float(old_balance),
                "newBalance": float(new_balance),
                "chargeAmount": float(-debit_amount),  # Positive amount charged
            })
            
            # Create ledger entry
            ledger_entries.append(
                BalanceLedger(
                    student_profile=sp,
                    group=group,
                    date=lesson_date,
                    amount_delta=debit_amount,
                    reason=BalanceLedger.REASON_LESSON_CHARGE,
                )
            )
            
            # Prepare balance update
            sp.balance = new_balance
            student_updates.append(sp)
        
        # Bulk create ledger entries
        if ledger_entries:
            BalanceLedger.objects.bulk_create(ledger_entries)
            logger.info(f"[finalize_lesson] Created {len(ledger_entries)} BalanceLedger entries")
        
        # Bulk update balances
        if student_updates:
            StudentProfile.objects.bulk_update(student_updates, ["balance"])
            logger.info(f"[finalize_lesson] Updated {len(student_updates)} StudentProfile balances")
        
        # Verify updates by refreshing and logging
        for sp in students:
            sp.refresh_from_db()
            logger.info(f"[finalize_lesson] VERIFIED Student {sp.id} ({sp.user.full_name}): final_balance={sp.balance}")
        
        # Check and create balance zero notifications
        try:
            for sp in students:
                check_and_create_balance_notifications(sp, group=group)
        except Exception as e:
            logger.error(f"[finalize_lesson] Error creating notifications: {e}", exc_info=True)
            # Don't fail the charge operation if notification creation fails
        
        logger.info(f"[finalize_lesson] Successfully charged {len(students)} students")
        return True, len(students), charge_details
