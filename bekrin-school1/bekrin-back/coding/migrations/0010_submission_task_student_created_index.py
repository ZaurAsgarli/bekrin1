# Add composite index (task_id, student_id, created_at) for coding monitor speed

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("coding", "0009_alter_codingtopic_created_by"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="codingsubmission",
            index=models.Index(fields=["task", "student", "created_at"], name="coding_subm_task_stu_created_idx"),
        ),
    ]
