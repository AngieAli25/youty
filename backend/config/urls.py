import re

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.http import JsonResponse
from django.urls import path, re_path
from django.views.static import serve as media_serve

from config.api import api


def healthz(_request):
    """Healthcheck del container (Docker/Coolify): nessuna query al DB, deve restare leggero."""
    return JsonResponse({"status": "ok"})


urlpatterns = [
    path("healthz", healthz),
    path("admin/", admin.site.urls),
    path("api/", api.urls),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
elif settings.SERVE_MEDIA:
    # `static()` è un no-op con DEBUG=False: senza questa rotta gli upload
    # (logo salone, foto schede tecniche, immagini comunicazioni) darebbero 404.
    urlpatterns += [
        re_path(
            r"^%s(?P<path>.*)$" % re.escape(settings.MEDIA_URL.lstrip("/")),
            media_serve,
            {"document_root": settings.MEDIA_ROOT},
        )
    ]
