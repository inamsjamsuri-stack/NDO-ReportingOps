"""ReportOps data model.

Tables follow docs/ "Database Schema & Workflow Rules". All times are UTC
(``timestamptz``); hours are ``numeric(6,2)``. Fixed value lists are stored as
VARCHAR with a CHECK constraint (``native_enum=False``) so adding a value is a
small migration.
"""

import uuid
from datetime import UTC, date, datetime
from decimal import Decimal
from enum import StrEnum
from typing import Any

import sqlalchemy as sa
from pydantic import EmailStr
from sqlalchemy.dialects.postgresql import ARRAY, INET, JSONB
from sqlmodel import Column, Field, SQLModel


def get_datetime_utc() -> datetime:
    return datetime.now(UTC)


def _enum(enum_cls: type[StrEnum], name: str) -> sa.Enum:
    return sa.Enum(
        enum_cls,
        name=name,
        native_enum=False,
        create_constraint=True,
        length=32,
        values_callable=lambda e: [m.value for m in e],
        validate_strings=True,
    )


def _ts(**kw: Any) -> Any:
    return Field(sa_type=sa.DateTime(timezone=True), **kw)


def _hours(**kw: Any) -> Any:
    return Field(sa_type=sa.Numeric(6, 2), **kw)


# ---------------------------------------------------------------------------
# Fixed value lists
# ---------------------------------------------------------------------------


class Role(StrEnum):
    admin = "admin"
    manager = "manager"
    engineer = "engineer"
    requester = "requester"


class Status(StrEnum):
    submitted = "submitted"
    under_assessment = "under_assessment"
    approved = "approved"
    assigned = "assigned"
    in_progress = "in_progress"
    under_review = "under_review"
    completed = "completed"
    rejected = "rejected"
    on_hold = "on_hold"
    cancelled = "cancelled"


OPEN_STATUSES = (
    Status.submitted,
    Status.under_assessment,
    Status.approved,
    Status.assigned,
)
IN_PROGRESS_STATUSES = (Status.in_progress, Status.under_review)
CLOSED_STATUSES = (Status.completed, Status.cancelled, Status.rejected)


class Priority(StrEnum):
    critical = "critical"
    high = "high"
    medium = "medium"
    low = "low"


class Category(StrEnum):
    regular = "regular"
    ad_hoc = "ad_hoc"


class Frequency(StrEnum):
    daily = "daily"
    weekly = "weekly"
    monthly = "monthly"
    one_time = "one_time"


class AssignmentRole(StrEnum):
    primary = "primary"
    supporting = "supporting"


class Level(StrEnum):
    L1 = "L1"
    L2 = "L2"


class AutomationStatus(StrEnum):
    fully_automated = "fully_automated"
    hybrid = "hybrid"
    manual = "manual"


class Visibility(StrEnum):
    public = "public"
    internal = "internal"


class CustomerKind(StrEnum):
    external = "external"
    internal = "internal"


class HolidayKind(StrEnum):
    national = "national"
    cuti_bersama = "cuti_bersama"
    company = "company"


class ApprovalStatus(StrEnum):
    approved = "approved"
    pending = "pending"  # self-registered, waiting for an admin
    rejected = "rejected"


class SlaCalendar(StrEnum):
    working = "working"
    always = "24x7"


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------


class UserBase(SQLModel):
    email: EmailStr = Field(unique=True, index=True, max_length=255)
    is_active: bool = True
    is_superuser: bool = False  # kept in sync with role == admin
    full_name: str | None = Field(default=None, max_length=255)
    role: Role = Field(default=Role.requester, sa_type=_enum(Role, "role"))
    customer_id: uuid.UUID | None = Field(default=None, foreign_key="customer.id")


class UserCreate(UserBase):
    password: str = Field(min_length=8, max_length=128)


class UserRegister(SQLModel):
    """Self-registration by a requester. The account stays inactive until an
    admin approves it."""

    email: EmailStr = Field(max_length=255)
    password: str = Field(min_length=8, max_length=128)
    full_name: str = Field(min_length=2, max_length=255)
    customer_id: uuid.UUID
    reason: str | None = Field(default=None, max_length=500)  # why they need access


class ApprovalIn(SQLModel):
    role: Role = Role.requester
    customer_id: uuid.UUID | None = None


class RejectionIn(SQLModel):
    reason: str = Field(min_length=3, max_length=500)


