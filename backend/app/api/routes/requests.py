"""Reporting requests: inbox, detail, edits, workflow moves, assignments,
time logs, comments, attachments, history and SLA."""

import hashlib
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import case, or_
from sqlmodel import col, func, select

from app.api.deps import CurrentUser, ManagerUser, SessionDep
from app.core.config import settings
from app.models import (
    CLOSED_STATUSES,
    Activity,
    ActivityPublic,
    Assignment,
    AssignmentCreate,
    AssignmentPublic,
    Attachment,
    AttachmentPublic,
    Comment,
    CommentCreate,
    CommentPublic,
    Message,
    Priority,
    Request,
    RequestCreate,
    RequestPublic,
    RequestSla,
    RequestSlaPublic,
    RequestsPublic,
    RequestUpdate,
    Role,
    Status,
    StatusHistory,
    StatusHistoryPublic,
    TimeLog,
    TimeLogCreate,
    TimeLogPublic,
    TransitionIn,
    User,
    Visibility,
)
from app.services import events
from app.services import requests as svc

router = APIRouter(prefix="/requests", tags=["requests"])

ALLOWED_EXT = {".xlsx", ".csv", ".pdf", ".docx", ".pptx", ".png", ".jpg", ".jpeg", ".zip"}
MAX_FILE_BYTES = 25 * 1024 * 1024
MAX_FILES = 10
COMMENT_EDIT_WINDOW = timedelta(minutes=15)
TIMELOG_EDIT_DAYS = 7


def _get(session: SessionDep, request_id: uuid.UUID, user: User) -> Request:
    req = session.get(Request, request_id)
    if not req or not svc.can_see(session, req, user):
        raise HTTPException(status_code=404, detail="Request not found")
    return req


# ---------------------------------------------------------------------------
# Inbox and detail
# ---------------------------------------------------------------------------


@router.get("/", response_model=RequestsPublic)
def list_requests(
    session: SessionDep,
    current_user: CurrentUser,
    q: str | None = None,
    status: Annotated[list[Status] | None, Query()] = None,
    priority: Annotated[list[Priority] | None, Query()] = None,
    customer_id: uuid.UUID | None = None,
    domain_id: uuid.UUID | None = None,
    engineer_id: uuid.UUID | None = None,
    overdue: bool | None = None,
    mine: bool = False,
    sort: str = "committed_date",
    skip: int = 0,
    limit: Annotated[int, Query(le=200)] = 50,
) -> Any:
    """Inbox with search, filters and sorting. Visibility follows the user's role."""
    stmt = svc.visible(select(Request), current_user)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(col(Request.code).ilike(like), col(Request.title).ilike(like),
                              col(Request.report_name).ilike(like)))
    if status:
        stmt = stmt.where(col(Request.status).in_(status))
    if priority:
        stmt = stmt.where(col(Request.priority).in_(priority))
    if customer_id:
        stmt = stmt.where(Request.customer_id == customer_id)
    if domain_id:
        stmt = stmt.where(Request.domain_id == domain_id)
    if engineer_id:
        stmt = stmt.where(col(Request.id).in_(
            select(Assignment.request_id).where(Assignment.engineer_id == engineer_id, Assignment.is_active)))
    if mine:
        stmt = stmt.where(or_(Request.requester_id == current_user.id, col(Request.id).in_(
            select(Assignment.request_id).where(Assignment.engineer_id == current_user.id, Assignment.is_active))))
    if overdue:
        today = datetime.now(UTC).astimezone(svc.sla.load_calendar(session).tz).date()
        stmt = stmt.where(col(Request.status).not_in(CLOSED_STATUSES),
                          col(Request.committed_date) < today)
    count = session.exec(select(func.count()).select_from(stmt.subquery())).one()
    order = {
        "committed_date": col(Request.committed_date).asc().nulls_last(),
        "newest": col(Request.submitted_at).desc(),
        "oldest": col(Request.submitted_at).asc(),
        "priority": case({"critical": 0, "high": 1, "medium": 2, "low": 3}, value=col(Request.priority)),
    }.get(sort, col(Request.committed_date).asc().nulls_last())
    rows = session.exec(stmt.order_by(order).offset(skip).limit(limit)).all()
    return RequestsPublic(data=[RequestPublic.model_validate(r) for r in rows], count=count)


@router.post("/", response_model=RequestPublic)
def create_request(session: SessionDep, current_user: CurrentUser, body: RequestCreate) -> Any:
    if current_user.role == Role.admin:
        raise HTTPException(status_code=403, detail="Admins do not submit requests.")
    return svc.create(session, body, current_user)


