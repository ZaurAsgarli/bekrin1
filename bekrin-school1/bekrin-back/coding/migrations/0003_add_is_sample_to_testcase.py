# Generated migration for is_sample on CodingTestCase

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('coding', '0002_add_coding_indexes_and_score'),
    ]

    operations = [
        migrations.AddField(
            model_name='codingtestcase',
            name='is_sample',
            field=models.BooleanField(default=True, help_text='Used for Run (student preview); all cases used for Submit'),
        ),
    ]