class UserUpdate(SQLModel):
    email: EmailStr | None = Field(default=None, max_length=255)
    is_active: bool | None = None
    is_superuser: bool | None = None
    full_name: str | None = Field(default=None, max_length=255)
    password: str | None = Field(default=None, min_length=8, max_length=128)
    role: Role | None = None
    customer_id: uuid.UUID | None = None


class UserUpdateMe(SQLModel):
    full_name: str | None = Field(default=None, max_length=255)
    email: EmailStr | None = Field(default=None, max_length=255)


class UpdatePassword(SQLModel):
    current_password: str = Field(min_length=8, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class User(UserBase, table=True):
    __tablename__ = "app_user"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    hashed_password: str | None = None  # null when LDAP/SSO is used later
    approval_status: ApprovalStatus = Field(
        default=ApprovalStatus.approved, sa_type=_enum(ApprovalStatus, "approval_status")
    )
    registration_note: str | None = Field(default=None, max_length=500)
    failed_login_count: int = 0
    locked_until: datetime | None = _ts(default=None)
    last_login_at: datetime | None = _ts(default=None)
    created_at: datetime | None = _ts(default_factory=get_datetime_utc)
    updated_at: datetime | None = _ts(default_factory=get_datetime_utc)


class UserPublic(UserBase):
    id: uuid.UUID
    approval_status: ApprovalStatus = ApprovalStatus.approved
    registration_note: str | None = None
    created_at: datetime | None = None


class UsersPublic(SQLModel):
    data: list[UserPublic]
    count: int


# ---------------------------------------------------------------------------
# Master data
# ---------------------------------------------------------------------------


class MasterBase(SQLModel):
    name: str = Field(max_length=150, unique=True)
    sort_order: int = 0
    is_active: bool = True


class MasterTimestamps(SQLModel):
    created_at: datetime | None = _ts(default_factory=get_datetime_utc)
    updated_at: datetime | None = _ts(default_factory=get_datetime_utc)


class Customer(MasterBase, MasterTimestamps, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    kind: CustomerKind = Field(
        default=CustomerKind.internal, sa_type=_enum(CustomerKind, "customer_kind")
    )
    code: str | None = Field(default=None, max_length=30)


class Domain(MasterBase, MasterTimestamps, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)


class RequestType(MasterBase, MasterTimestamps, table=True):
    __tablename__ = "request_type"
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)


class DataSource(MasterBase, MasterTimestamps, table=True):
    __tablename__ = "data_source"
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)


class MasterCreate(MasterBase):
    kind: CustomerKind | None = None  # customer only
    code: str | None = None  # customer only


class MasterUpdate(SQLModel):
    name: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None
    kind: CustomerKind | None = None
    code: str | None = None


class MasterPublic(MasterBase):
    id: uuid.UUID
    kind: CustomerKind | None = None
    code: str | None = None


# ---------------------------------------------------------------------------
# Report catalog
# ---------------------------------------------------------------------------


class ReportBase(SQLModel):
    name: str = Field(max_length=200)
    customer_id: uuid.UUID = Field(foreign_key="customer.id")
    domain_id: uuid.UUID = Field(foreign_key="domain.id")
    frequency: Frequency = Field(sa_type=_enum(Frequency, "frequency"))
    data_source_id: uuid.UUID | None = Field(default=None, foreign_key="data_source.id")
    data_source_note: str | None = None
    owner_id: uuid.UUID | None = Field(default=None, foreign_key="app_user.id")
    automation_status: AutomationStatus = Field(
        default=AutomationStatus.manual,
        sa_type=_enum(AutomationStatus, "automation_status"),
    )
    manual_effort_hours: Decimal | None = _hours(default=None)
    automation_blocker: str | None = None
    automation_conditions: str | None = None
    is_active: bool = True


class Report(ReportBase, table=True):
    __table_args__ = (
        sa.UniqueConstraint("name", "customer_id", name="uq_report_name_customer"),
        sa.CheckConstraint(
            "automation_status = 'fully_automated' OR ("
            "manual_effort_hours IS NOT NULL AND automation_blocker IS NOT NULL "
            "AND automation_conditions IS NOT NULL)",
            name="ck_report_automation_fields",
        ),
    )
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    code: str = Field(
        unique=True,
        max_length=20,
        sa_column_kwargs={"server_default": sa.text("'RC-' || lpad(nextval('report_code_seq')::text, 4, '0')")},
    )
    created_at: datetime | None = _ts(default_factory=get_datetime_utc)
    updated_at: datetime | None = _ts(default_factory=get_datetime_utc)
    created_by_id: uuid.UUID | None = Field(default=None, foreign_key="app_user.id")


