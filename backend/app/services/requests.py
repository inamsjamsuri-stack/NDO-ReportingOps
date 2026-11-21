"""Request business logic: IDs, visibility, edits and workflow moves."""

import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import or_, text
from sqlmodel import Session, col, func, select
from sqlmodel.sql.expression import SelectOfScalar

from app.core.workflow_rules import (
    SEED_TRANSITIONS,
    GuardContext,
    TransitionError,
    TransitionRule,
    check,
    pick_rule,
)
from app.models import (
    MANAGER_ONLY_FIELDS,
    Assignment,
    AssignmentRole,
    Attachment,
    Request,
    RequestCreate,
    RequestUpdate,
    Role,
    Status,
    StatusHistory,
    TimeLog,
    User,
    WorkflowTransition,
)
from app.services import events, sla

# Human-friendly words for notifications.
STATUS_WORDS = {s: s.value.replace("_", " ") for s in Status}


# ---------------------------------------------------------------------------
# IDs
# ---------------------------------------------------------------------------


def next_code(session: Session, year: int) -> str:
    """RPT-YYYY-NNNNN from a per-year counter row, safe under concurrency."""
    session.execute(
        text(
            "INSERT INTO request_sequence (year, last_number) VALUES (:y, 0) "
            "ON CONFLICT (year) DO NOTHING"
        ),
        {"y": year},
    )
    n = session.execute(
        text(
            "UPDATE request_sequence SET last_number = last_number + 1 "
            "WHERE year = :y RETURNING last_number"
        ),
        {"y": year},
    ).scalar_one()
    return f"RPT-{year}-{n:05d}"


# ---------------------------------------------------------------------------
# Visibility
# ---------------------------------------------------------------------------


def visible(stmt: SelectOfScalar[Any], user: User) -> SelectOfScalar[Any]:
    """Apply the role visibility rule to a select on Request."""
    if user.role in (Role.admin, Role.manager):
        return stmt
    if user.role == Role.engineer:
        assigned = select(Assignment.request_id).where(
            Assignment.engineer_id == user.id, Assignment.is_active
        )
        return stmt.where(col(Request.id).in_(assigned))
    # requester: own requests plus others from the same customer/department
    conds = [Request.requester_id == user.id]
    if user.customer_id:
        conds.append(Request.customer_id == user.customer_id)
    return stmt.where(or_(*conds))


def can_see(session: Session, req: Request, user: User) -> bool:
    stmt = visible(select(Request.id).where(Request.id == req.id), user)
    return session.exec(stmt).first() is not None


def can_see_internal(user: User) -> bool:
    return user.role in (Role.admin, Role.manager, Role.engineer)


# ---------------------------------------------------------------------------
# Create and edit
# ---------------------------------------------------------------------------


def create(session: Session, data: RequestCreate, user: User) -> Request:
    requester_id = user.id
    if data.requester_id and data.requester_id != user.id:
        if user.role != Role.manager:
            raise TransitionError("Only a manager can submit on behalf of someone.", 403)
        requester_id = data.requester_id
    if data.report_id is None and not (data.report_name or "").strip():
        raise TransitionError("Pick a report from the catalog or type a new report name.", 422)
    if data.required_date < datetime.now(UTC).date():
        raise TransitionError("Required date must be today or later.", 422)
    now = datetime.now(UTC)
    req = Request(
        **data.model_dump(exclude={"requester_id"}),
        code=next_code(session, now.year),
        requester_id=requester_id,
        submitted_by_id=user.id,
        status=Status.submitted,
        submitted_at=now,
    )
    session.add(req)
    session.flush()
    session.add(
        StatusHistory(
            request_id=req.id, from_status=None, to_status=Status.submitted,
            action="submit", changed_by_id=user.id, changed_at=now,
        )
    )
    events.activity(session, request_id=req.id, actor_id=user.id, kind="status_changed",
                    data={"to": "submitted"})
    events.notify(session, user_ids=events.manager_ids(session), event="request_submitted",
                  title=f"New request {req.code}: {req.title}", request_id=req.id, skip_user=user.id)
    events.webhook(session, "request.created", {"id": str(req.id), "code": req.code})
    session.flush()
    sla.recalculate(session, req, now)
    session.commit()
    session.refresh(req)
    return req


