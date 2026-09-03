"""Django settings — youty backend (dashboard salone + web app cliente)."""

import os
from pathlib import Path

import dj_database_url
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

SECRET_KEY = os.getenv("SECRET_KEY", "dev-insecure-change-me")
DEBUG = os.getenv("DEBUG", "1") == "1"
ALLOWED_HOSTS = [h.strip() for h in os.getenv("ALLOWED_HOSTS", "*").split(",") if h.strip()]
# L'healthcheck del container chiama http://127.0.0.1:8000/healthz
for _local in ("localhost", "127.0.0.1"):
    if _local not in ALLOWED_HOSTS and "*" not in ALLOWED_HOSTS:
        ALLOWED_HOSTS.append(_local)

INSTALLED_APPS = [
    # unfold: deve precedere django.contrib.admin per sovrascrivere i template
    "unfold",
    "unfold.contrib.filters",
    "unfold.contrib.forms",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    # domain apps
    "apps.core",
    "apps.accounts",
    "apps.clients",
    "apps.staff",
    "apps.catalog",
    "apps.agenda",
    "apps.sales",
    "apps.inventory",
    "apps.marketing",
    "apps.automations",
    "apps.insights",
    "apps.integrations",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    # whitenoise serve /static/ (admin Unfold) senza bisogno di un web server davanti
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

DATABASES = {
    "default": dj_database_url.config(
        default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}",
        conn_max_age=600,
    )
}

# Cache su database, non in memoria: con più worker gunicorn una LocMemCache
# darebbe a ciascuno il suo contatore, e i rate limit che ci si appoggiano non
# limiterebbero niente (verificato in produzione: 9 invii passati su un limite
# di 5). La tabella la crea l'entrypoint con `createcachetable`.
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.db.DatabaseCache",
        "LOCATION": "django_cache",
    }
}

# Logging esplicito: la configurazione di default di Django non fa arrivare a
# stdout gli INFO dei logger applicativi, e senza handler il fallback di Python
# mostra solo WARNING e oltre. Risultato: le nostre righe diagnostiche erano
# invisibili proprio quando servivano (una submission scartata dall'honeypot non
# lasciava traccia).
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"simple": {"format": "%(levelname)s %(name)s: %(message)s"}},
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "simple"},
    },
    "root": {"handlers": ["console"], "level": "WARNING"},
    "loggers": {
        "youty": {"handlers": ["console"], "level": "INFO", "propagate": False},
        "django.request": {"handlers": ["console"], "level": "WARNING", "propagate": False},
    },
}

AUTH_USER_MODEL = "accounts.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
]

LANGUAGE_CODE = "it"
TIME_ZONE = "Europe/Rome"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"

# In produzione /static/ passa da whitenoise (compressione + hash nei nomi file).
# Niente manifest storage: un riferimento mancante nei CSS di terze parti
# farebbe fallire l'intera pagina invece di degradare.
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedStaticFilesStorage"},
}

# I media sono upload degli utenti (logo salone, foto schede, immagini comunicazioni):
# whitenoise indicizza i file all'avvio e non li vedrebbe, quindi li serve Django.
# Metti a 0 se un giorno finiranno su S3 o dietro un nginx dedicato.
SERVE_MEDIA = os.getenv("SERVE_MEDIA", "1") == "1"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Dietro il reverse proxy di Coolify (Traefik): senza questo Django crede di
# essere in HTTP e il controllo CSRF dell'admin fallisce.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
USE_X_FORWARDED_HOST = True

# Origini fidate per il POST di login all'admin (schema incluso: https://api.esempio.it)
CSRF_TRUSTED_ORIGINS = [
    o.strip() for o in os.getenv("CSRF_TRUSTED_ORIGINS", "").split(",") if o.strip()
]

# CORS — in sviluppo tutto aperto, in produzione whitelist dei frontend
if DEBUG:
    CORS_ALLOW_ALL_ORIGINS = True
