"""End-to-end request flow against a real PostgreSQL (run inside the stack):
    podman compose exec backend bash scripts/tests-start.sh
"""

from datetime import date, timedelta

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app import crud
from app.core.config import settings
from app.models import Customer, Domain, RequestType, Role, StatusHistory, UserCreate
from tests.utils.user import user_authentication_headers
from tests.utils.utils import random_email, random_lower_string

API = settings.API_V1_STR


def _user(client: TestClient, db: Session, role: Role, customer_id: object = None) -> tuple[dict[str, str], str]:
    email, password = random_email(), random_lower_string()
    u = crud.create_user(session=db, user_create=UserCreate(
        email=email, password=password, role=role, full_name=role.value, customer_id=customer_id))
    return user_authentication_headers(client=client, email=email, password=password), str(u.id)


def _master(db: Session) -> tuple[str, str, str]:
    cust = Customer(name=f"Cust {random_lower_string()[:8]}")
    db.add(cust)
    db.commit()
    domain = db.exec(select(Domain).where(Domain.name == "RAN")).one()
    rtype = db.exec(select(RequestType).where(RequestType.name == "New Report")).one()
    return str(cust.id), str(domain.id), str(rtype.id)


def _move(client: TestClient, headers: dict[str, str], rid: str, action: str, reason: str | None = None) -> dict:
    r = client.post(f"{API}/requests/{rid}/transitions", headers=headers,
                    json={"action": action, "reason": reason})
    assert r.status_code == 200, r.text
    return r.json()


def test_full_request_flow(client: TestClient, db: Session) -> None:
    cust, domain, rtype = _master(db)
    req_h, _ = _user(client, db, Role.requester, cust)
    other_req_h, _ = _user(client, db, Role.requester)
    mgr_h, _ = _user(client, db, Role.manager)
    eng_h, eng_id = _user(client, db, Role.engineer)
    sup_h, sup_id = _user(client, db, Role.engineer)

    # Requester submits.
    body = {
        "title": "Weekly 4G KPI report - East Java", "customer_id": cust,
        "category": "regular", "request_type_id": rtype, "domain_id": domain,
        "report_name": "Weekly 4G KPI - EJ", "frequency": "weekly",
        "business_purpose": "Used in the Monday regional performance call.",
        "priority": "high", "required_date": (date.today() + timedelta(days=7)).isoformat(),
    }
    r = client.post(f"{API}/requests/", headers=req_h, json=body)
    assert r.status_code == 200, r.text
    req = r.json()
    rid = req["id"]
    assert req["code"].startswith(f"RPT-{date.today().year}-")
    assert req["status"] == "submitted"

    # Visibility: another requester (other department) cannot see it.
    assert client.get(f"{API}/requests/{rid}", headers=other_req_h).status_code == 404

    # Moves outside the table are refused by the API.
    r = client.post(f"{API}/requests/{rid}/transitions", headers=mgr_h, json={"action": "complete"})
    assert r.status_code == 409
    # Engineers cannot assess.
    r = client.post(f"{API}/requests/{rid}/transitions", headers=eng_h, json={"action": "open_assessment"})
    assert r.status_code == 403

    _move(client, mgr_h, rid, "open_assessment")
    # Approve needs the estimated effort.
    r = client.post(f"{API}/requests/{rid}/transitions", headers=mgr_h, json={"action": "approve"})
    assert r.status_code == 422
    r = client.patch(f"{API}/requests/{rid}", headers=mgr_h, json={"estimated_hours": "18"})
    assert r.status_code == 200, r.text
    approved = _move(client, mgr_h, rid, "approve")
    assert approved["committed_date"] is not None  # defaulted from the SLA

    # Assign primary (L2) and supporting (L1), then move to Assigned.
    for eid, role, level, hrs in ((eng_id, "primary", "L2", "12"), (sup_id, "supporting", "L1", "6")):
        r = client.post(f"{API}/requests/{rid}/assignments", headers=mgr_h,
                        json={"engineer_id": eid, "assignment_role": role, "level": level, "estimated_hours": hrs})
        assert r.status_code == 200, r.text
    _move(client, mgr_h, rid, "assign")

    # Engineer starts, comments internally; the requester must not see it.
    _move(client, eng_h, rid, "start")
    client.post(f"{API}/requests/{rid}/comments", headers=eng_h, json={"body": "internal", "visibility": "internal"})
    client.post(f"{API}/requests/{rid}/comments", headers=eng_h, json={"body": "public", "visibility": "public"})
    seen = [c["body"] for c in client.get(f"{API}/requests/{rid}/comments", headers=req_h).json()]
    assert seen == ["public"]

    # Submit for review needs the output file; supporting engineer cannot submit.
    r = client.post(f"{API}/requests/{rid}/transitions", headers=eng_h, json={"action": "submit_review"})
    assert r.status_code == 422
    r = client.post(f"{API}/requests/{rid}/attachments", headers=eng_h,
                    files={"file": ("ej.xlsx", b"PK\x03\x04 test", "application/vnd.ms-excel")},
                    data={"is_output": "true"})
    assert r.status_code == 200, r.text
    r = client.post(f"{API}/requests/{rid}/transitions", headers=sup_h, json={"action": "submit_review"})
    assert r.status_code == 422
    _move(client, eng_h, rid, "submit_review")

    # Complete needs hours from every engineer.
    today = date.today().isoformat()
    client.post(f"{API}/requests/{rid}/timelogs", headers=eng_h, json={"work_date": today, "hours": "7.5"})
    r = client.post(f"{API}/requests/{rid}/transitions", headers=mgr_h, json={"action": "complete"})
    assert r.status_code == 422
    client.post(f"{API}/requests/{rid}/timelogs", headers=sup_h, json={"work_date": today, "hours": "4"})
    done = _move(client, mgr_h, rid, "complete")
    assert done["status"] == "completed"

    # Every status change is recorded with user and time.
    hist = db.exec(select(StatusHistory).where(StatusHistory.request_id == rid)).all()
    assert [h.to_status.value for h in sorted(hist, key=lambda h: h.changed_at)] == [
        "submitted", "under_assessment", "approved", "assigned", "in_progress", "under_review", "completed"]
    assert all(h.changed_by_id for h in hist)

    # Requester can track it; SLA row exists.
    assert client.get(f"{API}/requests/{rid}", headers=req_h).json()["status"] == "completed"
    sla = client.get(f"{API}/requests/{rid}/sla", headers=mgr_h).json()
    assert sla["resolved_at"] is not None


