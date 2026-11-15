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

// Due datetimes retain their supplied fixed offset; never convert through the device zone.
export function isDueDatetime(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  if (!isTaskDate(value.slice(0, 10))) return false;
  const time = value.slice(11, 19).split(":").map(Number);
  const offset = value.match(/[+-](\d{2}):(\d{2})$/);
  return time[0] < 24 && time[1] < 60 && time[2] < 60 && (!offset || (Number(offset[1]) < 24 && Number(offset[2]) < 60));
}

export function dueDateInput(value: string): string {
  return isDueDatetime(value) ? value.slice(0, 10) : isTaskDate(value) ? value : "";
}

export function editedDue(original: string, date: string, touched: boolean): string {
  if (!touched) return original;
  if (!date) return "";
  return isDueDatetime(original) ? date + original.slice(10) : date;
}

export function displayedTaskDates(tags: Record<string, string>): TaskDateMetadata {
  const dates: TaskDateMetadata = {};
  if (isTaskDate(tags.due) || isDueDatetime(tags.due)) dates.due = tags.due;
  if (isTaskDate(tags.updated)) dates.updated = tags.updated;
  return dates;
}