class ReportCreate(ReportBase):
    pass


class ReportUpdate(SQLModel):
    name: str | None = None
    domain_id: uuid.UUID | None = None
    frequency: Frequency | None = None
    data_source_id: uuid.UUID | None = None
    data_source_note: str | None = None
    owner_id: uuid.UUID | None = None
    automation_status: AutomationStatus | None = None
    manual_effort_hours: Decimal | None = None
    automation_blocker: str | None = None
    automation_conditions: str | None = None
    is_active: bool | None = None


class ReportPublic(ReportBase):
    id: uuid.UUID
    code: str


# ---------------------------------------------------------------------------
# Request
# ---------------------------------------------------------------------------


class RequestSequence(SQLModel, table=True):
    __tablename__ = "request_sequence"
    year: int = Field(primary_key=True)
    last_number: int = 0


class RequestCreate(SQLModel):
    title: str = Field(min_length=3, max_length=150)
    requester_id: uuid.UUID | None = None  # manager may submit on behalf
    customer_id: uuid.UUID
    category: Category
    request_type_id: uuid.UUID
    domain_id: uuid.UUID
    report_id: uuid.UUID | None = None
    report_name: str | None = Field(default=None, max_length=200)
    frequency: Frequency
    business_purpose: str = Field(min_length=10)
    priority: Priority
    required_date: date


class RequestUpdate(SQLModel):
    """Fields the requester may change while Submitted, or a manager later."""

    title: str | None = Field(default=None, min_length=3, max_length=150)
    customer_id: uuid.UUID | None = None
    category: Category | None = None
    request_type_id: uuid.UUID | None = None
    domain_id: uuid.UUID | None = None
    report_id: uuid.UUID | None = None
    report_name: str | None = None
    frequency: Frequency | None = None
    business_purpose: str | None = None
    priority: Priority | None = None
    required_date: date | None = None
    committed_date: date | None = None
    committed_late_reason: str | None = None
    estimated_hours: Decimal | None = Field(default=None, ge=0)


MANAGER_ONLY_FIELDS = {
    "estimated_hours",
    "priority",
    "committed_date",
    "committed_late_reason",
    "domain_id",
}


class Request(SQLModel, table=True):
    __table_args__ = (
        # A one-time report is always an ad hoc request.
        sa.CheckConstraint(
            "frequency <> 'one_time' OR category = 'ad_hoc'", name="ck_request_one_time_ad_hoc"
        ),
    )
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    code: str = Field(unique=True, max_length=20)
    title: str = Field(max_length=150)
    requester_id: uuid.UUID = Field(foreign_key="app_user.id", index=True)
    submitted_by_id: uuid.UUID = Field(foreign_key="app_user.id")
    customer_id: uuid.UUID = Field(foreign_key="customer.id", index=True)
    category: Category = Field(sa_type=_enum(Category, "category"))
    request_type_id: uuid.UUID = Field(foreign_key="request_type.id")
    domain_id: uuid.UUID = Field(foreign_key="domain.id", index=True)
    report_id: uuid.UUID | None = Field(default=None, foreign_key="report.id")
    report_name: str | None = Field(default=None, max_length=200)
    frequency: Frequency = Field(sa_type=_enum(Frequency, "frequency"))
    business_purpose: str
    priority: Priority = Field(sa_type=_enum(Priority, "priority"))
    required_date: date
    committed_date: date | None = None
    committed_late_reason: str | None = None
    estimated_hours: Decimal | None = _hours(default=None)
    status: Status = Field(
        default=Status.submitted, sa_type=_enum(Status, "status"), index=True
    )
    status_before_hold: Status | None = Field(
        default=None, sa_type=_enum(Status, "status_before_hold")
    )
    assessment_note: str | None = None
    submitted_at: datetime = _ts(default_factory=get_datetime_utc, index=True)
    completed_at: datetime | None = _ts(default=None, index=True)
    is_overdue: bool = False
    created_at: datetime | None = _ts(default_factory=get_datetime_utc)
    updated_at: datetime | None = _ts(default_factory=get_datetime_utc)