else:
    CORS_ALLOWED_ORIGINS = [
        o.strip() for o in os.getenv("CORS_ALLOWED_ORIGINS", "").split(",") if o.strip()
    ]
    # L'app cliente serve tutti i saloni da un solo origin (lo slug sta nel path,
    # es. https://beautyclients.esempio.it/the-parlour): basta elencarla sopra
    # insieme alla dashboard, niente pattern.
    #
    # Via di fuga se un giorno servisse un origin variabile. Separatore = spazio,
    # perché la virgola compare nei quantificatori regex ({1,3}). Occhio che i
    # pannelli web raddoppiano i backslash: `\\.` in regex significa "backslash
    # letterale" e il match fallisce in silenzio.
    CORS_ALLOWED_ORIGIN_REGEXES = os.getenv("CORS_ALLOWED_ORIGIN_REGEXES", "").split()

# JWT (staff dashboard + clienti web app)
JWT_SECRET = os.getenv("JWT_SECRET", SECRET_KEY)
JWT_ACCESS_TTL_MIN = int(os.getenv("JWT_ACCESS_TTL_MIN", "60"))
JWT_REFRESH_TTL_DAYS = int(os.getenv("JWT_REFRESH_TTL_DAYS", "30"))

# Stripe — opzionale: senza chiave gli endpoint pagamento rispondono 503
STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")

# Yourang (piattaforma esterna: WhatsApp + esecuzione automazioni).
# Gli eventi vengono accodati in core.OutboxEvent finché le API non sono disponibili.
YOURANG_API_URL = os.getenv("YOURANG_API_URL", "")
YOURANG_API_KEY = os.getenv("YOURANG_API_KEY", "")

# Yourang — tutto passa dal proxy (connect.<brand>, tools/internal/integration-proxy).
# Il portale non possiede credenziali Yourang: niente client_id/secret, niente
# token, niente cifratura a riposo. Il proxy è l'OAuth client, custodisce i token
# di ogni organizzazione e li rinnova sotto mutex.
YOURANG_PROXY_URL = os.getenv("YOURANG_PROXY_URL", "")  # es. https://connect.yourang.ai
YOURANG_PROXY_SLUG = os.getenv("YOURANG_PROXY_SLUG", "beauty")
# API key del portale verso il proxy (Authorization: Bearer). openssl rand -hex 32
YOURANG_PROXY_API_KEY = os.getenv("YOURANG_PROXY_API_KEY", "")
# Segreto con cui il proxy firma la SUA ri-emissione dei webhook verso di noi.
# Fail-closed: senza questo, POST /yourang/webhook rifiuta tutto.
YOURANG_PROXY_WEBHOOK_SECRET = os.getenv("YOURANG_PROXY_WEBHOOK_SECRET", "")
# Origine della dashboard (per redirect_uri del popup OAuth).
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")

# Policy prenotazioni lato cliente (ore minime prima dell'appuntamento)
CLIENT_MOVE_CANCEL_MIN_HOURS = int(os.getenv("CLIENT_MOVE_CANCEL_MIN_HOURS", "24"))
AGENDA_SLOT_STEP_MIN = 15

# ---------------------------------------------------------------------------
# django-unfold — tema dell'admin
# ---------------------------------------------------------------------------
from django.templatetags.static import static  # noqa: E402
from django.urls import reverse_lazy  # noqa: E402


def _changelist(name: str):
    return reverse_lazy(f"admin:{name}_changelist")


