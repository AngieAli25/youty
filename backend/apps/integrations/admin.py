from django.contrib import admin
from unfold.admin import ModelAdmin

from .models import YourangConnection


@admin.register(YourangConnection)
class YourangConnectionAdmin(ModelAdmin):
    list_display = ("salon", "status", "yourang_org_id", "last_sync_at", "connected_at")
    list_filter = ("status",)
    search_fields = ("salon__name", "yourang_org_id")
    readonly_fields = ("connected_at", "updated_at")
