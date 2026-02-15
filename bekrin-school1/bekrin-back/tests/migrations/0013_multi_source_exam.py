# Multi-source exam: ExamRun, source_type, answer_key_json, per-attempt publish, PDF/JSON answers

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('tests', '0012_fix_ghost_exams'),
    ]

    operations = [
        migrations.AddField(
            model_name='exam',
            name='source_type',
            field=models.CharField(
                choices=[('BANK', 'Question Bank'), ('PDF', 'PDF + Answer Key'), ('JSON', 'JSON Only')],
                db_index=True,
                default='BANK',
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name='exam',
            name='answer_key_json',
            field=models.JSONField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='exam',
            name='meta_json',
            field=models.JSONField(blank=True, null=True),
        ),
        migrations.CreateModel(
            name='ExamRun',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('start_at', models.DateTimeField()),
                ('end_at', models.DateTimeField()),
                ('duration_minutes', models.IntegerField()),
                ('status', models.CharField(
                    choices=[('scheduled', 'Scheduled'), ('active', 'Active'), ('finished', 'Finished')],
                    db_index=True,
                    default='scheduled',
                    max_length=20,
                )),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('exam', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='runs', to='tests.exam')),
                ('group', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='exam_runs',
                    to='groups.group',
                )),
                ('student', models.ForeignKey(
                    blank=True,
                    null=True,
                    limit_choices_to={'role': 'student'},
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='exam_runs',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('created_by', models.ForeignKey(
                    db_column='created_by_id',
                    limit_choices_to={'role': 'teacher'},
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='created_exam_runs',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'db_table': 'exam_runs',
                'ordering': ['-start_at'],
                'verbose_name': 'Exam Run',
                'verbose_name_plural': 'Exam Runs',
            },
        ),
        migrations.AddField(
            model_name='examattempt',
            name='exam_run',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name='attempts',
                to='tests.examrun',
            ),
        ),
        migrations.AddField(
            model_name='examattempt',
            name='is_result_published',
            field=models.BooleanField(db_index=True, default=False),
        ),
        migrations.AddField(
            model_name='examattempt',
            name='total_score',
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True),
        ),
        migrations.AddField(
            model_name='examanswer',
            name='question_number',
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='examanswer',
            name='selected_option_key',
            field=models.CharField(blank=True, max_length=10, null=True),
        ),
        migrations.AddField(
            model_name='examanswer',
            name='score_awarded',
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True),
        ),
        migrations.AddField(
            model_name='examanswer',
            name='is_correct',
            field=models.BooleanField(blank=True, null=True),
        ),
        migrations.AlterField(
            model_name='examanswer',
            name='question',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name='exam_answers',
                to='tests.question',
            ),
        ),
        migrations.AddField(
            model_name='examattemptcanvas',
            name='situation_index',
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.AlterField(
            model_name='examattemptcanvas',
            name='question',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name='exam_attempt_canvases',
                to='tests.question',
            ),
        ),
        migrations.AlterUniqueTogether(
            name='examattemptcanvas',
            unique_together=set(),
        ),
    ]