def update(session: Session, req: Request, data: RequestUpdate, user: User) -> Request:
    changes = data.model_dump(exclude_unset=True)
    is_manager = user.role == Role.manager
    if not is_manager:
        if req.requester_id != user.id or req.status != Status.submitted:
            raise TransitionError("You can edit this request only while it is Submitted.", 403)
        # The requester set priority, contract type and domain at submit; only the
        # commitment fields stay manager-only while the request is Submitted.
        blocked = MANAGER_ONLY_FIELDS & (set(changes) - {"priority", "contract_type", "domain_id"})
        if blocked:
            raise TransitionError(f"Only a manager can change: {', '.join(sorted(blocked))}.", 403)
    if req.status in (Status.completed, Status.cancelled, Status.rejected):
        raise TransitionError("Closed requests cannot be edited.", 409)
    log: dict[str, Any] = {}
    for k, v in changes.items():
        old = getattr(req, k)
        if old != v:
            log[k] = {"old": str(old) if old is not None else None, "new": str(v) if v is not None else None}
            setattr(req, k, v)
    if not log:
        return req
    req.updated_at = datetime.now(UTC)
    for field, diff in log.items():
        events.activity(session, request_id=req.id, actor_id=user.id, kind="field_changed",
                        data={"field": field, **diff})
    events.audit(session, actor_id=user.id, action="request.updated", entity="request",
                 entity_id=req.id, old={k: d["old"] for k, d in log.items()},
                 new={k: d["new"] for k, d in log.items()})
    if {"priority", "category", "contract_type", "request_type_id"} & set(log):
        sla.recalculate(session, req)
    session.add(req)
    session.commit()
    session.refresh(req)
    return req


# ---------------------------------------------------------------------------
# Workflow
# ---------------------------------------------------------------------------


def load_rules(session: Session) -> list[TransitionRule]:
    rows = session.exec(select(WorkflowTransition).where(WorkflowTransition.is_active)).all()
    if not rows:
        return SEED_TRANSITIONS
    return [
        TransitionRule(
            action=r.action, from_status=r.from_status.value, to_status=r.to_status.value,
            allowed_roles=tuple(r.allowed_roles), requires_reason=r.requires_reason,
            guards=tuple(g.strip() for g in (r.guard or "").split(",") if g.strip()),
        )
        for r in rows
    ]


def active_assignments(session: Session, request_id: uuid.UUID) -> list[Assignment]:
    return list(
        session.exec(
            select(Assignment).where(Assignment.request_id == request_id, Assignment.is_active)
        ).all()
    )


def hours_by_assignment(session: Session, assignment_ids: list[uuid.UUID]) -> dict[uuid.UUID, Decimal]:
    if not assignment_ids:
        return {}
    rows = session.exec(
        select(TimeLog.assignment_id, func.sum(TimeLog.hours))
        .where(col(TimeLog.assignment_id).in_(assignment_ids))
        .group_by(col(TimeLog.assignment_id))
    ).all()
    return {aid: Decimal(total or 0) for aid, total in rows}


def _context(session: Session, req: Request, user: User, to_status: str | None) -> GuardContext:
    assigns = active_assignments(session, req.id)
    hours = hours_by_assignment(session, [a.id for a in assigns])
    has_output = session.exec(
        select(Attachment.id).where(Attachment.request_id == req.id, Attachment.is_output)
    ).first() is not None
    return GuardContext(
        user_id=str(user.id),
        user_role=user.role.value,
        requester_id=str(req.requester_id),
        status_before_hold=req.status_before_hold.value if req.status_before_hold else None,
        to_status=to_status,
        priority=req.priority.value if req.priority else None,
        committed_date=req.committed_date,
        required_date=req.required_date,
        committed_late_reason=req.committed_late_reason,
        estimated_hours=float(req.estimated_hours) if req.estimated_hours is not None else None,
        active_assignments=[
            {"engineer_id": str(a.engineer_id), "role": a.assignment_role.value,
             "hours_logged": float(hours.get(a.id, 0))}
            for a in assigns
        ],
        has_output_file=has_output,
        completed_at=req.completed_at,
        now=datetime.now(UTC),
    )


