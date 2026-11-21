"""Activity timeline, notifications, audit log and webhook outbox writers.

Every writer only adds rows to the session; the caller commits, so the event
is stored in the same transaction as the change it describes.
"""

import uuid
from typing import Any

from sqlmodel import Session, select

from app.models import (
    Activity,
    AuditLog,
    Notification,
    NotificationPreference,
    Role,
    User,
    Visibility,
    WebhookOutbox,
)

# Events that send email unless the user switched it off.
EMAIL_EVENTS = {
    "request_submitted",
    "need_more_info",
    "rejected",
    "approved",
    "assigned",
    "released",
    "mention",
    "completed",
    "deadline_reminder",
    "overdue",
    "signup_request",
}
# Overdue email cannot be switched off for managers.
LOCKED_FOR_MANAGERS = {"overdue"}


def activity(
    session: Session,
    *,
    request_id: uuid.UUID,
    actor_id: uuid.UUID | None,
    kind: str,
    data: dict[str, Any] | None = None,
    visibility: Visibility = Visibility.public,
) -> None:
    session.add(
        Activity(
            request_id=request_id,
            actor_id=actor_id,
            kind=kind,
            data=data or {},
            visibility=visibility,
        )
    )


def notify(
    session: Session,
    *,
    user_ids: list[uuid.UUID],
    event: str,
    title: str,
    body: str | None = None,
    request_id: uuid.UUID | None = None,
    skip_user: uuid.UUID | None = None,
) -> None:
    for uid in dict.fromkeys(user_ids):  # keep order, drop duplicates
        if uid == skip_user:
            continue
        email = "not_needed"
        if event in EMAIL_EVENTS:
            pref = session.get(NotificationPreference, (uid, event))
            user = session.get(User, uid)
            locked = event in LOCKED_FOR_MANAGERS and user is not None and user.role == Role.manager
            if locked or pref is None or pref.email_enabled:
                email = "pending"
        session.add(
            Notification(
                user_id=uid,
                request_id=request_id,
                event=event,
                title=title,
                body=body,
                email_status=email,
            )
        )


def manager_ids(session: Session) -> list[uuid.UUID]:
    return list(
        session.exec(select(User.id).where(User.role == Role.manager, User.is_active)).all()
    )


def audit(
    session: Session,
    *,
    actor_id: uuid.UUID | None,
    action: str,
    entity: str | None = None,
    entity_id: uuid.UUID | None = None,
    old: Any = None,
    new: Any = None,
    ip: str | None = None,
) -> None:
    session.add(
        AuditLog(
            actor_id=actor_id,
            action=action,
            entity=entity,
            entity_id=entity_id,
            old_value=old,
            new_value=new,
            ip_address=ip,
        )
    )


def webhook(session: Session, event: str, payload: dict[str, Any]) -> None:
    session.add(WebhookOutbox(event=event, payload=payload))
