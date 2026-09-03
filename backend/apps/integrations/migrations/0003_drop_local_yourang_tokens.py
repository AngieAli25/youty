# Passaggio al proxy Yourang (connect.<brand>): il portale non custodisce più
# token. Spariscono le colonne cifrate della connessione e l'intera tabella di
# stato PKCE — PKCE e state vivono nel proxy.
#
# NB: questa è una migrazione DISTRUTTIVA di dati (i token cifrati non sono
# recuperabili). È voluto: quei token sono comunque inutilizzabili dopo il
# cutover, perché il portale non ha più il client_secret per rinnovarli. Ogni
# salone si ricollega con un click sulla pagina di consenso già concessa.

from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("integrations", "0002_alter_yourangoauthstate_salon_and_more"),
    ]

    operations = [
        migrations.RemoveField(model_name="yourangconnection", name="access_token_enc"),
        migrations.RemoveField(model_name="yourangconnection", name="refresh_token_enc"),
        migrations.RemoveField(model_name="yourangconnection", name="expires_at"),
        migrations.RemoveField(model_name="yourangconnection", name="scope"),
        migrations.RemoveField(model_name="yourangconnection", name="webhook_secret_enc"),
        migrations.DeleteModel(name="YourangOAuthState"),
    ]
