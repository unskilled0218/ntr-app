import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import TodoPane from "./TodoPane";
import type { Task } from "../api";

// Mock the transport shim. listTasks is arg-agnostic by design: this test pins the *removal glue*
// (which tasks get updated, and that a reload happens), not the server's own filtering — so the
// mount refresh, mount loadLabels, and confirmRemove's listTasks({}) all see the same fixture.
vi.mock("../api", () => ({
  listTasks: vi.fn(),
  updateTask: vi.fn(),
  createTask: vi.fn(),
  completeTask: vi.fn(),
  uncompleteTask: vi.fn(),
  deleteTask: vi.fn(),
  errMsg: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

import { listTasks, updateTask } from "../api";

// Open the Project filter picker and click a label row's Remove button, returning once the
// confirm dialog can be acted on. The picker lists labels once the mount loadLabels resolves.
async function openRemove(name: string) {
  fireEvent.click(await screen.findByRole("button", { name: /project filter/i }));
  const picker = () => within(document.querySelector("dialog.select-modal[open]") as HTMLElement);
  const removeBtn = await waitFor(() => picker().getByRole("button", { name: new RegExp(`remove ${name}`, "i") }));
  fireEvent.click(removeBtn);
}

// The jsdom <dialog>.showModal()/close() polyfill lives in src/test/setup.ts (vitest setupFiles).

function task(id: number, raw: string, projects: string[], contexts: string[]): Task {
  return {
    id,
    completed: false,
    priority: null,
    completion_date: null,
    creation_date: null,
    description: raw,
    projects,
    contexts,
    tags: {},
    raw,
  };
}

const TASKS: Task[] = [
  task(1, "call bank +work @phone", ["work"], ["phone"]),
  task(2, "tidy +home", ["home"], []),
  task(3, "post +work", ["work"], []),
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listTasks).mockResolvedValue(TASKS);
  vi.mocked(updateTask).mockResolvedValue(TASKS[0]);
});
afterEach(() => { cleanup(); localStorage.clear(); });

describe("TodoPane removal glue", () => {
  it("removing a project updates every task that carries it and reloads", async () => {
    render(<TodoPane compact={false} />);

    // Open the Project filter picker and click the "work" row's Remove button.
    await openRemove("work");

    // Confirm in the dialog.
    const dialog = within(document.getElementById("remove-label-dialog") as HTMLElement);
    const callsBefore = vi.mocked(listTasks).mock.calls.length;
    fireEvent.click(dialog.getByRole("button", { name: /^remove$/i }));

    // Only the two "work" tasks are rewritten, with the token stripped; task 2 is untouched.
    await waitFor(() => expect(vi.mocked(updateTask)).toHaveBeenCalledTimes(2));
    expect(vi.mocked(updateTask)).toHaveBeenCalledWith(1, "call bank @phone");
    expect(vi.mocked(updateTask)).toHaveBeenCalledWith(3, "post");
    expect(vi.mocked(updateTask).mock.calls.some(([id]) => id === 2)).toBe(false);

    // And the store is re-queried afterwards (the reload).
    await waitFor(() => expect(vi.mocked(listTasks).mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it("still reloads when an update fails", async () => {
    vi.mocked(updateTask).mockRejectedValueOnce(new Error("network error"));
    render(<TodoPane compact={false} />);

    await openRemove("work");

    const dialog = within(document.getElementById("remove-label-dialog") as HTMLElement);
    const callsBefore = vi.mocked(listTasks).mock.calls.length;
    fireEvent.click(dialog.getByRole("button", { name: /^remove$/i }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("network error"));
    // The catch path reloads too, so the UI reflects whatever landed before the failure.
    await waitFor(() => expect(vi.mocked(listTasks).mock.calls.length).toBeGreaterThan(callsBefore));
  });
});

describe("TodoPane view-option persistence", () => {
  it("writes a Status pick through to the local cache", async () => {
    render(<TodoPane compact={false} />);

    // Open the Status picker and choose Active; the change handler persists it.
    fireEvent.click(screen.getByRole("button", { name: /status filter/i }));
    const picker = within(document.querySelector("dialog.select-modal[open]") as HTMLElement);
    fireEvent.click(picker.getByRole("button", { name: "Active" }));

    await waitFor(() => expect(localStorage.getItem("ntr.status")).toBe("active"));
  });

  it("seeds the status from the cache on mount, so the first fetch uses it", async () => {
    // A persisted Active status must drive the mount refresh's filter (completed: false),
    // proving the lazy useState(getStatus) seed is read before the first listTasks call.
    localStorage.setItem("ntr.status", "active");
    render(<TodoPane compact={false} />);

    await waitFor(() =>
      expect(vi.mocked(listTasks)).toHaveBeenCalledWith(expect.objectContaining({ completed: false })),
    );
  });
});
