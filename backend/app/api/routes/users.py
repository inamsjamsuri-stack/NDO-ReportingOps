import html
import logging
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import SQLModel, col, func, select

from app import crud
from app.api.deps import (
    AdminUser,
    CurrentUser,
    SessionDep,
    get_current_active_superuser,
)
from app.core.config import settings
from app.core.security import get_password_hash, verify_password
from app.models import (
    ApprovalIn,
    ApprovalStatus,
    Customer,
    RejectionIn,
    UserRegister,
    Message,
    Role,
    UpdatePassword,
    User,
    UserCreate,
    UserPublic,
    UsersPublic,
    UserUpdate,
    UserUpdateMe,
)
from app.services import events
from app.utils import generate_new_account_email, send_email

router = APIRouter(prefix="/users", tags=["users"])


@router.get(
    "/",
    dependencies=[Depends(get_current_active_superuser)],
    response_model=UsersPublic,
)
def read_users(session: SessionDep, skip: int = 0, limit: int = 100) -> Any:
    """
    Retrieve users.
    """

    count_statement = select(func.count()).select_from(User)
    count = session.exec(count_statement).one()

    statement = (
        select(User).order_by(col(User.created_at).desc()).offset(skip).limit(limit)
    )
    users = session.exec(statement).all()

    users_public = [UserPublic.model_validate(user) for user in users]
    return UsersPublic(data=users_public, count=count)


@router.post(
    "/", dependencies=[Depends(get_current_active_superuser)], response_model=UserPublic
)
def create_user(*, session: SessionDep, user_in: UserCreate) -> Any:
    """
    Create new user.
    """
    user = crud.get_user_by_email(session=session, email=user_in.email)
    if user:
        raise HTTPException(
            status_code=400,
            detail="The user with this email already exists in the system.",
        )

    user = crud.create_user(session=session, user_create=user_in)
    if settings.emails_enabled and user_in.email:
        email_data = generate_new_account_email(
            email_to=user_in.email, username=user_in.email, password=user_in.password
        )
        send_email(
            email_to=user_in.email,
            subject=email_data.subject,
            html_content=email_data.html_content,
        )
    return user


@router.patch("/me", response_model=UserPublic)
def update_user_me(
    *, session: SessionDep, user_in: UserUpdateMe, current_user: CurrentUser
) -> Any:
    """
    Update own user.
    """

    if user_in.email:
        existing_user = crud.get_user_by_email(session=session, email=user_in.email)
        if existing_user and existing_user.id != current_user.id:
            raise HTTPException(
                status_code=409, detail="User with this email already exists"
            )
    user_data = user_in.model_dump(exclude_unset=True)
    current_user.sqlmodel_update(user_data)
    session.add(current_user)
    session.commit()
    session.refresh(current_user)
    return current_user


@router.patch("/me/password", response_model=Message)
def update_password_me(
    *, session: SessionDep, body: UpdatePassword, current_user: CurrentUser
) -> Any:
    """
    Update own password.
    """
    verified, _ = verify_password(body.current_password, current_user.hashed_password)
    if not verified:
        raise HTTPException(status_code=400, detail="Incorrect password")
    if body.current_password == body.new_password:
        raise HTTPException(
            status_code=400, detail="New password cannot be the same as the current one"
        )
    hashed_password = get_password_hash(body.new_password)
    current_user.hashed_password = hashed_password
    session.add(current_user)
    session.commit()
    return Message(message="Password updated successfully")


@router.get("/me", response_model=UserPublic)
def read_user_me(current_user: CurrentUser) -> Any:
    """
    Get current user.
    """
    return current_user


@router.delete("/me", response_model=Message)
def delete_user_me(session: SessionDep, current_user: CurrentUser) -> Any:
    """
    Delete own user.
    """
    if current_user.is_superuser:
        raise HTTPException(
            status_code=403, detail="Super users are not allowed to delete themselves"
        )
    current_user.is_active = False
    session.add(current_user)
    session.commit()
    return Message(message="User deactivated")