@router.get("/{request_id}", response_model=RequestPublic)
def read_request(session: SessionDep, current_user: CurrentUser, request_id: uuid.UUID) -> Any:
    return _get(session, request_id, current_user)


@router.patch("/{request_id}", response_model=RequestPublic)
def update_request(session: SessionDep, current_user: CurrentUser, request_id: uuid.UUID,
                   body: RequestUpdate) -> Any:
    req = _get(session, request_id, current_user)
    return svc.update(session, req, body, current_user)


@router.post("/{request_id}/transitions", response_model=RequestPublic)
def move_request(session: SessionDep, current_user: CurrentUser, request_id: uuid.UUID,
                 body: TransitionIn) -> Any:
    """Run one workflow action (approve, start, hold, cancel, ...)."""
    req = _get(session, request_id, current_user)
    return svc.transition(session, req, current_user, body.action, body.reason)


@router.get("/{request_id}/actions", response_model=list[str])
def available_actions(session: SessionDep, current_user: CurrentUser, request_id: uuid.UUID) -> Any:
    """Actions the current user may try now (guards are checked when run)."""
    req = _get(session, request_id, current_user)
    rules = svc.load_rules(session)
    names = [r.action for r in rules if r.from_status == req.status.value
             and current_user.role.value in r.allowed_roles]
    return list(dict.fromkeys(names))


@router.get("/{request_id}/history", response_model=list[StatusHistoryPublic])
def history(session: SessionDep, current_user: CurrentUser, request_id: uuid.UUID) -> Any:
    _get(session, request_id, current_user)
    return session.exec(select(StatusHistory).where(StatusHistory.request_id == request_id)
                        .order_by(col(StatusHistory.changed_at))).all()


@router.get("/{request_id}/activity", response_model=list[ActivityPublic])
def timeline(session: SessionDep, current_user: CurrentUser, request_id: uuid.UUID) -> Any:
    _get(session, request_id, current_user)
    stmt = select(Activity).where(Activity.request_id == request_id)
    if not svc.can_see_internal(current_user):
        stmt = stmt.where(Activity.visibility == Visibility.public)
    return session.exec(stmt.order_by(col(Activity.created_at).desc())).all()


@router.get("/{request_id}/sla", response_model=RequestSlaPublic)
def request_sla(session: SessionDep, current_user: CurrentUser, request_id: uuid.UUID) -> Any:
    req = _get(session, request_id, current_user)
    row = session.get(RequestSla, req.id)
    if row is None or req.status not in CLOSED_STATUSES:
        row = svc.sla.recalculate(session, req)
        session.commit()
        session.refresh(row)
    return row


# ---------------------------------------------------------------------------
# Assignments and hours
# ---------------------------------------------------------------------------


@router.get("/{request_id}/assignments", response_model=list[AssignmentPublic])
def list_assignments(session: SessionDep, current_user: CurrentUser, request_id: uuid.UUID,
                     include_released: bool = False) -> Any:
    _get(session, request_id, current_user)
    stmt = select(Assignment).where(Assignment.request_id == request_id)
    if not include_released:
        stmt = stmt.where(Assignment.is_active)
    rows = session.exec(stmt.order_by(col(Assignment.assigned_at))).all()
    hours = svc.hours_by_assignment(session, [a.id for a in rows])
    return [AssignmentPublic(**a.model_dump(), actual_hours=hours.get(a.id, 0)) for a in rows]


@router.post("/{request_id}/assignments", response_model=AssignmentPublic)
def add_assignment(session: SessionDep, current_user: ManagerUser, request_id: uuid.UUID,
                   body: AssignmentCreate) -> Any:
    req = _get(session, request_id, current_user)
    engineer = session.get(User, body.engineer_id)
    if not engineer:
        raise HTTPException(status_code=404, detail="Engineer not found")
    a = svc.assign(session, req, current_user, engineer=engineer, role=body.assignment_role,
                   level=body.level, estimated_hours=body.estimated_hours)
    return AssignmentPublic(**a.model_dump())


@router.delete("/{request_id}/assignments/{assignment_id}", response_model=Message)
def remove_assignment(session: SessionDep, current_user: ManagerUser, request_id: uuid.UUID,
                      assignment_id: uuid.UUID) -> Any:
    req = _get(session, request_id, current_user)
    a = session.get(Assignment, assignment_id)
    if not a or a.request_id != req.id or not a.is_active:
        raise HTTPException(status_code=404, detail="Assignment not found")
    svc.release(session, req, a, current_user)
    return Message(message="Engineer released")


