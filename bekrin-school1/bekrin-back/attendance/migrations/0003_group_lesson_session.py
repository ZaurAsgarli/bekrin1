# Migration: GroupLessonSession for idempotent lesson charging

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("attendance", "0002_attendance_redesign"),
        ("groups", "0004_add_monthly_fee_lessons_count"),
    ]

    operations = [
        migrations.CreateModel(
            name="GroupLessonSession",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("lesson_date", models.DateField(db_index=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "group",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="lesson_sessions",
                        to="groups.group",
                        db_index=True,
                    ),
                ),
            ],
            options={
                "db_table": "group_lesson_sessions",
                "verbose_name": "Group Lesson Session",
                "verbose_name_plural": "Group Lesson Sessions",
            },
        ),
        migrations.AddIndex(
            model_name="grouplessonsession",
            index=models.Index(fields=["group_id", "lesson_date"], name="group_lesso_group_i_2d4f1a_idx"),
        ),
        migrations.AddConstraint(
            model_name="grouplessonsession",
            constraint=models.UniqueConstraint(
                fields=("group", "lesson_date"),
                name="unique_group_lesson_date",
            ),
        ),
    ]
