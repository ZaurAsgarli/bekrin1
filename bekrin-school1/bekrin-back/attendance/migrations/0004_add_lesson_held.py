# Migration: Add LessonHeld model
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('attendance', '0003_group_lesson_session'),
        ('groups', '0004_add_monthly_fee_lessons_count'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='LessonHeld',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('date', models.DateField(db_index=True, help_text='Date the lesson was held')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('created_by', models.ForeignKey(blank=True, limit_choices_to={'role': 'teacher'}, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='lessons_held_created', to=settings.AUTH_USER_MODEL)),
                ('group', models.ForeignKey(db_index=True, on_delete=django.db.models.deletion.CASCADE, related_name='lessons_held', to='groups.group')),
            ],
            options={
                'verbose_name': 'Lesson Held',
                'verbose_name_plural': 'Lessons Held',
                'db_table': 'lessons_held',
            },
        ),
        migrations.AddConstraint(
            model_name='lessonheld',
            constraint=models.UniqueConstraint(fields=['group', 'date'], name='unique_group_lesson_held_date'),
        ),
        migrations.AddIndex(
            model_name='lessonheld',
            index=models.Index(fields=['group_id', 'date'], name='lessons_hel_group_id_date_idx'),
        ),
        migrations.AddIndex(
            model_name='lessonheld',
            index=models.Index(fields=['date'], name='lessons_hel_date_idx'),
        ),
    ]
