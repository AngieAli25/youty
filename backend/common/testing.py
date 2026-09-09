"""Existing domain test fixtures exercise behavior with an entitled salon.

Subscription enforcement tests use Django TestCase directly and mock only the
remote entitlement response, so the actual auth, resolver, and guards execute.
"""
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone
from datetime import timedelta


class SubscribedSalonTestCase(TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        def entitled(salon):
            now = timezone.now()
            return {
                "organization_id": str(salon.pk), "portal_type": "beauty",
                "module_type": "portal_beauty", "variant": "base",
                "operational_access": True, "status": "active", "expires_at": None,
                "checked_at": now.isoformat(), "valid_until": (now + timedelta(seconds=60)).isoformat(),
                "purchase_url": "",
            }
        stub = patch("common.portal_access.resolve_portal_access", side_effect=entitled)
        stub.start()
        cls.addClassCleanup(stub.stop)
