from sqlmodel import Session, create_engine, select

from app import crud
from app.core.config import settings
from app.core.workflow_rules import SEED_TRANSITIONS
from app.models import (
    AppSetting,
    Domain,
    Priority,
    RequestType,
    Role,
    SlaPolicy,
    Status,
    User,
    UserCreate,
    WorkflowTransition,
)
from app.services.sla import DEFAULT_CALENDAR_SETTINGS

engine = create_engine(str(settings.DATABASE_URL), pool_pre_ping=True)

# make sure all SQLModel models are imported (app.models) before initializing DB
# otherwise, SQLModel might fail to initialize relationships properly
# for more details: https://github.com/fastapi/full-stack-fastapi-template/issues/28

DOMAINS = ["RAN", "Transmission", "Datacomm", "Core", "Operation", "Benchmarking"]
REQUEST_TYPES = ["New Report", "Report Change", "Data Fix / Correction"]
# Starting SLA targets from PRD v1.1, in working minutes (8 working hours a day).
SLA_TARGETS = {
    Priority.critical: (120, 480),
    Priority.high: (240, 1440),
    Priority.medium: (480, 2400),
    Priority.low: (960, 4800),
}


def init_db(session: Session) -> None:
    """Create the first admin and seed reference data. Safe to run many times."""
    user = session.exec(
        select(User).where(User.email == settings.FIRST_SUPERUSER)
    ).first()
    if not user:
        user_in = UserCreate(
            email=settings.FIRST_SUPERUSER,
            password=settings.FIRST_SUPERUSER_PASSWORD,
            is_superuser=True,
            role=Role.admin,
            full_name="Administrator",
        )
        crud.create_user(session=session, user_create=user_in)

    for i, name in enumerate(DOMAINS):
        if not session.exec(select(Domain).where(Domain.name == name)).first():
            session.add(Domain(name=name, sort_order=i))
    for i, name in enumerate(REQUEST_TYPES):
        if not session.exec(select(RequestType).where(RequestType.name == name)).first():
            session.add(RequestType(name=name, sort_order=i))

    for prio, (resp, res) in SLA_TARGETS.items():
        exists = session.exec(
            select(SlaPolicy).where(
                SlaPolicy.priority == prio,
                SlaPolicy.category == None,  # noqa: E711
                SlaPolicy.contract_type == None,  # noqa: E711
                SlaPolicy.request_type_id == None,  # noqa: E711
            )
        ).first()
        if not exists:
            session.add(SlaPolicy(name=f"{prio.value.title()} - default", priority=prio,
                                  response_target_min=resp, resolution_target_min=res))

    for key, value in DEFAULT_CALENDAR_SETTINGS.items():
        if session.get(AppSetting, key) is None:
            session.add(AppSetting(key=key, value=value))

    if not session.exec(select(WorkflowTransition)).first():
        for r in SEED_TRANSITIONS:
            session.add(WorkflowTransition(
                action=r.action, from_status=Status(r.from_status), to_status=Status(r.to_status),
                allowed_roles=list(r.allowed_roles), requires_reason=r.requires_reason,
                guard=",".join(r.guards) or None,
            ))
    session.commit()
