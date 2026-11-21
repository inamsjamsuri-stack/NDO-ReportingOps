from datetime import UTC, datetime, timedelta
from typing import Any

from sqlmodel import Session, select

from app.core.security import get_password_hash, verify_password
from app.models import Role, User, UserCreate, UserUpdate

MAX_FAILED_LOGINS = 5
LOCK_MINUTES = 15


def create_user(*, session: Session, user_create: UserCreate) -> User:
    db_obj = User.model_validate(
        user_create, update={"hashed_password": get_password_hash(user_create.password)}
    )
    db_obj.is_superuser = db_obj.is_superuser or db_obj.role == Role.admin
    if db_obj.is_superuser:
        db_obj.role = Role.admin
    session.add(db_obj)
    session.commit()
    session.refresh(db_obj)
    return db_obj


def update_user(*, session: Session, db_user: User, user_in: UserUpdate) -> Any:
    user_data = user_in.model_dump(exclude_unset=True)
    extra_data = {}
    if "password" in user_data:
        password = user_data["password"]
        hashed_password = get_password_hash(password)
        extra_data["hashed_password"] = hashed_password
    db_user.sqlmodel_update(user_data, update=extra_data)
    if "role" in user_data or "is_superuser" in user_data:
        if "role" in user_data:
            db_user.is_superuser = db_user.role == Role.admin
        elif db_user.is_superuser:
            db_user.role = Role.admin
    session.add(db_user)
    session.commit()
    session.refresh(db_user)
    return db_user


def get_user_by_email(*, session: Session, email: str) -> User | None:
    statement = select(User).where(User.email == email)
    session_user = session.exec(statement).first()
    return session_user


# Dummy hash to use for timing attack prevention when user is not found
# This is an Argon2 hash of a random password, used to ensure constant-time comparison
DUMMY_HASH = "$argon2id$v=19$m=65536,t=3,p=4$MjQyZWE1MzBjYjJlZTI0Yw$YTU4NGM5ZTZmYjE2NzZlZjY0ZWY3ZGRkY2U2OWFjNjk"


def authenticate(*, session: Session, email: str, password: str) -> User | None:
    db_user = get_user_by_email(session=session, email=email)
    if not db_user:
        # Prevent timing attacks by running password verification even when user doesn't exist
        # This ensures the response time is similar whether or not the email exists
        verify_password(password, DUMMY_HASH)
        return None
    now = datetime.now(UTC)
    if db_user.locked_until and db_user.locked_until > now:
        verify_password(password, DUMMY_HASH)
        return None
    if not db_user.hashed_password:  # account uses LDAP/SSO (later phase)
        verify_password(password, DUMMY_HASH)
        return None
    verified, updated_password_hash = verify_password(password, db_user.hashed_password)
    if not verified:
        db_user.failed_login_count += 1
        if db_user.failed_login_count >= MAX_FAILED_LOGINS:
            db_user.locked_until = now + timedelta(minutes=LOCK_MINUTES)
            db_user.failed_login_count = 0
        session.add(db_user)
        session.commit()
        return None
    db_user.failed_login_count = 0
    db_user.locked_until = None
    db_user.last_login_at = now
    session.add(db_user)
    session.commit()
    if updated_password_hash:
        db_user.hashed_password = updated_password_hash
        session.add(db_user)
        session.commit()
        session.refresh(db_user)
    return db_user
