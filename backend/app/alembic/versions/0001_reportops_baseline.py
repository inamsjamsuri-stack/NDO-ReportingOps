"""ReportOps baseline: all 23 tables, the report code sequence and the
audit-log write protection.

Revision ID: 0001_reportops_baseline
Revises:
Create Date: 2026-11-21

Note: this baseline builds the tables from the models as they are today
(`SQLModel.metadata.create_all`). Before the first pilot install, run
`alembic revision --autogenerate` on an empty database and replace this
file with the generated one, so later model changes cannot alter what this
revision creates. All later changes must be new, normal migrations.
"""

import sqlalchemy as sa
from alembic import op
from sqlmodel import SQLModel

import app.models  # noqa: F401  (registers every table on SQLModel.metadata)

revision = "0001_reportops_baseline"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    op.execute(sa.text("CREATE SEQUENCE IF NOT EXISTS report_code_seq"))
    SQLModel.metadata.create_all(bind)
    # Overdue dashboard query: open requests by committed date.
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_request_committed_open ON request (committed_date) "
        "WHERE status NOT IN ('completed', 'cancelled', 'rejected')"
    ))
    # Inbox search on code, title and report name.
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_request_search ON request USING gin "
        "(to_tsvector('simple', code || ' ' || title || ' ' || coalesce(report_name, '')))"
    ))
    # The audit log is insert-only for the app's own database user.
    op.execute(sa.text("REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM PUBLIC"))
    op.execute(sa.text(
        "CREATE OR REPLACE FUNCTION audit_log_read_only() RETURNS trigger AS $$ "
        "BEGIN RAISE EXCEPTION '% is insert-only', TG_TABLE_NAME; END; $$ LANGUAGE plpgsql"
    ))
    op.execute(sa.text(
        "CREATE TRIGGER audit_log_no_change BEFORE UPDATE OR DELETE ON audit_log "
        "FOR EACH ROW EXECUTE FUNCTION audit_log_read_only()"
    ))
    # status_history and activity are insert-only too.
    for table in ("status_history", "activity"):
        op.execute(sa.text(
            f"CREATE TRIGGER {table}_no_change BEFORE UPDATE OR DELETE ON {table} "
            "FOR EACH ROW EXECUTE FUNCTION audit_log_read_only()"
        ))


def downgrade() -> None:
    bind = op.get_bind()
    SQLModel.metadata.drop_all(bind)
    op.execute(sa.text("DROP FUNCTION IF EXISTS audit_log_read_only()"))
    op.execute(sa.text("DROP SEQUENCE IF EXISTS report_code_seq"))
