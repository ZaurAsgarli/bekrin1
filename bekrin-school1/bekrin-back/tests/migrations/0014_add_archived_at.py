# Add archived_at for soft delete timestamps

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('tests', '0013_multi_source_exam'),
    ]

    operations = [
        migrations.AddField(
            model_name='exam',
            name='archived_at',
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
        migrations.AddField(
            model_name='question',
            name='archived_at',
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
        migrations.AddField(
            model_name='teacherpdf',
            name='archived_at',
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
    ]
