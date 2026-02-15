# Generated migration for Payment.organization index (improves teacher payments list filter)

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('payments', '0001_initial'),
    ]

    operations = [
        migrations.AddIndex(
            model_name='payment',
            index=models.Index(fields=['organization'], name='payments_org_idx'),
        ),
    ]