@router.get("/{request_id}/timelogs", response_model=list[TimeLogPublic])
def list_timelogs(session: SessionDep, current_user: CurrentUser, request_id: uuid.UUID) -> Any:
    _get(session, request_id, current_user)
    ids = select(Assignment.id).where(Assignment.request_id == request_id)
    return session.exec(select(TimeLog).where(col(TimeLog.assignment_id).in_(ids))
                        .order_by(col(TimeLog.work_date).desc())).all()


@router.post("/{request_id}/timelogs", response_model=TimeLogPublic)
def log_hours(session: SessionDep, current_user: CurrentUser, request_id: uuid.UUID,
              body: TimeLogCreate) -> Any:
    req = _get(session, request_id, current_user)
    if req.status in CLOSED_STATUSES:
        raise HTTPException(status_code=409, detail="Closed requests cannot take new hours.")
    a = session.exec(select(Assignment).where(Assignment.request_id == req.id,
                                              Assignment.engineer_id == current_user.id,
                                              Assignment.is_active)).first()
    if not a:
        raise HTTPException(status_code=403, detail="Only assigned engineers can log hours.")
    today = datetime.now(UTC).astimezone(svc.sla.load_calendar(session).tz).date()
    if body.work_date > today:
        raise HTTPException(status_code=422, detail="Work date cannot be in the future.")
    log = TimeLog(assignment_id=a.id, **body.model_dump())
    session.add(log)
    events.activity(session, request_id=req.id, actor_id=current_user.id, kind="hours_logged",
                    data={"hours": str(body.hours), "work_date": body.work_date.isoformat()},
                    visibility=Visibility.internal)
    session.commit()
    session.refresh(log)
    return log


@router.patch("/{request_id}/timelogs/{log_id}", response_model=TimeLogPublic)
def edit_hours(session: SessionDep, current_user: CurrentUser, request_id: uuid.UUID,
               log_id: uuid.UUID, body: TimeLogCreate) -> Any:
    req = _get(session, request_id, current_user)
    log = session.get(TimeLog, log_id)
    a = session.get(Assignment, log.assignment_id) if log else None
    if not log or not a or a.request_id != req.id:
        raise HTTPException(status_code=404, detail="Time log not found")
    is_owner = a.engineer_id == current_user.id
    fresh = datetime.now(UTC) - log.created_at <= timedelta(days=TIMELOG_EDIT_DAYS)
    if not (current_user.role == Role.manager or (is_owner and fresh)):
        raise HTTPException(status_code=403, detail="After 7 days only a manager can edit hours.")
    for k, v in body.model_dump().items():
        setattr(log, k, v)
    log.updated_at = datetime.now(UTC)
    session.add(log)
    session.commit()
    session.refresh(log)
    return log


# ---------------------------------------------------------------------------
# Comments
# ---------------------------------------------------------------------------


@router.get("/{request_id}/comments", response_model=list[CommentPublic])
def list_comments(session: SessionDep, current_user: CurrentUser, request_id: uuid.UUID) -> Any:
    _get(session, request_id, current_user)
    stmt = select(Comment).where(Comment.request_id == request_id)
    if not svc.can_see_internal(current_user):
        stmt = stmt.where(Comment.visibility == Visibility.public)
    rows = session.exec(stmt.order_by(col(Comment.created_at))).all()
    for c in rows:
        if c.deleted_at:
            c.body = ""
    return rows


@router.post("/{request_id}/comments", response_model=CommentPublic)
def add_comment(session: SessionDep, current_user: CurrentUser, request_id: uuid.UUID,
                body: CommentCreate) -> Any:
    req = _get(session, request_id, current_user)
    vis = body.visibility if svc.can_see_internal(current_user) else Visibility.public
    c = Comment(request_id=req.id, author_id=current_user.id, visibility=vis, body=body.body)
    session.add(c)
    session.flush()
    events.activity(session, request_id=req.id, actor_id=current_user.id, kind="comment_added",
                    data={"comment_id": str(c.id)}, visibility=vis)
    # Public comments reach the requester and the assigned engineers.
    if vis == Visibility.public:
        targets = [req.requester_id] + [a.engineer_id for a in svc.active_assignments(session, req.id)]
        events.notify(session, user_ids=targets, event="comment", title=f"New comment on {req.code}",
                      request_id=req.id, skip_user=current_user.id)
    session.commit()
    session.refresh(c)
    return c


