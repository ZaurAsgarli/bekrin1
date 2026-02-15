# Migration: Add organization to TeacherPDF for org scoping

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0001_initial'),
        ('tests', '0005_add_manual_score_to_answer'),
    ]

    operations = [
        migrations.AddField(
            model_name='teacherpdf',
            name='organization',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='teacher_pdfs',
                to='core.organization',
                db_column='organization_id',
            ),
        ),
    ]
