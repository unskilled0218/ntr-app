import { describe, expect, it } from "vitest";
import { displayedTaskDates, formatLocalTaskDate, isTaskDate } from "./taskDates";

describe("task dates", () => {
  it.each(["2026-10-11", "2024-02-29", "2000-02-29"])("accepts calendar date %s", (date) => {
    expect(isTaskDate(date)).toBe(true);
  });
  it.each(["", "2026-2-01", "2026-02-29", "1900-02-29", "2026-04-31", "2026-00-10", "2026-13-01", "2026-10-00", "2026-10-11T12:00:00Z", "later", undefined])("rejects %s", (date) => {
    expect(isTaskDate(date)).toBe(false);
  });
  it("formats local dates on either side of midnight", () => {
    expect(formatLocalTaskDate(new Date(2026, 9, 11, 23, 59))).toBe("2026-10-11");
    expect(formatLocalTaskDate(new Date(2026, 9, 12, 0, 0))).toBe("2026-10-12");
    expect(() => formatLocalTaskDate(new Date(NaN))).toThrow("Invalid task edit date");
  });
  it("selects only valid effective date fields", () => {
    expect(displayedTaskDates({ due: "later", updated: "2026-10-11", custom: "value" })).toEqual({ updated: "2026-10-11" });
    expect(displayedTaskDates({})).toEqual({});
  });
});