class SignupOption(SQLModel):
    id: uuid.UUID
    name: str


class SignupOptions(SQLModel):
    enabled: bool
    allowed_domains: list[str]
    customers: list[SignupOption]


def _allowed_domains() -> list[str]:
    return [d.strip().lower().lstrip("@") for d in settings.SIGNUP_ALLOWED_DOMAINS.split(",") if d.strip()]


@router.get("/signup-options", response_model=SignupOptions)
def signup_options(session: SessionDep) -> Any:
    """
    Public: what the sign-up page needs (no login required).
    """
    customers = session.exec(
        select(Customer).where(Customer.is_active).order_by(col(Customer.sort_order), col(Customer.name))
    ).all()
    return SignupOptions(
        enabled=settings.SIGNUP_ENABLED,
        allowed_domains=_allowed_domains(),
        customers=[SignupOption(id=c.id, name=c.name) for c in customers],
    )


@router.post("/signup", response_model=Message)
def register_user(session: SessionDep, user_in: UserRegister) -> Any:
    """
    Public: a requester asks for an account. It stays inactive until an admin approves it.
    """
    if not settings.SIGNUP_ENABLED:
        raise HTTPException(status_code=403, detail="Sign-up is switched off. Ask the administrator.")
    email = str(user_in.email).lower()
    domains = _allowed_domains()
    if domains and email.rsplit("@", 1)[-1] not in domains:
        raise HTTPException(status_code=422, detail=f"Use your work email ({', '.join('@' + d for d in domains)}).")
    customer = session.get(Customer, user_in.customer_id)
    if not customer or not customer.is_active:
        raise HTTPException(status_code=422, detail="Choose your customer / department.")
    existing = crud.get_user_by_email(session=session, email=email)
    if existing:
        # Same answer either way, so the form cannot be used to find accounts.
        return Message(message="Thank you. Your request was sent to the administrator.")
    user = User(
        email=email,
        full_name=user_in.full_name.strip(),
        hashed_password=get_password_hash(user_in.password),
        role=Role.requester,
        customer_id=customer.id,
        is_active=False,
        approval_status=ApprovalStatus.pending,
        registration_note=user_in.reason,
    )
    session.add(user)
    session.flush()
    admins = list(session.exec(select(User.id).where(User.role == Role.admin, User.is_active)).all())
    events.notify(session, user_ids=admins, event="signup_request",
                  title=f"Account request: {user.full_name} ({customer.name})", body=user_in.reason)
    events.audit(session, actor_id=None, action="user.signup_requested", entity="user", entity_id=user.id,
                 new={"email": email, "customer": customer.name})
    session.commit()
    return Message(message="Thank you. Your request was sent to the administrator.")


@router.post("/{user_id}/approve", response_model=UserPublic)
def approve_user(session: SessionDep, admin: AdminUser, user_id: uuid.UUID, body: ApprovalIn) -> Any:
    """
    Admin: approve a self-registered account, optionally with another role or department.
    """
    user = session.get(User, user_id)
    if not user or user.approval_status != ApprovalStatus.pending:
        raise HTTPException(status_code=404, detail="No pending request for this user.")
    if body.role == Role.requester and not (body.customer_id or user.customer_id):
        raise HTTPException(status_code=422, detail="Requesters need a customer / department.")
    user.role = body.role
    user.is_superuser = body.role == Role.admin
    user.customer_id = body.customer_id or user.customer_id
    user.is_active = True
    user.approval_status = ApprovalStatus.approved
    session.add(user)
    events.audit(session, actor_id=admin.id, action="user.approved", entity="user", entity_id=user.id,
                 new={"role": body.role.value})
    session.commit()
    session.refresh(user)
    _tell(user.email, "Your ReportOps account is ready",
          f"Hello {user.full_name}, your account was approved. You can now log in at {settings.FRONTEND_HOST}.")
    return user


