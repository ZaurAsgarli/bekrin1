# Migration: Add monthly_fee and monthly_lessons_count for lesson charging

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("groups", "0003_parse_days_from_display_name"),
    ]

    operations = [
        migrations.AddField(
            model_name="group",
            name="monthly_fee",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text="Aylıq haqq (real AZN)",
                max_digits=10,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="group",
            name="monthly_lessons_count",
            field=models.PositiveIntegerField(
                default=8,
                help_text="Ayda dərs sayı; per_lesson_fee = monthly_fee / monthly_lessons_count",
            ),
        ),
    ]
