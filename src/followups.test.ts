import { expect, it, vi } from "vitest";
import {
  localDayWindow,
  localDateInput,
  nextFollowup,
  followupLabel,
} from "./followups";
it("uses local calendar days, distinguishes overdue/completed, and schedules tomorrow at 9 AM", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 2, 14, 0, 0));
  try {
    const day = localDayWindow();
    expect(new Date(day.todayFrom).getHours()).toBe(0);
    expect(new Date(day.todayTo).getDate()).toBe(3);
    expect(followupLabel(new Date(2026, 10, 2, 13).toISOString())).toBe(
      "Overdue",
    );
    expect(followupLabel(new Date(2026, 10, 2, 15).toISOString())).toBe(
      "Due today",
    );
    expect(followupLabel(new Date(2026, 10, 3, 9).toISOString())).toBe(
      "Upcoming",
    );
    expect(followupLabel(new Date(2026, 10, 1).toISOString(), true)).toBe(
      "Completed",
    );
    expect(localDateInput(nextFollowup(1))).toBe("2026-11-03T09:00");
  } finally {
    vi.useRealTimers();
  }
});
