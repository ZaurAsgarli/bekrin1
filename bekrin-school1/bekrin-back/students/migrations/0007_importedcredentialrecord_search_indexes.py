# Add indexes on searchable fields for credentials list (search by name/email)
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("students", "0006_rename_balance_led_student_date_idx_balance_led_student_4cef6f_idx_and_more"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="importedcredentialrecord",
            index=models.Index(fields=["student_full_name"], name="imported_cr_fullna_idx"),
        ),
        migrations.AddIndex(
            model_name="importedcredentialrecord",
            index=models.Index(fields=["student_email"], name="imported_cr_stuemail_idx"),
        ),
        migrations.AddIndex(
            model_name="importedcredentialrecord",
            index=models.Index(fields=["parent_email"], name="imported_cr_paremail_idx"),
        ),
    ]
