"""Background worker: runs every 15 minutes.

- keeps `request.is_overdue` and SLA flags up to date,
- sends deadline reminders, at-risk and overdue alerts (once per day each),
- sends pending notification emails.

Run with:  python -m app.jobs            (loop, used by the `worker` container)
           python -m app.jobs --once     (single run, e.g. for testing)
"""

import html
import logging
import sys
import time as time_mod
from datetime import UTC, date, datetime, time, timedelta

from sqlmodel import Session, col, select

from app.core.config import settings
from app.core.db import engine
from app.models import (
    CLOSED_STATUSES,
    Assignment,
    AssignmentRole,
    Notification,
    Request,
    RequestSla,
    User,
)
from app.services import events, sla
from app.utils import send_email

logger = logging.getLogger("reportops.jobs")
INTERVAL_SECONDS = 15 * 60


def _primary(session: Session, request_id: object) -> list[object]:
    return list(session.exec(select(Assignment.engineer_id).where(
        Assignment.request_id == request_id, Assignment.is_active,
        Assignment.assignment_role == AssignmentRole.primary)).all())


def _sent_today(session: Session, request_id: object, event: str, since: datetime) -> bool:
    return session.exec(select(Notification.id).where(
        Notification.request_id == request_id, Notification.event == event,
        Notification.created_at >= since)).first() is not None


def _next_work_day(cal: sla.WorkCalendar, d: date) -> date:
    d += timedelta(days=1)
    for _ in range(60):
        if cal.is_work_day(d):
            return d
        d += timedelta(days=1)
    return d


def check_requests(session: Session, now: datetime | None = None) -> None:
    now = now or datetime.now(UTC)
    cal = sla.load_calendar(session)
    today = now.astimezone(cal.tz).date()
    day_start = datetime.combine(today, time(), tzinfo=cal.tz)
    managers = events.manager_ids(session)
    reqs = session.exec(select(Request).where(col(Request.status).not_in(CLOSED_STATUSES))).all()
    for r in reqs:
        before = session.get(RequestSla, r.id)
        was_at_risk = before.is_at_risk if before else False
        row = sla.recalculate(session, r, now)
        overdue = r.committed_date is not None and r.committed_date < today
        if overdue != r.is_overdue:
            r.is_overdue = overdue
            session.add(r)
        targets = _primary(session, r.id)
        if overdue and not _sent_today(session, r.id, "overdue", day_start):
            events.notify(session, user_ids=targets + managers, event="overdue",
                          title=f"{r.code} is overdue (committed {r.committed_date:%d %b})", request_id=r.id)
            events.activity(session, request_id=r.id, actor_id=None, kind="overdue")
            events.webhook(session, "request.overdue", {"id": str(r.id), "code": r.code})
        if row.is_at_risk and not was_at_risk:
            events.notify(session, user_ids=targets + managers, event="sla_at_risk",
                          title=f"{r.code}: 75% of SLA time used", request_id=r.id)
            events.activity(session, request_id=r.id, actor_id=None, kind="sla_at_risk")
        # Deadline reminder: on the working day before the committed date.
        if r.committed_date and not overdue and _next_work_day(cal, today) == r.committed_date \
                and not _sent_today(session, r.id, "deadline_reminder", day_start):
            events.notify(session, user_ids=targets + managers, event="deadline_reminder",
                          title=f"{r.code} is due {r.committed_date:%d %b}", request_id=r.id)
    session.commit()


def send_pending_emails(session: Session) -> None:
    if not settings.emails_enabled:
        return
    rows = session.exec(select(Notification).where(Notification.email_status == "pending")
                        .limit(200)).all()
    for n in rows:
        user = session.get(User, n.user_id)
        if not user or not user.is_active:
            n.email_status = "not_needed"
        else:
            try:
                link = f"{settings.FRONTEND_HOST}/requests/{n.request_id}" if n.request_id else settings.FRONTEND_HOST
                body = html.escape(n.body or "")
                send_email(email_to=user.email, subject=f"[ReportOps] {n.title}",
                           html_content=f"<p>{html.escape(n.title)}</p><p>{body}</p>"
                                        f'<p><a href="{html.escape(link)}">Open in ReportOps</a></p>')
                n.email_status = "sent"
            except Exception:  # keep the job alive; retry next run
                logger.exception("email to %s failed", user.email)
                n.email_status = "failed"
        session.add(n)
    session.commit()


def run_once() -> None:
    with Session(engine) as session:
        check_requests(session)
        send_pending_emails(session)


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    if "--once" in sys.argv:
        run_once()
        return
    while True:
        try:
            run_once()
        except Exception:
            logger.exception("job run failed")
        time_mod.sleep(INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
