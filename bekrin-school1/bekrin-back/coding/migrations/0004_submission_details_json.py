# Add details_json for per-test results (teacher sees full; student sees summary only)

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('coding', '0003_add_is_sample_to_testcase'),
    ]

    operations = [
        migrations.AddField(
            model_name='codingsubmission',
            name='details_json',
            field=models.JSONField(blank=True, default=list, help_text='Per-test results [{test_case_id, passed, output?, expected?}]. Teacher-only for hidden tests.'),
        ),
        migrations.AddIndex(
            model_name='codingsubmission',
            index=models.Index(fields=['task', 'student', 'created_at'], name='coding_subm_task_stu_idx'),
        ),
        migrations.AddIndex(
            model_name='codingtestcase',
            index=models.Index(fields=['task', 'order_index'], name='coding_test_task_order_idx'),
        ),
    ]