@router.post("/{user_id}/reject", response_model=Message)
def reject_user(session: SessionDep, admin: AdminUser, user_id: uuid.UUID, body: RejectionIn) -> Any:
    """
    Admin: turn down a self-registered account. The row is kept for the audit trail.
    """
    user = session.get(User, user_id)
    if not user or user.approval_status != ApprovalStatus.pending:
        raise HTTPException(status_code=404, detail="No pending request for this user.")
    user.approval_status = ApprovalStatus.rejected
    user.is_active = False
    session.add(user)
    events.audit(session, actor_id=admin.id, action="user.rejected", entity="user", entity_id=user.id,
                 new={"reason": body.reason})
    session.commit()
    _tell(user.email, "Your ReportOps account request",
          f"Hello {user.full_name}, your account request was not approved: {body.reason}")
    return Message(message="Request rejected")


def _tell(email: str, subject: str, text: str) -> None:
    if not settings.emails_enabled:
        return
    try:
        send_email(email_to=email, subject=f"[ReportOps] {subject}", html_content=f"<p>{html.escape(text)}</p>")
    except Exception:  # email trouble must not undo the decision
        logging.getLogger(__name__).exception("could not email %s", email)


class DirectoryEntry(SQLModel):
    id: uuid.UUID
    full_name: str | None
    role: Role


@router.get("/directory", response_model=list[DirectoryEntry])
def read_directory(session: SessionDep, _: CurrentUser) -> Any:
    """
    Names and roles of active users, so every screen can show who did what.
    """
    users = session.exec(select(User).where(User.is_active).order_by(col(User.full_name))).all()
    return [DirectoryEntry(id=u.id, full_name=u.full_name or u.email, role=u.role) for u in users]


@router.get("/engineers", response_model=UsersPublic)
def read_engineers(session: SessionDep, current_user: CurrentUser) -> Any:
    """
    Active engineers and managers who can be assigned to requests.
    """
    if current_user.role not in (Role.manager, Role.admin):
        raise HTTPException(status_code=403, detail="Your role cannot do this.")
    statement = (
        select(User)
        .where(col(User.role).in_([Role.engineer, Role.manager]), User.is_active)
        .order_by(col(User.full_name))
    )
    users = session.exec(statement).all()
    return UsersPublic(data=[UserPublic.model_validate(u) for u in users], count=len(users))


@router.get("/{user_id}", response_model=UserPublic)
def read_user_by_id(
    user_id: uuid.UUID, session: SessionDep, current_user: CurrentUser
) -> Any:
    """
    Get a specific user by id.
    """
    user = session.get(User, user_id)
    if user == current_user:
        return user
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=403,
            detail="The user doesn't have enough privileges",
        )
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.patch(
    "/{user_id}",
    dependencies=[Depends(get_current_active_superuser)],
    response_model=UserPublic,
)
def update_user(
    *,
    session: SessionDep,
    user_id: uuid.UUID,
    user_in: UserUpdate,
) -> Any:
    """
    Update a user.
    """

    db_user = session.get(User, user_id)
    if not db_user:
        raise HTTPException(
            status_code=404,
            detail="The user with this id does not exist in the system",
        )
    if user_in.email:
        existing_user = crud.get_user_by_email(session=session, email=user_in.email)
        if existing_user and existing_user.id != user_id:
            raise HTTPException(
                status_code=409, detail="User with this email already exists"
            )

    db_user = crud.update_user(session=session, db_user=db_user, user_in=user_in)
    return db_user


@router.delete("/{user_id}", dependencies=[Depends(get_current_active_superuser)])
def delete_user(
    session: SessionDep, current_user: CurrentUser, user_id: uuid.UUID
) -> Message:
    """
    Delete a user.
    """
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user == current_user:
        raise HTTPException(
            status_code=403, detail="Super users are not allowed to delete themselves"
        )
    # Users are never hard-deleted: history and reports must stay correct.
    user.is_active = False
    session.add(user)
    session.commit()
    return Message(message="User deactivated")
