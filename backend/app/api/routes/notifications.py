"""In-app notifications (bell icon) and per-user email preferences."""

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException
from sqlmodel import SQLModel, col, func, select

from app.api.deps import CurrentUser, SessionDep
from app.models import Message, Notification, NotificationPreference, NotificationPublic
from app.services.events import EMAIL_EVENTS

router = APIRouter(prefix="/notifications", tags=["notifications"])


class NotificationsOut(SQLModel):
    data: list[NotificationPublic]
    unread: int


@router.get("/", response_model=NotificationsOut)
def my_notifications(session: SessionDep, user: CurrentUser, unread_only: bool = False,
                     limit: int = 50) -> Any:
    stmt = select(Notification).where(Notification.user_id == user.id)
    if unread_only:
        stmt = stmt.where(col(Notification.read_at).is_(None))
    rows = session.exec(stmt.order_by(col(Notification.created_at).desc()).limit(min(limit, 200))).all()
    unread = session.exec(select(func.count()).select_from(Notification).where(
        Notification.user_id == user.id, col(Notification.read_at).is_(None))).one()
    return NotificationsOut(data=[NotificationPublic.model_validate(n) for n in rows], unread=unread)


@router.post("/{notification_id}/read", response_model=Message)
def mark_read(session: SessionDep, user: CurrentUser, notification_id: uuid.UUID) -> Any:
    n = session.get(Notification, notification_id)
    if not n or n.user_id != user.id:
        raise HTTPException(status_code=404, detail="Notification not found")
    n.read_at = n.read_at or datetime.now(UTC)
    session.add(n)
    session.commit()
    return Message(message="OK")


@router.post("/read-all", response_model=Message)
def mark_all_read(session: SessionDep, user: CurrentUser) -> Any:
    rows = session.exec(select(Notification).where(Notification.user_id == user.id,
                                                   col(Notification.read_at).is_(None))).all()
    now = datetime.now(UTC)
    for n in rows:
        n.read_at = now
        session.add(n)
    session.commit()
    return Message(message=f"{len(rows)} marked as read")


class PreferenceIn(SQLModel):
    event: str
    email_enabled: bool


@router.get("/preferences", response_model=list[PreferenceIn])
def my_preferences(session: SessionDep, user: CurrentUser) -> Any:
    saved = {p.event: p.email_enabled for p in session.exec(
        select(NotificationPreference).where(NotificationPreference.user_id == user.id)).all()}
    return [PreferenceIn(event=e, email_enabled=saved.get(e, True)) for e in sorted(EMAIL_EVENTS)]


@router.put("/preferences", response_model=PreferenceIn)
def set_preference(session: SessionDep, user: CurrentUser, body: PreferenceIn) -> Any:
    if body.event not in EMAIL_EVENTS:
        raise HTTPException(status_code=422, detail="Unknown event")
    p = session.get(NotificationPreference, (user.id, body.event)) or NotificationPreference(
        user_id=user.id, event=body.event)
    p.email_enabled = body.email_enabled
    session.add(p)
    session.commit()
    return body
