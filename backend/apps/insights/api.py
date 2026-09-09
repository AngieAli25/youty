"""Endpoint KPI e analisi — riservati al titolare (require_owner ovunque)."""

from django.utils.dateparse import parse_date
from ninja import Router
from ninja.errors import HttpError

from common.portal_access import business_operation
from common.auth import staff_auth
from common.permissions import require_owner

from .schemas import AskIn, CategoryRevenueOut, KpisOut, RevenuePointOut, WeekdayOccupancyOut
from .services import kpis, occupancy_by_weekday, revenue_by_category, revenue_series

router = Router(tags=["insights"])


def _parse_date(raw: str | None):
    if not raw:
        return None
    parsed = parse_date(raw)
    if parsed is None:
        raise HttpError(400, "Data non valida: usa il formato YYYY-MM-DD")
    return parsed


@router.get("/kpis", auth=staff_auth, response=KpisOut)
def get_kpis(request, period: str = "month", date: str | None = None, date_from: str | None = None, date_to: str | None = None):
    ctx = request.auth
    require_owner(ctx)
    return kpis(ctx.salon, period, _parse_date(date), _parse_date(date_from), _parse_date(date_to))


@router.get("/revenue-series", auth=staff_auth, response=list[RevenuePointOut])
def get_revenue_series(
    request, period: str = "month", granularity: str = "day", date: str | None = None,
    date_from: str | None = None, date_to: str | None = None,
):
    ctx = request.auth
    require_owner(ctx)
    return revenue_series(ctx.salon, period, granularity, _parse_date(date), _parse_date(date_from), _parse_date(date_to))


@router.get("/revenue-by-category", auth=staff_auth, response=list[CategoryRevenueOut])
def get_revenue_by_category(request, period: str = "month", date: str | None = None, date_from: str | None = None, date_to: str | None = None):
    ctx = request.auth
    require_owner(ctx)
    return revenue_by_category(ctx.salon, period, _parse_date(date), _parse_date(date_from), _parse_date(date_to))


@router.get("/occupancy-by-weekday", auth=staff_auth, response=list[WeekdayOccupancyOut])
def get_occupancy_by_weekday(request, period: str = "month", date: str | None = None, date_from: str | None = None, date_to: str | None = None):
    ctx = request.auth
    require_owner(ctx)
    return occupancy_by_weekday(ctx.salon, period, _parse_date(date), _parse_date(date_from), _parse_date(date_to))


@router.post("/ask", auth=staff_auth)
@business_operation
def ask_youty(request, data: AskIn):
    require_owner(request.auth)
    raise HttpError(501, "Chiedi a Youty sarà disponibile nella fase 2")