def test_hold_and_resume(client: TestClient, db: Session) -> None:
    cust, domain, rtype = _master(db)
    req_h, _ = _user(client, db, Role.requester, cust)
    mgr_h, _ = _user(client, db, Role.manager)
    body = {
        "title": "Core packet loss analysis", "customer_id": cust,
        "category": "ad_hoc", "request_type_id": rtype, "domain_id": domain, "report_name": "Ad hoc",
        "frequency": "one_time", "business_purpose": "Check packet loss after the upgrade.",
        "priority": "low", "required_date": (date.today() + timedelta(days=10)).isoformat(),
    }
    rid = client.post(f"{API}/requests/", headers=req_h, json=body).json()["id"]
    _move(client, mgr_h, rid, "open_assessment")
    r = client.post(f"{API}/requests/{rid}/transitions", headers=mgr_h, json={"action": "hold"})
    assert r.status_code == 400  # reason required
    held = _move(client, mgr_h, rid, "hold", "Waiting for data")
    assert held["status"] == "on_hold"
    resumed = _move(client, mgr_h, rid, "resume")
    assert resumed["status"] == "under_assessment"
    # Requester can cancel their own request before it is assigned.
    assert _move(client, req_h, rid, "cancel")["status"] == "cancelled"


def test_dashboard_matches_database(client: TestClient, db: Session) -> None:
    mgr_h, _ = _user(client, db, Role.manager)
    d = client.get(f"{API}/dashboard", headers=mgr_h).json()
    listed_open = client.get(f"{API}/requests/", headers=mgr_h,
                             params=[("status", s) for s in ("submitted", "under_assessment", "approved", "assigned")]
                             ).json()["count"]
    assert d["open"] == listed_open
    overdue_list = client.get(f"{API}/requests/", headers=mgr_h, params={"overdue": True}).json()["count"]
    assert d["overdue"] == overdue_list


def test_one_time_is_always_ad_hoc(client: TestClient, db: Session) -> None:
    cust, domain, rtype = _master(db)
    req_h, _ = _user(client, db, Role.requester, cust)
    body = {
        "title": "One-time outage summary", "customer_id": cust,
        "category": "regular", "request_type_id": rtype, "domain_id": domain, "report_name": "Outage summary",
        "frequency": "one_time", "business_purpose": "Summary for the management meeting.",
        "priority": "medium", "required_date": (date.today() + timedelta(days=5)).isoformat(),
    }
    r = client.post(f"{API}/requests/", headers=req_h, json=body)
    assert r.status_code == 200, r.text
    assert r.json()["category"] == "ad_hoc"