class RequestPublic(SQLModel):
    id: uuid.UUID
    code: str
    title: str
    requester_id: uuid.UUID
    submitted_by_id: uuid.UUID
    customer_id: uuid.UUID
    category: Category
    request_type_id: uuid.UUID
    domain_id: uuid.UUID
    report_id: uuid.UUID | None
    report_name: str | None
    frequency: Frequency
    business_purpose: str
    priority: Priority
    required_date: date
    committed_date: date | None
    committed_late_reason: str | None
    estimated_hours: Decimal | None
    status: Status
    assessment_note: str | None
    submitted_at: datetime
    completed_at: datetime | None
    is_overdue: bool


class RequestsPublic(SQLModel):
    data: list[RequestPublic]
    count: int


# ---------------------------------------------------------------------------
# Assignment and time log
# ---------------------------------------------------------------------------


class Assignment(SQLModel, table=True):
    __table_args__ = (
        sa.Index(
            "uq_assignment_one_primary",
            "request_id",
            unique=True,
            postgresql_where=sa.text("assignment_role = 'primary' AND is_active"),
        ),
        sa.Index(
            "uq_assignment_engineer_active",
            "request_id",
            "engineer_id",
            unique=True,
            postgresql_where=sa.text("is_active"),
        ),
    )
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    request_id: uuid.UUID = Field(foreign_key="request.id", index=True)
    engineer_id: uuid.UUID = Field(foreign_key="app_user.id", index=True)
    assignment_role: AssignmentRole = Field(
        sa_type=_enum(AssignmentRole, "assignment_role")
    )
    level: Level = Field(sa_type=_enum(Level, "level"))
    estimated_hours: Decimal = _hours(default=Decimal("0"))
    is_active: bool = True
    assigned_at: datetime = _ts(default_factory=get_datetime_utc)
    assigned_by_id: uuid.UUID = Field(foreign_key="app_user.id")
    released_at: datetime | None = _ts(default=None)
    released_by_id: uuid.UUID | None = Field(default=None, foreign_key="app_user.id")


class AssignmentCreate(SQLModel):
    engineer_id: uuid.UUID
    assignment_role: AssignmentRole
    level: Level
    estimated_hours: Decimal = Field(default=Decimal("0"), ge=0)


class AssignmentPublic(SQLModel):
    id: uuid.UUID
    request_id: uuid.UUID
    engineer_id: uuid.UUID
    assignment_role: AssignmentRole
    level: Level
    estimated_hours: Decimal
    is_active: bool
    assigned_at: datetime
    released_at: datetime | None
    actual_hours: Decimal = Decimal("0")


class TimeLog(SQLModel, table=True):
    __tablename__ = "time_log"
    __table_args__ = (
        sa.CheckConstraint("hours > 0 AND hours <= 24", name="ck_time_log_hours"),
    )
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    assignment_id: uuid.UUID = Field(foreign_key="assignment.id", index=True)
    work_date: date
    hours: Decimal = Field(sa_type=sa.Numeric(5, 2))
    note: str | None = Field(default=None, max_length=300)
    created_at: datetime = _ts(default_factory=get_datetime_utc)
    updated_at: datetime = _ts(default_factory=get_datetime_utc)


class TimeLogCreate(SQLModel):
    work_date: date
    hours: Decimal = Field(gt=0, le=24)
    note: str | None = Field(default=None, max_length=300)


class TimeLogPublic(TimeLogCreate):
    id: uuid.UUID
    assignment_id: uuid.UUID
    created_at: datetime


# ---------------------------------------------------------------------------
# Workflow
# ---------------------------------------------------------------------------


class WorkflowTransition(SQLModel, table=True):
    __tablename__ = "workflow_transition"
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    action: str = Field(max_length=40)
    from_status: Status = Field(sa_type=_enum(Status, "from_status"))
    to_status: Status = Field(sa_type=_enum(Status, "to_status"))
    allowed_roles: list[str] = Field(sa_column=Column(ARRAY(sa.String(16)), nullable=False))
    requires_reason: bool = False
    guard: str | None = Field(default=None, max_length=200)  # comma separated
    is_active: bool = True


class StatusHistory(SQLModel, table=True):
    __tablename__ = "status_history"
    __table_args__ = (sa.Index("ix_status_history_request_time", "request_id", "changed_at"),)
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    request_id: uuid.UUID = Field(foreign_key="request.id")
    from_status: Status | None = Field(default=None, sa_type=_enum(Status, "from_status"))
    to_status: Status = Field(sa_type=_enum(Status, "to_status"))
    action: str = Field(max_length=40)
    reason: str | None = None
    changed_by_id: uuid.UUID = Field(foreign_key="app_user.id")
    changed_at: datetime = _ts(default_factory=get_datetime_utc)


