from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0003_salonsettings_opening_hours"),
    ]

    operations = [
        migrations.AddField(
            model_name="salonsettings",
            name="privacy_policy_url",
            field=models.URLField(blank=True, default=""),
        ),
    ]