UNFOLD = {
    "SITE_TITLE": "youty admin",
    "SITE_HEADER": "youty",
    "SITE_SUBHEADER": "Gestionale salone",
    "SITE_SYMBOL": "spa",  # icona Material Symbols nell'header
    "SHOW_HISTORY": True,
    "SHOW_VIEW_ON_SITE": False,  # backend API-only: nessuna pagina pubblica per oggetto
    "COLORS": {
        "primary": {
            "50": "245 243 255",
            "100": "237 233 254",
            "200": "221 214 254",
            "300": "196 181 253",
            "400": "167 139 250",
            "500": "139 92 246",
            "600": "124 58 237",
            "700": "109 40 217",
            "800": "91 33 182",
            "900": "76 29 149",
            "950": "46 16 101",
        },
    },
    "SIDEBAR": {
        "show_search": True,
        "show_all_applications": True,  # dropdown di fallback con tutti i modelli
        "navigation": [
            {
                "title": "Salone",
                "separator": False,
                "items": [
                    {"title": "Saloni", "icon": "store", "link": _changelist("core_salon")},
                    {"title": "Sedi", "icon": "location_on", "link": _changelist("core_location")},
                    {"title": "Impostazioni", "icon": "settings", "link": _changelist("core_salonsettings")},
                    {"title": "Regole caparra", "icon": "euro", "link": _changelist("core_depositrule")},
                ],
            },
            {
                "title": "Clienti & Staff",
                "items": [
                    {"title": "Clienti", "icon": "group", "link": _changelist("clients_client")},
                    {"title": "Etichette clienti", "icon": "sell", "link": _changelist("clients_clientcategory")},
                    {"title": "Operatrici", "icon": "badge", "link": _changelist("staff_operator")},
                ],
            },
            {
                "title": "Catalogo & Agenda",
                "items": [
                    {"title": "Servizi", "icon": "content_cut", "link": _changelist("catalog_service")},
                    {"title": "Categorie servizi", "icon": "category", "link": _changelist("catalog_servicecategory")},
                    {"title": "Pacchetti", "icon": "package_2", "link": _changelist("catalog_package")},
                    {"title": "Appuntamenti", "icon": "calendar_month", "link": _changelist("agenda_appointment")},
                    {"title": "Lista d'attesa", "icon": "hourglass_top", "link": _changelist("agenda_waitlistentry")},
                ],
            },
            {
                "title": "Vendite & Magazzino",
                "items": [
                    {"title": "Vendite", "icon": "point_of_sale", "link": _changelist("sales_sale")},
                    {"title": "Prodotti", "icon": "inventory_2", "link": _changelist("inventory_product")},
                    {"title": "Fornitori", "icon": "local_shipping", "link": _changelist("inventory_supplier")},
                    {"title": "Ordini fornitore", "icon": "receipt_long", "link": _changelist("inventory_purchaseorder")},
                    {"title": "Movimenti stock", "icon": "swap_vert", "link": _changelist("inventory_stockmovement")},
                ],
            },
            {
                "title": "Marketing & Automazioni",
                "items": [
                    {"title": "Coupon", "icon": "confirmation_number", "link": _changelist("marketing_coupon")},
                    {"title": "Gift card", "icon": "card_giftcard", "link": _changelist("marketing_giftcard")},
                    {"title": "Fedeltà", "icon": "loyalty", "link": _changelist("marketing_loyaltyprogram")},
                    {"title": "Comunicazioni", "icon": "campaign", "link": _changelist("marketing_communication")},
                    {"title": "Automazioni", "icon": "bolt", "link": _changelist("automations_automation")},
                ],
            },
            {
                "title": "Sistema",
                "items": [
                    {"title": "Utenti", "icon": "manage_accounts", "link": _changelist("accounts_user")},
                    {"title": "Ruoli", "icon": "shield_person", "link": _changelist("accounts_role")},
                    {"title": "Membership", "icon": "diversity_3", "link": _changelist("accounts_membership")},
                    {"title": "Inviti", "icon": "mail", "link": _changelist("accounts_invitation")},
                    {"title": "Outbox Yourang", "icon": "outbox", "link": _changelist("core_outboxevent")},
                    {"title": "Registro attività", "icon": "history", "link": _changelist("core_activitylog")},
                ],
            },
        ],
    },
}
