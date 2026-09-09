"""Servizi dell'app clients.

`client_facts` è il dizionario standard usato da `common.conditions.evaluate`
per le regole E/O (deposito in core.DepositRule, filtri delle automazioni).
sales/agenda potrebbero non essere ancora pronte: ogni lettura cross-app è
importata pigramente e degrada a 0/[] senza sollevare eccezioni.
"""

from common.portal_access import require_portal_access

from decimal import Decimal

from .models import Client


def client_stats(client: Client) -> dict:
    """Aggregati derivati dalle vendite (visite, spesa totale, ultima visita).

    Import lazy di `apps.sales`: se l'app non è ancora installata/pronta
    ritorna semplicemente gli zeri di default.
    """
    stats = {"visits": 0, "total_spent": Decimal("0"), "last_visit": None}
    try:
        from apps.sales.models import Sale  # lazy: evita cicli e app non ancora pronte
    except ImportError:
        return stats

    from django.db.models import Count, Max, Sum

    agg = Sale.objects.filter(client=client).aggregate(
        visits=Count("id"), total=Sum("total"), last=Max("created_at")
    )
    stats["visits"] = agg["visits"] or 0
    stats["total_spent"] = agg["total"] or Decimal("0")
    stats["last_visit"] = agg["last"]
    return stats


def client_facts(client: Client) -> dict:
    """Facts standard per `common.conditions.evaluate` (regole deposito, automazioni).

    Campi mancanti (app sales/agenda non pronte, nessun dato) → 0/[].
    """
    stats = client_stats(client)
    facts = {
        "reliability": client.reliability,
        "categories": list(
            client.categories.order_by("order", "id").values_list("name", flat=True)
        ),
        "total_spent": stats["total_spent"],
        "visits": stats["visits"],
        "noshow_count": 0,
        "latecancel_count": 0,
        "deposit_always": client.deposit_always,
    }

    try:
        from apps.agenda.models import Appointment  # lazy: evita cicli e app non ancora pronte
    except ImportError:
        return facts

    facts["noshow_count"] = Appointment.objects.filter(
        client=client, status="no_show"
    ).count()
    facts["latecancel_count"] = Appointment.objects.filter(
        client=client, cancelled_late=True
    ).count()
    return facts


def import_rows(salon, rows: list[dict]) -> dict:
    """Upsert massivo per import CSV (righe già parsate lato client in JSON).

    Match per telefono, poi per email. Una riga senza telefono che non trova
    corrispondenza per email viene ignorata (il telefono è obbligatorio per
    creare un nuovo cliente).
    """
    require_portal_access(salon)
    created = 0
    updated = 0
    for row in rows:
        phone = (row.get("phone") or "").strip()
        email = (row.get("email") or "").strip()
        first_name = (row.get("first_name") or "").strip()
        last_name = (row.get("last_name") or "").strip()

        client = None
        if phone:
            client = Client.objects.filter(salon=salon, phone=phone).first()
        if client is None and email:
            client = Client.objects.filter(salon=salon, email=email).first()

        if client is not None:
            if first_name:
                client.first_name = first_name
            if last_name:
                client.last_name = last_name
            if email:
                client.email = email
            if phone:
                client.phone = phone
            client.save()
            updated += 1
        elif phone:
            Client.objects.create(
                salon=salon,
                first_name=first_name,
                last_name=last_name,
                email=email,
                phone=phone,
            )
            created += 1
        # riga senza telefono e senza corrispondenza per email → ignorata

    return {"created": created, "updated": updated}
