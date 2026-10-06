import { describe, expect, test } from "bun:test";
import {
  TASK_STATUS_LABELS,
  TASK_STATUSES,
  formatDueDate,
  isTaskOverdue,
  todayISO,
} from "../src/lib/tasks";

describe("todayISO", () => {
  test("formats the local date as YYYY-MM-DD", () => {
    expect(todayISO(new Date(2026, 9, 6))).toBe("2026-10-06");
    expect(todayISO(new Date(2026, 0, 3))).toBe("2026-01-03");
  });
});

describe("isTaskOverdue", () => {
  test("flags open tasks whose due date has passed", () => {
    expect(
      isTaskOverdue({ due: "2026-10-05", status: "todo" }, "2026-10-06"),
    ).toBe(true);
    expect(
      isTaskOverdue(
        { due: "2026-10-05", status: "in_progress" },
        "2026-10-06",
      ),
    ).toBe(true);
  });

  test("today and future dates are not overdue", () => {
    expect(
      isTaskOverdue({ due: "2026-10-06", status: "todo" }, "2026-10-06"),
    ).toBe(false);
    expect(
      isTaskOverdue({ due: "2026-10-12", status: "todo" }, "2026-10-06"),
    ).toBe(false);
  });

  test("done tasks are never overdue", () => {
    expect(
      isTaskOverdue({ due: "2026-10-05", status: "done" }, "2026-10-06"),
    ).toBe(false);
  });

  test("tasks without a due date are never overdue", () => {
    expect(isTaskOverdue({ status: "todo" }, "2026-10-06")).toBe(false);
    expect(isTaskOverdue({ due: undefined, status: "todo" }, "2026-10-06")).toBe(
      false,
    );
  });
});

describe("formatDueDate", () => {
  test("renders a short human label", () => {
    expect(formatDueDate("2026-10-12")).toBe("Oct 12");
  });

  test("falls back to the raw value when malformed", () => {
    expect(formatDueDate("soon")).toBe("soon");
  });
});

describe("task statuses", () => {
  test("every status has a label and they stay in board order", () => {
    expect(TASK_STATUSES).toEqual(["todo", "in_progress", "done"]);
    for (const status of TASK_STATUSES) {
      expect(TASK_STATUS_LABELS[status].length).toBeGreaterThan(0);
    }
  });
});
