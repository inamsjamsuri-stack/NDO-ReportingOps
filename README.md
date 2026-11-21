# ReportOps

ReportOps is the internal web app the IOH MS-NDO Reporting Department uses to manage reporting requests. It covers intake, approval, assignment, SLA tracking, workload, and the report catalog.

It is built on the [FastAPI full-stack template](https://github.com/fastapi/full-stack-fastapi-template):
FastAPI + SQLModel + PostgreSQL + Alembic on the backend, and React + TypeScript + Tailwind + shadcn/ui on the frontend. It runs on Podman.

Design documents (in the ReportingOps project):

- PRD v1.1: scope, rules, and the 15 confirmed decisions
- Database Schema & Workflow Rules: the 23 tables, the transition table, and the dashboard queries
- UI mockups: Dashboard, Inbox, Board, Request detail, New request (IOH brand colours)

## Status

| Part | State |
| --- | --- |
| Data model (23 tables) and baseline migration | Done |
| Workflow engine (transition table + guards) | Done, unit tested |
| SLA calendar (working hours, break, holidays, On Hold pause) | Done, unit tested |
| API: requests, transitions, assignments, hours, comments, files, catalog, master data, SLA admin, dashboard, workload, notifications, audit log | Done, integration tests written |
| Background worker (overdue, at-risk, reminders, email) | Done |
| Podman compose, backup and restore scripts | Done |
| Frontend: Dashboard, Inbox (table + board), New request, Request detail, Report catalog, Workload, Admin (users, master data, SLA policies, holidays, working hours), notification bell, IOH brand theme | Done (milestone 2); not yet run in a browser |

## Run with Podman

```bash
cp .env.example .env        # set SECRET_KEY, FIRST_SUPERUSER_PASSWORD, POSTGRES_PASSWORD, SMTP
podman compose up -d --build
```

Then open:

- App: <http://localhost:8000>
- API docs (Swagger): <http://localhost:8000/docs>

On first start, the backend runs the migrations and seeds the reference data: the first admin user, the six domains, the five request types, the four default SLA policies, the working-hours calendar, and the workflow transitions.

| Service | What it does |
| --- | --- |
| `db` | PostgreSQL 16, data in the `reportops-db` volume |
| `backend` | API + built web app, files in the `reportops-files` volume |
| `worker` | Every 15 min: SLA flags, overdue/at-risk/deadline alerts, sending emails |
| `backup` | Daily at 01:00 WIB: `pg_dump` + attachments, keeps 14 daily and 8 weekly copies in `./backups` |

Restarting keeps all data. `podman compose down` followed by `up`, or a full server reboot, keeps every request, its history, and its files, because they live in named volumes.

### Backup and restore

```bash
podman compose exec backup bash /backup.sh                  # backup now
# restore: see the steps at the top of scripts/restore.sh
```

## Tests

```bash
# Pure rule tests (no database or app dependencies needed)
cd backend && python -m unittest tests.unit.test_rules

# Full test suite against PostgreSQL, inside the stack
podman compose exec backend bash scripts/tests-start.sh
```

## Key rules (see the PRD for details)

- **Roles:** admin, manager, engineer, requester. Requesters see their own requests and their department's. Engineers see the requests they are assigned to. Managers and admins see everything.
- **Workflow:** Submitted → Under Assessment → Approved → Assigned → In Progress → Under Review → Completed. The side statuses are Rejected, On Hold, and Cancelled. Moves are stored in the `workflow_transition` table, and the API refuses any move that is not in it. Every move writes a `status_history` row.
- **SLA:** clocks count working hours, Mon–Fri 08:30–18:00 WIB with a break from 12:30 to 14:00, minus holidays. The clock pauses during On Hold. A request is **Overdue** when it is past its Committed Date. A request has **Breached SLA** when it went over the resolution target.
- **History tables** (`status_history`, `activity`, `audit_log`) are insert-only. A database trigger blocks updates and deletes.

## Known gaps and next steps

1. First run on the server: check every screen against the API and fix what turns up. Run `bun run typecheck` in `frontend/` once and fix any type errors (the production build skips the type check so one small type error cannot block a deploy).
2. Replace the baseline migration with an `alembic revision --autogenerate` output before the pilot (see the note in `backend/app/alembic/versions/0001_reportops_baseline.py`).
3. Login uses one access token valid for 8 hours. The PRD's 30-minute access token plus refresh token is still to do.
4. The Playwright end-to-end tests in `frontend/tests` still describe the template screens and need rewriting for ReportOps.
5. The web app is served by the backend container. The PRD listed a separate frontend container; one container is simpler to run, and this can be split later if needed.

## Development

See [development.md](development.md). On developer machines, set `FASTAPI_ENV=development` in `.env`.