@router.patch("/{request_id}/comments/{comment_id}", response_model=CommentPublic)
def edit_comment(session: SessionDep, current_user: CurrentUser, request_id: uuid.UUID,
                 comment_id: uuid.UUID, body: CommentCreate) -> Any:
    _get(session, request_id, current_user)
    c = session.get(Comment, comment_id)
    if not c or c.request_id != request_id or c.deleted_at:
        raise HTTPException(status_code=404, detail="Comment not found")
    if c.author_id != current_user.id or datetime.now(UTC) - c.created_at > COMMENT_EDIT_WINDOW:
        raise HTTPException(status_code=403, detail="Comments can be edited by their author for 15 minutes.")
    c.body = body.body
    c.edited_at = datetime.now(UTC)
    session.add(c)
    session.commit()
    session.refresh(c)
    return c


@router.delete("/{request_id}/comments/{comment_id}", response_model=Message)
def delete_comment(session: SessionDep, current_user: CurrentUser, request_id: uuid.UUID,
                   comment_id: uuid.UUID) -> Any:
    _get(session, request_id, current_user)
    c = session.get(Comment, comment_id)
    if not c or c.request_id != request_id or c.deleted_at:
        raise HTTPException(status_code=404, detail="Comment not found")
    if c.author_id != current_user.id and current_user.role != Role.admin:
        raise HTTPException(status_code=403, detail="Only the author or an admin can delete a comment.")
    c.deleted_at = datetime.now(UTC)
    c.deleted_by_id = current_user.id
    session.add(c)
    events.audit(session, actor_id=current_user.id, action="comment.deleted", entity="comment", entity_id=c.id)
    session.commit()
    return Message(message="Comment deleted")


# ---------------------------------------------------------------------------
# Attachments
# ---------------------------------------------------------------------------


def _storage_root() -> Path:
    root = Path(settings.ATTACHMENT_DIR)
    root.mkdir(parents=True, exist_ok=True)
    return root


@router.get("/{request_id}/attachments", response_model=list[AttachmentPublic])
def list_attachments(session: SessionDep, current_user: CurrentUser, request_id: uuid.UUID) -> Any:
    _get(session, request_id, current_user)
    stmt = select(Attachment).where(Attachment.request_id == request_id)
    if not svc.can_see_internal(current_user):
        stmt = stmt.where(Attachment.visibility == Visibility.public)
    return session.exec(stmt.order_by(col(Attachment.created_at))).all()


@router.post("/{request_id}/attachments", response_model=AttachmentPublic)
async def upload_attachment(
    session: SessionDep,
    current_user: CurrentUser,
    request_id: uuid.UUID,
    file: Annotated[UploadFile, File()],
    is_output: Annotated[bool, Form()] = False,
    visibility: Annotated[Visibility, Form()] = Visibility.public,
) -> Any:
    req = _get(session, request_id, current_user)
    name = Path(file.filename or "file").name
    ext = Path(name).suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(status_code=422, detail=f"File type {ext or '(none)'} is not allowed.")
    count = session.exec(select(func.count()).select_from(Attachment)
                         .where(Attachment.request_id == req.id)).one()
    if count >= MAX_FILES:
        raise HTTPException(status_code=422, detail="A request can hold up to 10 files.")
    data = await file.read(MAX_FILE_BYTES + 1)
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="Files can be up to 25 MB.")
    if is_output and current_user.role not in (Role.engineer, Role.manager):
        raise HTTPException(status_code=403, detail="Only engineers and managers can mark an output file.")
    if not svc.can_see_internal(current_user):
        visibility = Visibility.public
    att_id = uuid.uuid4()
    rel = Path(str(req.id)) / f"{att_id}{ext}"
    dest = _storage_root() / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    att = Attachment(id=att_id, request_id=req.id, file_name=name, storage_path=str(rel),
                     mime_type=file.content_type or "application/octet-stream", size_bytes=len(data),
                     sha256=hashlib.sha256(data).hexdigest(), is_output=is_output,
                     visibility=visibility, uploaded_by_id=current_user.id)
    session.add(att)
    events.activity(session, request_id=req.id, actor_id=current_user.id, kind="file_added",
                    data={"file_name": name, "is_output": is_output}, visibility=visibility)
    session.commit()
    session.refresh(att)
    return att


@router.get("/{request_id}/attachments/{attachment_id}")
def download_attachment(session: SessionDep, current_user: CurrentUser, request_id: uuid.UUID,
                        attachment_id: uuid.UUID) -> FileResponse:
    _get(session, request_id, current_user)
    att = session.get(Attachment, attachment_id)
    if not att or att.request_id != request_id or (
        att.visibility == Visibility.internal and not svc.can_see_internal(current_user)
    ):
        raise HTTPException(status_code=404, detail="File not found")
    path = (_storage_root() / att.storage_path).resolve()
    if _storage_root().resolve() not in path.parents or not path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(path, filename=att.file_name, media_type=att.mime_type)
