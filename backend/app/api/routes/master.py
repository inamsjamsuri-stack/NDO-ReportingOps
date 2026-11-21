"""Master data lists the Admin edits: customers, domains, request types,
data sources. Everyone signed in can read the active entries."""

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException
from sqlmodel import SQLModel, col, select

from app.api.deps import AdminUser, CurrentUser, SessionDep
from app.models import (
    Customer,
    DataSource,
    Domain,
    MasterCreate,
    MasterPublic,
    MasterUpdate,
    RequestType,
)
from app.services import events

router = APIRouter(prefix="/master", tags=["master"])

TABLES: dict[str, type[SQLModel]] = {
    "customers": Customer,
    "domains": Domain,
    "request-types": RequestType,
    "data-sources": DataSource,
}


def _model(kind: str) -> Any:
    model = TABLES.get(kind)
    if model is None:
        raise HTTPException(status_code=404, detail="Unknown list")
    return model


@router.get("/{kind}", response_model=list[MasterPublic])
def list_entries(kind: str, session: SessionDep, _: CurrentUser, include_inactive: bool = False) -> Any:
    model = _model(kind)
    stmt = select(model)
    if not include_inactive:
        stmt = stmt.where(model.is_active)
    return session.exec(stmt.order_by(col(model.sort_order), col(model.name))).all()


@router.post("/{kind}", response_model=MasterPublic)
def create_entry(kind: str, body: MasterCreate, session: SessionDep, admin: AdminUser) -> Any:
    model = _model(kind)
    if session.exec(select(model).where(model.name == body.name)).first():
        raise HTTPException(status_code=409, detail="An entry with this name already exists.")
    data = body.model_dump(exclude_none=True)
    if model is not Customer:
        data.pop("kind", None)
        data.pop("code", None)
    obj = model(**data)
    session.add(obj)
    events.audit(session, actor_id=admin.id, action=f"master.{kind}.created", entity=kind,
                 entity_id=obj.id, new=body.model_dump(mode="json"))
    session.commit()
    session.refresh(obj)
    return obj


@router.patch("/{kind}/{entry_id}", response_model=MasterPublic)
def update_entry(kind: str, entry_id: uuid.UUID, body: MasterUpdate, session: SessionDep,
                 admin: AdminUser) -> Any:
    model = _model(kind)
    obj = session.get(model, entry_id)
    if obj is None:
        raise HTTPException(status_code=404, detail="Entry not found")
    changes = body.model_dump(exclude_unset=True)
    if model is not Customer:
        changes.pop("kind", None)
        changes.pop("code", None)
    old = {k: str(getattr(obj, k)) for k in changes}
    for k, v in changes.items():
        setattr(obj, k, v)
    obj.updated_at = datetime.now(UTC)
    session.add(obj)
    events.audit(session, actor_id=admin.id, action=f"master.{kind}.updated", entity=kind,
                 entity_id=entry_id, old=old, new={k: str(v) for k, v in changes.items()})
    session.commit()
    session.refresh(obj)
    return obj
