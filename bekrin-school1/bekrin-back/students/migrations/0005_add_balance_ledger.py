# Migration: Add BalanceLedger model
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('students', '0004_balance_allow_negative_and_balance_transaction'),
        ('groups', '0004_add_monthly_fee_lessons_count'),
    ]

    operations = [
        migrations.CreateModel(
            name='BalanceLedger',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('date', models.DateField(db_index=True, help_text='Date of the transaction')),
                ('amount_delta', models.DecimalField(decimal_places=2, help_text='Negative for charges, positive for topups', max_digits=10)),
                ('reason', models.CharField(choices=[('LESSON_CHARGE', 'Lesson Charge'), ('TOPUP', 'Top-up'), ('MANUAL', 'Manual Adjustment')], db_index=True, max_length=50)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('group', models.ForeignKey(blank=True, db_index=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='balance_ledger_entries', to='groups.group')),
                ('student_profile', models.ForeignKey(db_index=True, on_delete=django.db.models.deletion.CASCADE, related_name='balance_ledger_entries', to='students.studentprofile')),
            ],
            options={
                'verbose_name': 'Balance Ledger Entry',
                'verbose_name_plural': 'Balance Ledger Entries',
                'db_table': 'balance_ledger',
                'ordering': ['-date', '-created_at'],
            },
        ),
        migrations.AddConstraint(
            model_name='balanceledger',
            constraint=models.UniqueConstraint(fields=['student_profile', 'group', 'date', 'reason'], name='unique_student_group_date_reason'),
        ),
        migrations.AddIndex(
            model_name='balanceledger',
            index=models.Index(fields=['student_profile', 'date'], name='balance_led_student_date_idx'),
        ),
        migrations.AddIndex(
            model_name='balanceledger',
            index=models.Index(fields=['group', 'date'], name='balance_led_group_date_idx'),
        ),
    ]
