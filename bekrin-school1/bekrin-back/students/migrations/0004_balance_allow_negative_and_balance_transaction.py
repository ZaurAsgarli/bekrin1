# Migration: Allow negative balance; add BalanceTransaction for lesson debits

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("groups", "0004_add_monthly_fee_lessons_count"),
        ("students", "0003_add_imported_credential_record"),
    ]

    operations = [
        migrations.AlterField(
            model_name="studentprofile",
            name="balance",
            field=models.DecimalField(
                decimal_places=2,
                default=0.0,
                max_digits=10,
            ),
        ),
        migrations.CreateModel(
            name="BalanceTransaction",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("lesson_date", models.DateField(db_index=True)),
                (
                    "amount",
                    models.DecimalField(
                        decimal_places=2,
                        help_text="Negative for debit (e.g. -12.50)",
                        max_digits=10,
                    ),
                ),
                (
                    "type",
                    models.CharField(
                        choices=[("lesson_debit", "Dərs haqqı çıxılışı")],
                        default="lesson_debit",
                        max_length=30,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "group",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="balance_transactions",
                        to="groups.group",
                        db_index=True,
                    ),
                ),
                (
                    "student_profile",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="balance_transactions",
                        to="students.studentprofile",
                        db_index=True,
                    ),
                ),
            ],
            options={
                "db_table": "balance_transactions",
                "verbose_name": "Balance Transaction",
                "verbose_name_plural": "Balance Transactions",
                "ordering": ["-lesson_date", "-created_at"],
            },
        ),
        migrations.AddIndex(
            model_name="balancetransaction",
            index=models.Index(fields=["student_profile_id", "lesson_date"], name="balance_tra_student_9b0b0d_idx"),
        ),
        migrations.AddIndex(
            model_name="balancetransaction",
            index=models.Index(fields=["group_id", "lesson_date"], name="balance_tra_group_i_8a1c2e_idx"),
        ),
        migrations.AddConstraint(
            model_name="balancetransaction",
            constraint=models.UniqueConstraint(
                fields=("student_profile", "group", "lesson_date", "type"),
                name="unique_student_group_lesson_type",
            ),
        ),
    ]
