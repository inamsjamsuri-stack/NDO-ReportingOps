"""Report catalog."""

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException
from sqlalchemy import text
from sqlmodel import col, or_, select

from app.api.deps import CurrentUser, ManagerOrAdmin, SessionDep
from app.models import (
    AutomationStatus,
    Report,
    ReportCreate,
    ReportPublic,
    ReportUpdate,
    Request,
    RequestPublic,
    Role,
)
from app.services import events

router = APIRouter(prefix="/reports", tags=["reports"])

ENGINEER_FIELDS = {"automation_status", "manual_effort_hours", "automation_blocker", "automation_conditions"}


def _check_automation(r: Report) -> None:
    if r.automation_status != AutomationStatus.fully_automated and (
        r.manual_effort_hours is None or not r.automation_blocker or not r.automation_conditions
    ):
        raise HTTPException(
            status_code=422,
            detail="Hybrid and manual reports need manual effort, the blocker and the conditions to automate.",
        )


@router.get("/", response_model=list[ReportPublic])
def list_reports(session: SessionDep, _: CurrentUser, q: str | None = None,
                 customer_id: uuid.UUID | None = None, domain_id: uuid.UUID | None = None,
                 automation_status: AutomationStatus | None = None,
                 include_inactive: bool = False) -> Any:
    stmt = select(Report)
    if not include_inactive:
        stmt = stmt.where(Report.is_active)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(col(Report.name).ilike(like), col(Report.code).ilike(like)))
    if customer_id:
        stmt = stmt.where(Report.customer_id == customer_id)
    if domain_id:
        stmt = stmt.where(Report.domain_id == domain_id)
    if automation_status:
        stmt = stmt.where(Report.automation_status == automation_status)
    return session.exec(stmt.order_by(col(Report.name))).all()


@router.post("/", response_model=ReportPublic)
def create_report(session: SessionDep, user: ManagerOrAdmin, body: ReportCreate) -> Any:
    code = session.execute(
        text("SELECT 'RC-' || lpad(nextval('report_code_seq')::text, 4, '0')")
    ).scalar_one()
    r = Report(**body.model_dump(), code=code, created_by_id=user.id)
    _check_automation(r)
    session.add(r)
    events.audit(session, actor_id=user.id, action="report.created", entity="report",
                 new=body.model_dump(mode="json"))
    session.commit()
    session.refresh(r)
    return r


@router.get("/{report_id}", response_model=ReportPublic)
def read_report(session: SessionDep, _: CurrentUser, report_id: uuid.UUID) -> Any:
    r = session.get(Report, report_id)
    if not r:
        raise HTTPException(status_code=404, detail="Report not found")
    return r


@router.patch("/{report_id}", response_model=ReportPublic)
def update_report(session: SessionDep, user: CurrentUser, report_id: uuid.UUID, body: ReportUpdate) -> Any:
    r = session.get(Report, report_id)
    if not r:
        raise HTTPException(status_code=404, detail="Report not found")
    changes = body.model_dump(exclude_unset=True)
    if user.role not in (Role.manager, Role.admin):
        if not (user.role == Role.engineer and r.owner_id == user.id and set(changes) <= ENGINEER_FIELDS):
            raise HTTPException(status_code=403, detail="Engineers can update automation fields of reports they own.")
    old = {k: str(getattr(r, k)) for k in changes}
    for k, v in changes.items():
        setattr(r, k, v)
    _check_automation(r)
    r.updated_at = datetime.now(UTC)
    session.add(r)
    # Automation status history feeds Phase 3 analytics.
    events.audit(session, actor_id=user.id, action="report.updated", entity="report", entity_id=r.id,
                 old=old, new={k: str(v) for k, v in changes.items()})
    session.commit()
    session.refresh(r)
    return r


@router.get("/{report_id}/requests", response_model=list[RequestPublic])
def report_requests(session: SessionDep, user: CurrentUser, report_id: uuid.UUID) -> Any:
    from app.services.requests import visible

    stmt = visible(select(Request).where(Request.report_id == report_id), user)
    return session.exec(stmt.order_by(col(Request.submitted_at).desc())).all()
