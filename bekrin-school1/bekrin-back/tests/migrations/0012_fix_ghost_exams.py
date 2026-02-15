# Generated data migration: Fix ghost active exams (missing duration or target)

from django.db import migrations


def fix_ghost_exams(apps, schema_editor):
    """Set status=draft for active exams missing duration or at least one assignment."""
    Exam = apps.get_model("tests", "Exam")
    ExamAssignment = apps.get_model("tests", "ExamAssignment")
    ExamStudentAssignment = apps.get_model("tests", "ExamStudentAssignment")
    fixed = 0
    for exam in Exam.objects.filter(status="active", is_archived=False):
        has_duration = (exam.duration_minutes or 0) > 0
        has_group = ExamAssignment.objects.filter(exam=exam, is_active=True).exists()
        has_student = ExamStudentAssignment.objects.filter(exam=exam, is_active=True).exists()
        if not (has_duration and (has_group or has_student)):
            exam.status = "draft"
            exam.save(update_fields=["status"])
            fixed += 1
    if fixed:
        print(f"Fixed {fixed} ghost exam(s) -> set to draft")


def reverse_fix_ghost_exams(apps, schema_editor):
    """No-op: cannot reliably restore status=active for fixed ghosts."""
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("tests", "0011_archive_soft_delete"),
    ]

    operations = [
        migrations.RunPython(fix_ghost_exams, reverse_fix_ghost_exams),
    ]
