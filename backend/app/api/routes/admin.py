"""Admin: SLA policies, holiday calendar, working-hours settings, workflow
switches, audit log and SLA recalculation."""

import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from sqlmodel import SQLModel, col, select

from app.api.deps import AdminUser, CurrentUser, ManagerOrAdmin, SessionDep
from app.models import (
    CLOSED_STATUSES,
    AppSetting,
    AuditLog,
    Holiday,
    HolidayCreate,
    Message,
    Request,
    SlaPolicy,
    SlaPolicyCreate,
    WorkflowTransition,
)
from app.services import events, sla

router = APIRouter(prefix="/admin", tags=["admin"])


# -- SLA policies ------------------------------------------------------------


@router.get("/sla-policies", response_model=list[SlaPolicy])
def list_policies(session: SessionDep, _: CurrentUser) -> Any:
    return session.exec(select(SlaPolicy).order_by(col(SlaPolicy.priority), col(SlaPolicy.name))).all()


@router.post("/sla-policies", response_model=SlaPolicy)
def create_policy(session: SessionDep, admin: AdminUser, body: SlaPolicyCreate) -> Any:
    p = SlaPolicy(**body.model_dump())
    session.add(p)
    events.audit(session, actor_id=admin.id, action="sla_policy.created", entity="sla_policy",
                 entity_id=p.id, new=body.model_dump(mode="json"))
    session.commit()
    session.refresh(p)
    return p


@router.put("/sla-policies/{policy_id}", response_model=SlaPolicy)
def update_policy(session: SessionDep, admin: AdminUser, policy_id: uuid.UUID, body: SlaPolicyCreate) -> Any:
    p = session.get(SlaPolicy, policy_id)
    if not p:
        raise HTTPException(status_code=404, detail="Policy not found")
    old = p.model_dump(mode="json")
    for k, v in body.model_dump().items():
        setattr(p, k, v)
    session.add(p)
    events.audit(session, actor_id=admin.id, action="sla_policy.updated", entity="sla_policy",
                 entity_id=p.id, old=old, new=body.model_dump(mode="json"))
    session.commit()
    session.refresh(p)
    return p


# -- Holidays and working hours ---------------------------------------------------


@router.get("/holidays", response_model=list[Holiday])
def list_holidays(session: SessionDep, _: CurrentUser, year: int | None = None) -> Any:
    rows = session.exec(select(Holiday).order_by(col(Holiday.day))).all()
    return [h for h in rows if year is None or h.day.year == year]


@router.post("/holidays", response_model=Holiday)
def add_holiday(session: SessionDep, admin: AdminUser, body: HolidayCreate) -> Any:
    if session.exec(select(Holiday).where(Holiday.day == body.day)).first():
        raise HTTPException(status_code=409, detail="This date is already in the list.")
    h = Holiday(**body.model_dump())
    session.add(h)
    events.audit(session, actor_id=admin.id, action="holiday.added", entity="holiday",
                 entity_id=h.id, new=body.model_dump(mode="json"))
    session.commit()
    session.refresh(h)
    return h


@router.delete("/holidays/{holiday_id}", response_model=Message)
def remove_holiday(session: SessionDep, admin: AdminUser, holiday_id: uuid.UUID) -> Any:
    h = session.get(Holiday, holiday_id)
    if not h:
        raise HTTPException(status_code=404, detail="Holiday not found")
    events.audit(session, actor_id=admin.id, action="holiday.removed", entity="holiday",
                 entity_id=h.id, old=h.model_dump(mode="json"))
    session.delete(h)
    session.commit()
    return Message(message="Holiday removed")


class CalendarSettings(SQLModel):
    timezone: str = "Asia/Jakarta"
    work_days: list[int] = [0, 1, 2, 3, 4]
    work_start: str = "08:30"
    work_end: str = "18:00"
    break_start: str | None = "12:30"
    break_end: str | None = "14:00"


@router.get("/calendar", response_model=CalendarSettings)
def read_calendar(session: SessionDep, _: CurrentUser) -> Any:
    rows = session.exec(select(AppSetting).where(col(AppSetting.key).in_(sla.CALENDAR_KEYS))).all()
    data = dict(sla.DEFAULT_CALENDAR_SETTINGS)
    data.update({r.key: r.value for r in rows})
    return CalendarSettings(**data)


@router.put("/calendar", response_model=CalendarSettings)
def update_calendar(session: SessionDep, admin: AdminUser, body: CalendarSettings) -> Any:
    for k, v in body.model_dump().items():
        row = session.get(AppSetting, k) or AppSetting(key=k, value=v)
        row.value = v
        session.add(row)
    events.audit(session, actor_id=admin.id, action="calendar.updated", entity="app_setting",
                 new=body.model_dump())
    session.commit()
    return body


@router.post("/recalculate-sla", response_model=Message)
def recalculate_sla(session: SessionDep, admin: AdminUser) -> Any:
    """Rebuild SLA clocks of all open requests (after calendar or policy changes)."""
    reqs = session.exec(select(Request).where(col(Request.status).not_in(CLOSED_STATUSES))).all()
    for r in reqs:
        sla.recalculate(session, r)
    events.audit(session, actor_id=admin.id, action="sla.recalculated", new={"requests": len(reqs)})
    session.commit()
    return Message(message=f"Recalculated {len(reqs)} open requests")


# -- Workflow switches -----------------------------------------------------------


@router.get("/workflow", response_model=list[WorkflowTransition])
def list_transitions(session: SessionDep, _: ManagerOrAdmin) -> Any:
    return session.exec(select(WorkflowTransition).order_by(col(WorkflowTransition.action))).all()


class TransitionSwitch(SQLModel):
    is_active: bool


@router.patch("/workflow/{transition_id}", response_model=WorkflowTransition)
def switch_transition(session: SessionDep, admin: AdminUser, transition_id: uuid.UUID,
                      body: TransitionSwitch) -> Any:
    t = session.get(WorkflowTransition, transition_id)
    if not t:
        raise HTTPException(status_code=404, detail="Transition not found")
    t.is_active = body.is_active
    session.add(t)
    events.audit(session, actor_id=admin.id, action="workflow.switched", entity="workflow_transition",
                 entity_id=t.id, new={"is_active": body.is_active})
    session.commit()
    session.refresh(t)
    return t


# -- Audit log (read only) -------------------------------------------------------


@router.get("/audit-log", response_model=list[AuditLog])
def read_audit_log(session: SessionDep, _: AdminUser, entity: str | None = None,
                   action: str | None = None, skip: int = 0, limit: int = 100) -> Any:
    stmt = select(AuditLog)
    if entity:
        stmt = stmt.where(AuditLog.entity == entity)
    if action:
        stmt = stmt.where(col(AuditLog.action).startswith(action))
    return session.exec(stmt.order_by(col(AuditLog.id).desc()).offset(skip).limit(min(limit, 500))).all()
