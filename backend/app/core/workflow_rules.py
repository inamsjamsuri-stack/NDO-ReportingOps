"""Workflow rules: the seed transition table and the guard checks.

Pure Python (standard library only). The database table ``workflow_transition``
is seeded from SEED_TRANSITIONS; the API reads the table at run time so an
Admin can switch a move off without a code release. Guards stay in code.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

REOPEN_WINDOW = timedelta(days=14)

ACTIVE_FOR_HOLD = ("under_assessment", "approved", "assigned", "in_progress", "under_review")


@dataclass(frozen=True)
class TransitionRule:
    action: str
    from_status: str
    to_status: str
    allowed_roles: tuple[str, ...]
    requires_reason: bool = False
    guards: tuple[str, ...] = ()


def _seed() -> list[TransitionRule]:
    r: list[TransitionRule] = [
        TransitionRule("open_assessment", "submitted", "under_assessment", ("manager",)),
        TransitionRule("need_more_info", "under_assessment", "submitted", ("manager",), True),
        TransitionRule("approve", "under_assessment", "approved", ("manager",), False, ("has_commitment",)),
        TransitionRule("reject", "under_assessment", "rejected", ("manager",), True),
        TransitionRule("assign", "approved", "assigned", ("manager",), False, ("has_primary",)),
        TransitionRule("start", "assigned", "in_progress", ("engineer", "manager"), False, ("is_assignee_or_manager",)),
        TransitionRule("submit_review", "in_progress", "under_review", ("engineer", "manager"), False, ("is_primary_or_manager", "has_output")),
        TransitionRule("rework", "under_review", "in_progress", ("manager",), True),
        TransitionRule("complete", "under_review", "completed", ("manager",), False, ("all_hours_logged",)),
        TransitionRule("reopen", "completed", "in_progress", ("manager",), True, ("within_reopen_window",)),
    ]
    for s in ACTIVE_FOR_HOLD:
        r.append(TransitionRule("hold", s, "on_hold", ("manager",), True))
        r.append(TransitionRule("resume", "on_hold", s, ("manager",), False, ("matches_status_before_hold",)))
    for s in ("submitted", "under_assessment", "approved"):
        r.append(TransitionRule("cancel", s, "cancelled", ("requester",), False, ("own_request",)))
    for s in ("submitted", "under_assessment", "approved", "assigned", "in_progress", "under_review", "on_hold"):
        r.append(TransitionRule("cancel", s, "cancelled", ("manager",), True))
    return r


SEED_TRANSITIONS: list[TransitionRule] = _seed()


@dataclass
class GuardContext:
    """Facts about the request and the acting user needed by the guards."""

    user_id: str
    user_role: str
    requester_id: str
    status_before_hold: str | None = None
    to_status: str | None = None
    priority: str | None = None
    committed_date: date | None = None
    required_date: date | None = None
    committed_late_reason: str | None = None
    estimated_hours: float | None = None
    active_assignments: list[dict[str, object]] = field(default_factory=list)
    # each: {"engineer_id": str, "role": "primary"|"supporting", "hours_logged": float}
    has_output_file: bool = False
    completed_at: datetime | None = None
    now: datetime | None = None


def _has_commitment(c: GuardContext) -> str | None:
    if not c.priority or c.committed_date is None or c.estimated_hours is None:
        return "Set priority, committed date and estimated effort first."
    if c.required_date and c.committed_date > c.required_date and not (c.committed_late_reason or "").strip():
        return "Committed date is later than required date: give a reason."
    return None


def _has_primary(c: GuardContext) -> str | None:
    return None if any(a["role"] == "primary" for a in c.active_assignments) else "Assign a primary engineer first."


def _is_assignee_or_manager(c: GuardContext) -> str | None:
    if c.user_role == "manager" or any(a["engineer_id"] == c.user_id for a in c.active_assignments):
        return None
    return "Only an assigned engineer or a manager can do this."


def _is_primary_or_manager(c: GuardContext) -> str | None:
    if c.user_role == "manager" or any(
        a["engineer_id"] == c.user_id and a["role"] == "primary" for a in c.active_assignments
    ):
        return None
    return "Only the primary engineer or a manager can do this."


def _has_output(c: GuardContext) -> str | None:
    return None if c.has_output_file else "Attach the output file (marked as output) first."


def _all_hours_logged(c: GuardContext) -> str | None:
    missing = [a for a in c.active_assignments if float(a.get("hours_logged", 0) or 0) <= 0]
    return "Every assigned engineer must log hours first." if missing else None


def _matches_status_before_hold(c: GuardContext) -> str | None:
    return None if c.to_status == c.status_before_hold else "Resume goes back to the status before hold only."


def _own_request(c: GuardContext) -> str | None:
    return None if c.user_id == c.requester_id else "You can only cancel your own requests."


def _within_reopen_window(c: GuardContext) -> str | None:
    if c.completed_at is None or c.now is None:
        return "Request has no completion time."
    return None if c.now - c.completed_at <= REOPEN_WINDOW else "Reopen is allowed within 14 days of completion."


GUARDS: dict[str, Callable[[GuardContext], str | None]] = {
    "has_commitment": _has_commitment,
    "has_primary": _has_primary,
    "is_assignee_or_manager": _is_assignee_or_manager,
    "is_primary_or_manager": _is_primary_or_manager,
    "has_output": _has_output,
    "all_hours_logged": _all_hours_logged,
    "matches_status_before_hold": _matches_status_before_hold,
    "own_request": _own_request,
    "within_reopen_window": _within_reopen_window,
}


class TransitionError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def pick_rule(
    rules: Iterable[TransitionRule], *, action: str, from_status: str, role: str,
    to_status: str | None = None,
) -> TransitionRule:
    """Find the one rule the user may use. Raises TransitionError otherwise."""
    matching = [r for r in rules if r.action == action and r.from_status == from_status]
    if to_status is not None:
        matching = [r for r in matching if r.to_status == to_status]
    if not matching:
        raise TransitionError(f"'{action}' is not allowed from status '{from_status}'.", 409)
    for r in matching:
        if role in r.allowed_roles:
            return r
    raise TransitionError("Your role cannot do this.", 403)


def check(rule: TransitionRule, ctx: GuardContext, reason: str | None) -> None:
    if rule.requires_reason and not (reason or "").strip():
        raise TransitionError("A reason is required for this action.")
    for g in rule.guards:
        fn = GUARDS.get(g)
        if fn is None:
            raise TransitionError(f"Unknown guard '{g}'.", 500)
        msg = fn(ctx)
        if msg:
            raise TransitionError(msg, 422)
