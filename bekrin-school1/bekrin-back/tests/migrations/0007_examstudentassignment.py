# Migration: Add ExamStudentAssignment for single-student exam assignment

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('tests', '0006_teacherpdf_organization'),
    ]

    operations = [
        migrations.CreateModel(
            name='ExamStudentAssignment',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('exam', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='student_assignments', to='tests.exam')),
                ('student', models.ForeignKey(limit_choices_to={'role': 'student'}, on_delete=django.db.models.deletion.CASCADE, related_name='exam_student_assignments', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Exam Student Assignment',
                'verbose_name_plural': 'Exam Student Assignments',
                'db_table': 'exam_student_assignments',
                'unique_together': {('exam', 'student')},
            },
        ),
        migrations.AddIndex(
            model_name='examstudentassignment',
            index=models.Index(fields=['exam'], name='exam_studen_exam_id_idx'),
        ),
        migrations.AddIndex(
            model_name='examstudentassignment',
            index=models.Index(fields=['student'], name='exam_studen_student_idx'),
        ),
    ]