class StatusHistoryPublic(SQLModel):
    id: uuid.UUID
    from_status: Status | None
    to_status: Status
    action: str
    reason: str | None
    changed_by_id: uuid.UUID
    changed_at: datetime


class TransitionIn(SQLModel):
    action: str
    reason: str | None = None


# ---------------------------------------------------------------------------
# SLA
# ---------------------------------------------------------------------------


class SlaPolicy(SQLModel, table=True):
    __tablename__ = "sla_policy"
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    name: str = Field(max_length=100)
    priority: Priority = Field(sa_type=_enum(Priority, "priority"))
    category: Category | None = Field(default=None, sa_type=_enum(Category, "category"))
    request_type_id: uuid.UUID | None = Field(default=None, foreign_key="request_type.id")
    response_target_min: int = Field(gt=0)
    resolution_target_min: int = Field(gt=0)
    calendar: SlaCalendar = Field(
        default=SlaCalendar.working, sa_type=_enum(SlaCalendar, "sla_calendar")
    )
    is_active: bool = True


class SlaPolicyCreate(SQLModel):
    name: str
    priority: Priority
    category: Category | None = None
    request_type_id: uuid.UUID | None = None
    response_target_min: int = Field(gt=0)
    resolution_target_min: int = Field(gt=0)
    calendar: SlaCalendar = SlaCalendar.working
    is_active: bool = True


