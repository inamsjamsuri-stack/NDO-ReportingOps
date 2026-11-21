"""Unit tests for the SLA calendar and workflow rules.

Standard library only, so they also run without the app's dependencies:
    cd backend && python -m unittest tests.unit.test_rules
"""

import unittest
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from app.core.work_calendar import WorkCalendar
from app.core.workflow_rules import (
    SEED_TRANSITIONS,
    GuardContext,
    TransitionError,
    check,
    pick_rule,
)

JKT = ZoneInfo("Asia/Jakarta")


def jkt(y: int, m: int, d: int, hh: int = 0, mm: int = 0) -> datetime:
    return datetime(y, m, d, hh, mm, tzinfo=JKT)


class WorkCalendarTest(unittest.TestCase):
    def setUp(self) -> None:
        # 2026-11-23 is a Monday
        self.cal = WorkCalendar(holidays=frozenset({date(2026, 11, 25)}))

    def test_eight_hours_a_day(self) -> None:
        self.assertEqual(self.cal.minutes_per_day(), 480)

    def test_add_within_morning(self) -> None:
        self.assertEqual(self.cal.add_minutes(jkt(2026, 11, 23, 9, 0), 60), jkt(2026, 11, 23, 10, 0))

    def test_add_skips_break(self) -> None:
        # 12:00 + 60 min: 30 min before break, 30 min after 14:00
        self.assertEqual(self.cal.add_minutes(jkt(2026, 11, 23, 12, 0), 60), jkt(2026, 11, 23, 14, 30))

    def test_add_rolls_to_next_day(self) -> None:
        # 17:00 + 120 min: 60 today, 60 tomorrow from 08:30
        self.assertEqual(self.cal.add_minutes(jkt(2026, 11, 23, 17, 0), 120), jkt(2026, 11, 24, 9, 30))

    def test_add_skips_holiday_and_weekend(self) -> None:
        # Tue 24 Nov 17:00 + 120 -> Wed 25 is a holiday -> Thu 26 09:30
        self.assertEqual(self.cal.add_minutes(jkt(2026, 11, 24, 17, 0), 120), jkt(2026, 11, 26, 9, 30))
        # Fri 27 Nov 17:30 + 60 -> Mon 30 Nov 09:00
        self.assertEqual(self.cal.add_minutes(jkt(2026, 11, 27, 17, 30), 60), jkt(2026, 11, 30, 9, 0))

    def test_start_outside_hours(self) -> None:
        # Saturday night -> starts Monday 08:30
        self.assertEqual(self.cal.add_minutes(jkt(2026, 11, 21, 22, 0), 30), jkt(2026, 11, 23, 9, 0))

    def test_high_priority_three_days(self) -> None:
        # 1440 working minutes from Mon 08:30 = end of Wed? Wed is holiday -> Thu 18:00
        self.assertEqual(self.cal.add_minutes(jkt(2026, 11, 23, 8, 30), 1440), jkt(2026, 11, 26, 18, 0))

    def test_minutes_between(self) -> None:
        self.assertEqual(self.cal.minutes_between(jkt(2026, 11, 23, 12, 0), jkt(2026, 11, 23, 15, 0)), 90)
        self.assertEqual(self.cal.minutes_between(jkt(2026, 11, 23, 8, 30), jkt(2026, 11, 24, 8, 30)), 480)
        self.assertEqual(self.cal.minutes_between(jkt(2026, 11, 23, 10, 0), jkt(2026, 11, 23, 9, 0)), 0)

    def test_round_trip(self) -> None:
        start = jkt(2026, 11, 23, 11, 17)
        for m in (1, 59, 480, 1000, 4800):
            end = self.cal.add_minutes(start, m)
            self.assertEqual(self.cal.minutes_between(start, end), m)

    def test_always_on(self) -> None:
        cal = self.cal.with_always_on()
        self.assertEqual(cal.add_minutes(jkt(2026, 11, 21, 22, 0), 120), jkt(2026, 11, 22, 0, 0))

    def test_from_settings(self) -> None:
        cal = WorkCalendar.from_settings(
            {"timezone": "Asia/Jakarta", "work_days": [0, 1, 2, 3, 4], "work_start": "08:30",
             "work_end": "18:00", "break_start": "12:30", "break_end": "14:00"}
        )
        self.assertEqual(cal.minutes_per_day(), 480)


