"""Dashboard numbers and the simple workload list.

Every number is one query on `request` (plus `request_sla` for time
measures), following the formulas in PRD v1.1, so figures always match the
database.
"""

import uuid
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import func as sa_func
from sqlmodel import SQLModel, col, func, select

from app.api.deps import CurrentUser, ManagerOrAdmin, SessionDep
from app.models import (
    CLOSED_STATUSES,
    IN_PROGRESS_STATUSES,
    OPEN_STATUSES,
    Assignment,
    CountItem,
    DashboardOut,
    Domain,
    Request,
    RequestSla,
    Role,
    Status,
    TimeLog,
    User,
)
from app.services import sla
from app.services.requests import visible

from fastapi import APIRouter

router = APIRouter(tags=["dashboard"])


def _range(session: Any, date_from: date | None, date_to: date | None) -> tuple[datetime, datetime]:
    tz = sla.load_calendar(session).tz
    today = datetime.now(UTC).astimezone(tz).date()
    start = date_from or today.replace(day=1)
    end = (date_to or today) + timedelta(days=1)
    return datetime.combine(start, time(), tzinfo=tz), datetime.combine(end, time(), tzinfo=tz)


@router.get("/dashboard", response_model=DashboardOut)
def dashboard(
    session: SessionDep,
    current_user: CurrentUser,
    date_from: date | None = None,
    date_to: date | None = None,
    customer_id: uuid.UUID | None = None,
    domain_id: uuid.UUID | None = None,
    category: str | None = None,
    priority: str | None = None,
) -> Any:
    start, end = _range(session, date_from, date_to)
    tz = sla.load_calendar(session).tz
    today = datetime.now(UTC).astimezone(tz).date()

    def base(stmt: Any) -> Any:
        stmt = visible(stmt, current_user)
        if customer_id:
            stmt = stmt.where(Request.customer_id == customer_id)
        if domain_id:
            stmt = stmt.where(Request.domain_id == domain_id)
        if category:
            stmt = stmt.where(Request.category == category)
        if priority:
            stmt = stmt.where(Request.priority == priority)
        return stmt

    def count(*conds: Any) -> int:
        return int(session.exec(base(select(func.count()).select_from(Request)).where(*conds)).one())

    incoming = (col(Request.submitted_at) >= start, col(Request.submitted_at) < end)
    completed_in = (col(Request.completed_at) >= start, col(Request.completed_at) < end)

    times = session.exec(
        base(select(
            func.avg(RequestSla.resolution_min),
            sa_func.percentile_cont(0.5).within_group(col(RequestSla.resolution_min)),
            func.count(),
            func.count().filter(RequestSla.is_breached == False),  # noqa: E712
        ).select_from(Request).join(RequestSla, col(RequestSla.request_id) == Request.id))
        .where(*completed_in, col(RequestSla.resolution_min).is_not(None))
    ).one()
    avg_min, median_min, n_done, n_ok = times

    by_domain = session.exec(
        base(select(Domain.name, func.count()).select_from(Request)
             .join(Domain, col(Domain.id) == Request.domain_id))
        .where(*incoming).group_by(col(Domain.name)).order_by(func.count().desc())
    ).all()
    by_category = session.exec(
        base(select(Request.category, func.count()).select_from(Request))
        .where(*incoming).group_by(col(Request.category))
    ).all()

    return DashboardOut(
        total_incoming=count(*incoming),
        open=count(col(Request.status).in_(OPEN_STATUSES)),
        in_progress=count(col(Request.status).in_(IN_PROGRESS_STATUSES)),
        on_hold=count(Request.status == Status.on_hold),
        completed=count(*completed_in),
        overdue=count(col(Request.status).not_in(CLOSED_STATUSES), col(Request.committed_date) < today),
        avg_resolution_hours=round(float(avg_min) / 60, 1) if avg_min is not None else None,
        median_resolution_hours=round(float(median_min) / 60, 1) if median_min is not None else None,
        sla_compliance_pct=round(100.0 * n_ok / n_done, 1) if n_done else None,
        by_domain=[CountItem(name=n, count=c) for n, c in by_domain],
        by_category=[CountItem(name=str(getattr(n, "value", n)), count=c) for n, c in by_category],
    )


class WorkloadRow(SQLModel):
    engineer_id: uuid.UUID
    full_name: str | None
    active_requests: int
    remaining_estimated_hours: Decimal
    overdue_requests: int


@router.get("/workload", response_model=list[WorkloadRow])
def workload(session: SessionDep, _: ManagerOrAdmin) -> Any:
    """Simple workload list per engineer (the full dashboard is Phase 2)."""
    tz = sla.load_calendar(session).tz
    today = datetime.now(UTC).astimezone(tz).date()
    engineers = session.exec(select(User).where(col(User.role).in_([Role.engineer, Role.manager]),
                                                User.is_active)).all()
    rows: list[WorkloadRow] = []
    for e in engineers:
        assigns = session.exec(
            select(Assignment, Request).join(Request, col(Request.id) == Assignment.request_id)
            .where(Assignment.engineer_id == e.id, Assignment.is_active,
                   col(Request.status).not_in(CLOSED_STATUSES))
        ).all()
        if not assigns and e.role == Role.manager:
            continue
        ids = [a.id for a, _ in assigns]
        logged = dict(session.exec(
            select(TimeLog.assignment_id, func.sum(TimeLog.hours))
            .where(col(TimeLog.assignment_id).in_(ids)).group_by(col(TimeLog.assignment_id))
        ).all()) if ids else {}
        remaining = sum((max(a.estimated_hours - Decimal(logged.get(a.id) or 0), Decimal(0))
                         for a, _ in assigns), Decimal(0))
        rows.append(WorkloadRow(
            engineer_id=e.id, full_name=e.full_name, active_requests=len(assigns),
            remaining_estimated_hours=remaining,
            overdue_requests=sum(1 for _, r in assigns if r.committed_date and r.committed_date < today),
        ))
    return sorted(rows, key=lambda r: r.remaining_estimated_hours, reverse=True)