class Holiday(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    day: date = Field(unique=True)  # "date" would shadow the type name
    name: str = Field(max_length=150)
    kind: HolidayKind = Field(
        default=HolidayKind.national, sa_type=_enum(HolidayKind, "holiday_kind")
    )


class HolidayCreate(SQLModel):
    day: date
    name: str
    kind: HolidayKind = HolidayKind.national


class AppSetting(SQLModel, table=True):
    __tablename__ = "app_setting"
    key: str = Field(primary_key=True, max_length=60)
    value: Any = Field(sa_column=Column(JSONB, nullable=False))


class RequestSla(SQLModel, table=True):
    __tablename__ = "request_sla"
    request_id: uuid.UUID = Field(foreign_key="request.id", primary_key=True)
    sla_policy_id: uuid.UUID | None = Field(default=None, foreign_key="sla_policy.id")
    response_due_at: datetime | None = _ts(default=None)
    responded_at: datetime | None = _ts(default=None)
    resolution_due_at: datetime | None = _ts(default=None)
    resolved_at: datetime | None = _ts(default=None)
    paused_min: int = 0
    waiting_requester_min: int = 0
    resolution_min: int | None = None
    resolution_target_min: int | None = None
    resolution_used_min: int | None = None  # working minutes used so far (minus hold)
    is_at_risk: bool = False
    is_breached: bool = False


class RequestSlaPublic(SQLModel):
    sla_policy_id: uuid.UUID | None
    response_due_at: datetime | None
    responded_at: datetime | None
    resolution_due_at: datetime | None
    resolved_at: datetime | None
    paused_min: int
    resolution_min: int | None
    resolution_target_min: int | None
    resolution_used_min: int | None
    is_at_risk: bool
    is_breached: bool


# ---------------------------------------------------------------------------
# Comments, files, activity, notifications, audit
# ---------------------------------------------------------------------------


class Comment(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    request_id: uuid.UUID = Field(foreign_key="request.id", index=True)
    author_id: uuid.UUID = Field(foreign_key="app_user.id")
    visibility: Visibility = Field(
        default=Visibility.public, sa_type=_enum(Visibility, "visibility")
    )
    body: str
    edited_at: datetime | None = _ts(default=None)
    deleted_at: datetime | None = _ts(default=None)
    deleted_by_id: uuid.UUID | None = Field(default=None, foreign_key="app_user.id")
    created_at: datetime = _ts(default_factory=get_datetime_utc)


class CommentCreate(SQLModel):
    body: str = Field(min_length=1)
    visibility: Visibility = Visibility.public


class CommentPublic(SQLModel):
    id: uuid.UUID
    author_id: uuid.UUID
    visibility: Visibility
    body: str
    edited_at: datetime | None
    deleted_at: datetime | None
    created_at: datetime


class Attachment(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    request_id: uuid.UUID = Field(foreign_key="request.id", index=True)
    comment_id: uuid.UUID | None = Field(default=None, foreign_key="comment.id")
    file_name: str = Field(max_length=255)
    storage_path: str = Field(max_length=500)
    mime_type: str = Field(max_length=120)
    size_bytes: int = Field(sa_type=sa.BigInteger)
    sha256: str = Field(max_length=64)
    is_output: bool = False
    visibility: Visibility = Field(
        default=Visibility.public, sa_type=_enum(Visibility, "visibility")
    )
    uploaded_by_id: uuid.UUID = Field(foreign_key="app_user.id")
    created_at: datetime = _ts(default_factory=get_datetime_utc)


class AttachmentPublic(SQLModel):
    id: uuid.UUID
    file_name: str
    mime_type: str
    size_bytes: int
    is_output: bool
    visibility: Visibility
    uploaded_by_id: uuid.UUID
    created_at: datetime


class Activity(SQLModel, table=True):
    __table_args__ = (sa.Index("ix_activity_request_time", "request_id", sa.text("created_at DESC")),)
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    request_id: uuid.UUID = Field(foreign_key="request.id")
    actor_id: uuid.UUID | None = Field(default=None, foreign_key="app_user.id")
    kind: str = Field(max_length=40)
    data: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB, nullable=False))
    visibility: Visibility = Field(
        default=Visibility.public, sa_type=_enum(Visibility, "visibility")
    )
    created_at: datetime = _ts(default_factory=get_datetime_utc)


class ActivityPublic(SQLModel):
    id: uuid.UUID
    actor_id: uuid.UUID | None
    kind: str
    data: dict[str, Any]
    visibility: Visibility
    created_at: datetime


class Notification(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID = Field(foreign_key="app_user.id", index=True)
    request_id: uuid.UUID | None = Field(default=None, foreign_key="request.id")
    event: str = Field(max_length=40)
    title: str = Field(max_length=200)
    body: str | None = None
    read_at: datetime | None = _ts(default=None)
    email_status: str = Field(default="not_needed", max_length=20)
    created_at: datetime = _ts(default_factory=get_datetime_utc)


class NotificationPublic(SQLModel):
    id: uuid.UUID
    request_id: uuid.UUID | None
    event: str
    title: str
    body: str | None
    read_at: datetime | None
    created_at: datetime


class NotificationPreference(SQLModel, table=True):
    __tablename__ = "notification_preference"
    user_id: uuid.UUID = Field(foreign_key="app_user.id", primary_key=True)
    event: str = Field(primary_key=True, max_length=40)
    email_enabled: bool = True


class AuditLog(SQLModel, table=True):
    __tablename__ = "audit_log"
    id: int | None = Field(default=None, sa_column=Column(sa.BigInteger, sa.Identity(), primary_key=True))
    at: datetime = _ts(default_factory=get_datetime_utc)
    actor_id: uuid.UUID | None = None
    action: str = Field(max_length=60)
    entity: str | None = Field(default=None, max_length=40)
    entity_id: uuid.UUID | None = None
    old_value: Any | None = Field(default=None, sa_column=Column(JSONB))
    new_value: Any | None = Field(default=None, sa_column=Column(JSONB))
    ip_address: str | None = Field(default=None, sa_column=Column(INET))


class WebhookOutbox(SQLModel, table=True):
    __tablename__ = "webhook_outbox"
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    event: str = Field(max_length=40)
    payload: dict[str, Any] = Field(sa_column=Column(JSONB, nullable=False))
    created_at: datetime = _ts(default_factory=get_datetime_utc)
    sent_at: datetime | None = _ts(default=None)
    attempts: int = 0


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------


class CountItem(SQLModel):
    name: str
    count: int


class DashboardOut(SQLModel):
    total_incoming: int
    open: int
    in_progress: int
    on_hold: int
    completed: int
    overdue: int
    avg_resolution_hours: float | None
    median_resolution_hours: float | None
    sla_compliance_pct: float | None
    by_domain: list[CountItem]
    by_category: list[CountItem]


# ---------------------------------------------------------------------------
# Generic
# ---------------------------------------------------------------------------


class Message(SQLModel):
    message: str


class Token(SQLModel):
    access_token: str
    token_type: str = "bearer"


class TokenPayload(SQLModel):
    sub: str | None = None


class NewPassword(SQLModel):
    token: str
    new_password: str = Field(min_length=8, max_length=128)