class WorkflowRulesTest(unittest.TestCase):
    def ctx(self, **kw: object) -> GuardContext:
        base: dict[str, object] = {"user_id": "u1", "user_role": "manager", "requester_id": "r1"}
        base.update(kw)
        return GuardContext(**base)  # type: ignore[arg-type]

    def test_unknown_move_is_conflict(self) -> None:
        with self.assertRaises(TransitionError) as e:
            pick_rule(SEED_TRANSITIONS, action="complete", from_status="submitted", role="manager")
        self.assertEqual(e.exception.status_code, 409)

    def test_wrong_role_is_forbidden(self) -> None:
        with self.assertRaises(TransitionError) as e:
            pick_rule(SEED_TRANSITIONS, action="approve", from_status="under_assessment", role="engineer")
        self.assertEqual(e.exception.status_code, 403)

    def test_approve_needs_commitment(self) -> None:
        rule = pick_rule(SEED_TRANSITIONS, action="approve", from_status="under_assessment", role="manager")
        with self.assertRaises(TransitionError):
            check(rule, self.ctx(priority="high"), None)
        with self.assertRaises(TransitionError):  # late without reason
            check(rule, self.ctx(priority="high", committed_date=date(2026, 12, 2),
                                 required_date=date(2026, 12, 1), estimated_hours=8), None)
        check(rule, self.ctx(priority="high", committed_date=date(2026, 12, 2), required_date=date(2026, 12, 1),
                             estimated_hours=8, committed_late_reason="data backfill"), None)

    def test_reason_required(self) -> None:
        rule = pick_rule(SEED_TRANSITIONS, action="reject", from_status="under_assessment", role="manager")
        with self.assertRaises(TransitionError):
            check(rule, self.ctx(), "  ")
        check(rule, self.ctx(), "Out of scope")

    def test_cancel_by_requester_and_manager(self) -> None:
        r = pick_rule(SEED_TRANSITIONS, action="cancel", from_status="submitted", role="requester")
        check(r, self.ctx(user_id="r1", user_role="requester"), None)
        with self.assertRaises(TransitionError):
            check(r, self.ctx(user_id="other", user_role="requester"), None)
        with self.assertRaises(TransitionError):  # requester cannot cancel after approval
            pick_rule(SEED_TRANSITIONS, action="cancel", from_status="assigned", role="requester")
        m = pick_rule(SEED_TRANSITIONS, action="cancel", from_status="assigned", role="manager")
        self.assertTrue(m.requires_reason)

    def test_resume_goes_back(self) -> None:
        r = pick_rule(SEED_TRANSITIONS, action="resume", from_status="on_hold", role="manager", to_status="in_progress")
        check(r, self.ctx(status_before_hold="in_progress", to_status="in_progress"), None)
        r2 = pick_rule(SEED_TRANSITIONS, action="resume", from_status="on_hold", role="manager", to_status="approved")
        with self.assertRaises(TransitionError):
            check(r2, self.ctx(status_before_hold="in_progress", to_status="approved"), None)

    def test_submit_review_needs_primary_and_output(self) -> None:
        r = pick_rule(SEED_TRANSITIONS, action="submit_review", from_status="in_progress", role="engineer")
        a = [{"engineer_id": "e1", "role": "primary", "hours_logged": 2}, {"engineer_id": "e2", "role": "supporting", "hours_logged": 0}]
        with self.assertRaises(TransitionError):  # supporting engineer
            check(r, self.ctx(user_id="e2", user_role="engineer", active_assignments=a, has_output_file=True), None)
        with self.assertRaises(TransitionError):  # no output
            check(r, self.ctx(user_id="e1", user_role="engineer", active_assignments=a), None)
        check(r, self.ctx(user_id="e1", user_role="engineer", active_assignments=a, has_output_file=True), None)

    def test_complete_needs_hours(self) -> None:
        r = pick_rule(SEED_TRANSITIONS, action="complete", from_status="under_review", role="manager")
        a = [{"engineer_id": "e1", "role": "primary", "hours_logged": 2}, {"engineer_id": "e2", "role": "supporting", "hours_logged": 0}]
        with self.assertRaises(TransitionError):
            check(r, self.ctx(active_assignments=a), None)
        a[1]["hours_logged"] = 1
        check(r, self.ctx(active_assignments=a), None)

    def test_reopen_window(self) -> None:
        r = pick_rule(SEED_TRANSITIONS, action="reopen", from_status="completed", role="manager")
        now = jkt(2026, 12, 1, 10)
        check(r, self.ctx(completed_at=now - timedelta(days=14), now=now), "wrong totals")
        with self.assertRaises(TransitionError):
            check(r, self.ctx(completed_at=now - timedelta(days=15), now=now), "wrong totals")

    def test_seed_has_no_duplicate_role_rows(self) -> None:
        seen = set()
        for t in SEED_TRANSITIONS:
            for role in t.allowed_roles:
                key = (t.from_status, t.to_status, role)
                self.assertNotIn(key, seen)
                seen.add(key)


if __name__ == "__main__":
    unittest.main()