def transition(
    session: Session, req: Request, user: User, action: str, reason: str | None,
    *, commit: bool = True,
) -> Request:
    from_status = req.status.value
    to_status = req.status_before_hold.value if action == "resume" and req.status_before_hold else None
    rule = pick_rule(load_rules(session), action=action, from_status=from_status,
                     role=user.role.value, to_status=to_status)
    now = datetime.now(UTC)
    if action == "approve" and req.committed_date is None:
        # PRD: Committed Date defaults to the SLA due date.
        req.committed_date = sla.default_committed_date(session, req, now)
    ctx = _context(session, req, user, rule.to_status)
    check(rule, ctx, reason)

    new = Status(rule.to_status)
    if new == Status.on_hold:
        req.status_before_hold = req.status
    elif req.status == Status.on_hold:
        req.status_before_hold = None
    if action in ("reject", "hold", "need_more_info"):
        req.assessment_note = reason
    if new == Status.completed and req.completed_at is None:
        req.completed_at = now
    req.status = new
    req.updated_at = now
    session.add(req)
    session.add(StatusHistory(request_id=req.id, from_status=Status(from_status), to_status=new,
                              action=action, reason=reason, changed_by_id=user.id, changed_at=now))
    events.activity(session, request_id=req.id, actor_id=user.id, kind="status_changed",
                    data={"from": from_status, "to": new.value, "action": action, "reason": reason})
    events.audit(session, actor_id=user.id, action="request.status_changed", entity="request",
                 entity_id=req.id, old={"status": from_status}, new={"status": new.value})
    events.webhook(session, "status.changed", {"id": str(req.id), "code": req.code,
                                               "from": from_status, "to": new.value})
    _notify_move(session, req, user, action)
    session.flush()
    sla.recalculate(session, req, now)
    if commit:
        session.commit()
        session.refresh(req)
    return req


def _notify_move(session: Session, req: Request, user: User, action: str) -> None:
    to_requester = {"need_more_info": "need_more_info", "reject": "rejected",
                    "approve": "approved", "complete": "completed"}
    if action in to_requester:
        events.notify(session, user_ids=[req.requester_id], event=to_requester[action],
                      title=f"{req.code} is now {STATUS_WORDS[req.status]}", request_id=req.id,
                      skip_user=user.id)
    if action == "submit_review":
        events.notify(session, user_ids=events.manager_ids(session), event="under_review",
                      title=f"{req.code} is ready for review", request_id=req.id, skip_user=user.id)


# ---------------------------------------------------------------------------
# Assignments
# ---------------------------------------------------------------------------


def recompute_estimate(session: Session, req: Request) -> None:
    total = sum((a.estimated_hours for a in active_assignments(session, req.id)), Decimal("0"))
    req.estimated_hours = total if total > 0 else req.estimated_hours
    session.add(req)


def assign(session: Session, req: Request, user: User, *, engineer: User,
           role: AssignmentRole, level: str, estimated_hours: Decimal) -> Assignment:
    if req.status in (Status.completed, Status.cancelled, Status.rejected, Status.submitted):
        raise TransitionError("Engineers can be assigned after the request is under assessment.", 409)
    if engineer.role not in (Role.engineer, Role.manager) or not engineer.is_active:
        raise TransitionError("Only active engineers or managers can be assigned.", 422)
    current = active_assignments(session, req.id)
    if any(a.engineer_id == engineer.id for a in current):
        raise TransitionError("This person is already on the request.", 409)
    if role == AssignmentRole.primary:
        for a in current:
            if a.assignment_role == AssignmentRole.primary:
                _release(session, a, user, notify=True, req=req)
    a = Assignment(request_id=req.id, engineer_id=engineer.id, assignment_role=role,
                   level=level, estimated_hours=estimated_hours, assigned_by_id=user.id)  # type: ignore[arg-type]
    session.add(a)
    session.flush()
    events.activity(session, request_id=req.id, actor_id=user.id, kind="assigned",
                    data={"engineer_id": str(engineer.id), "role": role.value, "level": level})
    events.notify(session, user_ids=[engineer.id], event="assigned",
                  title=f"You are assigned to {req.code}: {req.title}", request_id=req.id,
                  skip_user=user.id)
    recompute_estimate(session, req)
    session.commit()
    session.refresh(a)
    return a


def _release(session: Session, a: Assignment, user: User, *, notify: bool, req: Request) -> None:
    a.is_active = False
    a.released_at = datetime.now(UTC)
    a.released_by_id = user.id
    session.add(a)
    events.activity(session, request_id=req.id, actor_id=user.id, kind="released",
                    data={"engineer_id": str(a.engineer_id)})
    if notify:
        events.notify(session, user_ids=[a.engineer_id], event="released",
                      title=f"You were removed from {req.code}", request_id=req.id, skip_user=user.id)


def release(session: Session, req: Request, a: Assignment, user: User) -> None:
    if req.status in (Status.completed, Status.cancelled, Status.rejected):
        raise TransitionError("Closed requests cannot be changed.", 409)
    _release(session, a, user, notify=True, req=req)
    recompute_estimate(session, req)
    session.commit()
