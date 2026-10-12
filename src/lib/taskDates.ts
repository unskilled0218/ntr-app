export type TaskDateMetadata = Partial<Record<"due" | "updated", string>>;

export function isTaskDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

// The edit stamp is the user's local Save day, not the UTC day or dialog-opening day.
export function formatLocalTaskDate(date: Date): string {
  const value = [date.getFullYear().toString().padStart(4, "0"), (date.getMonth() + 1).toString().padStart(2, "0"), date.getDate().toString().padStart(2, "0")].join("-");
  if (!isTaskDate(value)) throw new Error("Invalid task edit date");
  return value;
}

export function displayedTaskDates(tags: Record<string, string>): TaskDateMetadata {
  const dates: TaskDateMetadata = {};
  if (isTaskDate(tags.due)) dates.due = tags.due;
  if (isTaskDate(tags.updated)) dates.updated = tags.updated;
  return dates;
}
