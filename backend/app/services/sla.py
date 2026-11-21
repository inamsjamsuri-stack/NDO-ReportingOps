"""SLA: policy matching and per-request clock calculation.

All clock values are rebuilt from status_history, so they can be recalculated
at any time (for example after a holiday is added).
"""

import uuid
from datetime import UTC, date, datetime

from sqlmodel import Session, col, select

from app.core.work_calendar import WorkCalendar

__all__ = ["WorkCalendar", "load_calendar", "match_policy", "recalculate", "default_committed_date"]
from app.models import (
    AppSetting,
    Holiday,
    Request,
    RequestSla,
    SlaCalendar,
    SlaPolicy,
    Status,
    StatusHistory,
)

AT_RISK_SHARE = 0.75

DEFAULT_CALENDAR_SETTINGS: dict[str, object] = {
    "timezone": "Asia/Jakarta",
    "work_days": [0, 1, 2, 3, 4],
    "work_start": "08:30",
    "work_end": "18:00",
    "break_start": "12:30",
    "break_end": "14:00",
}

CALENDAR_KEYS = tuple(DEFAULT_CALENDAR_SETTINGS)


def load_calendar(session: Session) -> WorkCalendar:
    rows = session.exec(select(AppSetting).where(col(AppSetting.key).in_(CALENDAR_KEYS))).all()
    settings = dict(DEFAULT_CALENDAR_SETTINGS)
    settings.update({r.key: r.value for r in rows})
    holidays: list[date] = list(session.exec(select(Holiday.day)).all())
    return WorkCalendar.from_settings(settings, holidays)


def match_policy(session: Session, req: Request) -> SlaPolicy | None:
    """Most specific active policy for the request's priority wins."""
    candidates = session.exec(
        select(SlaPolicy).where(SlaPolicy.is_active, SlaPolicy.priority == req.priority)
    ).all()
    best: SlaPolicy | None = None
    best_score = -1
    for p in candidates:
        if p.category is not None and p.category != req.category:
            continue
        if p.request_type_id is not None and p.request_type_id != req.request_type_id:
            continue
        score = sum(x is not None for x in (p.category, p.request_type_id))
        if score > best_score:
            best, best_score = p, score
    return best


def _history(session: Session, request_id: uuid.UUID) -> list[StatusHistory]:
    return list(
        session.exec(
            select(StatusHistory)
            .where(StatusHistory.request_id == request_id)
            .order_by(col(StatusHistory.changed_at))
        ).all()
    )


def recalculate(session: Session, req: Request, now: datetime | None = None) -> RequestSla:
    """Rebuild the request's SLA row from its status history. Does not commit."""
    now = now or datetime.now(UTC)
    sla = session.get(RequestSla, req.id) or RequestSla(request_id=req.id)
    policy = match_policy(session, req)
    sla.sla_policy_id = policy.id if policy else None
    base_cal = load_calendar(session)
    cal = base_cal.with_always_on() if policy and policy.calendar == SlaCalendar.always else base_cal
    hist = _history(session, req.id)

    # Response: from submitted_at to the first manager move out of "submitted".
    responded = next(
        (h.changed_at for h in hist if h.from_status == Status.submitted and h.action != "cancel"),
        None,
    )
    sla.responded_at = responded
    sla.response_due_at = cal.add_minutes(req.submitted_at, policy.response_target_min) if policy else None

    # Walk the history to find approval, hold periods and waiting-for-requester periods.
    approved_at: datetime | None = None
    first_completed: datetime | None = None
    paused = 0
    waiting = 0
    hold_start: datetime | None = None
    wait_start: datetime | None = None
    for h in hist:
        if h.to_status == Status.approved and approved_at is None:
            approved_at = h.changed_at
        if h.to_status == Status.completed and first_completed is None:
            first_completed = h.changed_at
        if h.to_status == Status.on_hold:
            hold_start = h.changed_at
        elif h.from_status == Status.on_hold and hold_start is not None:
            paused += cal.minutes_between(hold_start, h.changed_at)
            hold_start = None
        if h.action == "need_more_info":
            wait_start = h.changed_at
        elif h.from_status == Status.submitted and wait_start is not None:
            waiting += cal.minutes_between(wait_start, h.changed_at)
            wait_start = None
    if hold_start is not None:  # still on hold
        paused += cal.minutes_between(hold_start, now)
    sla.paused_min = paused
    sla.waiting_requester_min = waiting
    sla.resolved_at = first_completed

    sla.resolution_due_at = None
    sla.resolution_min = None
    sla.is_at_risk = False
    sla.is_breached = False
    if policy and approved_at is not None:
        target = policy.resolution_target_min
        sla.resolution_due_at = cal.add_minutes(approved_at, target + paused)
        end = first_completed or now
        used = max(cal.minutes_between(approved_at, end) - paused, 0)
        if first_completed:
            sla.resolution_min = used
        sla.is_breached = used > target
        sla.is_at_risk = (
            not sla.is_breached
            and first_completed is None
            and req.status not in (Status.under_review,)
            and used >= AT_RISK_SHARE * target
        )
    session.add(sla)
    return sla


def default_committed_date(session: Session, req: Request, approved_at: datetime) -> date | None:
    policy = match_policy(session, req)
    if not policy:
        return None
    cal = load_calendar(session)
    due = cal.add_minutes(approved_at, policy.resolution_target_min)
    return due.astimezone(cal.tz).date()
