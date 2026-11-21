"""Working-hours calendar used for SLA math.

Pure Python (standard library only) so it can be tested without a database.

Default calendar (PRD v1.1): Monday to Friday, 08:30-18:00 Asia/Jakarta,
break 12:30-14:00 (8 working hours a day), minus holidays.
"""

from __future__ import annotations

from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo


@dataclass(frozen=True)
class WorkCalendar:
    tz: ZoneInfo = field(default_factory=lambda: ZoneInfo("Asia/Jakarta"))
    work_days: frozenset[int] = frozenset({0, 1, 2, 3, 4})  # Monday = 0
    work_start: time = time(8, 30)
    work_end: time = time(18, 0)
    break_start: time | None = time(12, 30)
    break_end: time | None = time(14, 0)
    holidays: frozenset[date] = frozenset()
    always_on: bool = False  # True = 24x7 calendar

    @classmethod
    def from_settings(
        cls, settings: dict[str, object], holidays: Iterable[date] = ()
    ) -> WorkCalendar:
        def t(key: str, default: time | None) -> time | None:
            v = settings.get(key)
            return time.fromisoformat(str(v)) if v else default

        days = settings.get("work_days")
        return cls(
            tz=ZoneInfo(str(settings.get("timezone", "Asia/Jakarta"))),
            work_days=frozenset(int(d) for d in days) if isinstance(days, list) else frozenset({0, 1, 2, 3, 4}),
            work_start=t("work_start", time(8, 30)) or time(8, 30),
            work_end=t("work_end", time(18, 0)) or time(18, 0),
            break_start=t("break_start", time(12, 30)),
            break_end=t("break_end", time(14, 0)),
            holidays=frozenset(holidays),
        )

    def with_always_on(self) -> WorkCalendar:
        return WorkCalendar(tz=self.tz, always_on=True)

    # -- periods -----------------------------------------------------------

    def is_work_day(self, d: date) -> bool:
        return d.weekday() in self.work_days and d not in self.holidays

    def periods(self, d: date) -> list[tuple[datetime, datetime]]:
        """Working periods for one local date, as aware datetimes."""
        if not self.is_work_day(d):
            return []
        mk = lambda t: datetime.combine(d, t, tzinfo=self.tz)  # noqa: E731
        if self.break_start and self.break_end and self.work_start < self.break_start < self.break_end < self.work_end:
            return [(mk(self.work_start), mk(self.break_start)), (mk(self.break_end), mk(self.work_end))]
        return [(mk(self.work_start), mk(self.work_end))]

    def minutes_per_day(self) -> int:
        probe = date(2024, 1, 1)  # a Monday
        return sum(int((b - a).total_seconds() // 60) for a, b in self._periods_ignoring_holidays(probe))

    def _periods_ignoring_holidays(self, d: date) -> list[tuple[datetime, datetime]]:
        return WorkCalendar(
            tz=self.tz, work_days=frozenset(range(7)), work_start=self.work_start,
            work_end=self.work_end, break_start=self.break_start, break_end=self.break_end,
        ).periods(d)

    def _iter_periods(self, start: datetime) -> Iterator[tuple[datetime, datetime]]:
        local = start.astimezone(self.tz)
        d = local.date()
        for _ in range(3660):  # ten years is plenty; guards against empty calendars
            for a, b in self.periods(d):
                if b <= local:
                    continue
                yield (max(a, local), b)
            d += timedelta(days=1)
        raise ValueError("calendar has no working time")

    # -- math --------------------------------------------------------------

    def add_minutes(self, start: datetime, minutes: int) -> datetime:
        """The moment after `minutes` of working time from `start`."""
        if start.tzinfo is None:
            raise ValueError("start must be timezone-aware")
        if self.always_on:
            return start + timedelta(minutes=minutes)
        if minutes <= 0:
            # snap to the next working moment
            for a, _ in self._iter_periods(start):
                return a
        left = timedelta(minutes=minutes)
        for a, b in self._iter_periods(start):
            span = b - a
            if left <= span:
                return a + left
            left -= span
        raise AssertionError("unreachable")

    def minutes_between(self, start: datetime, end: datetime) -> int:
        """Working minutes in [start, end). Zero if end <= start."""
        if start.tzinfo is None or end.tzinfo is None:
            raise ValueError("datetimes must be timezone-aware")
        if end <= start:
            return 0
        if self.always_on:
            return int((end - start).total_seconds() // 60)
        total = timedelta()
        for a, b in self._iter_periods(start):
            if a >= end:
                break
            total += min(b, end) - a
        return int(total.total_seconds() // 60)
