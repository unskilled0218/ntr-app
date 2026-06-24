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
import { REMOVE_VALUE } from "../config";

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
afterEach(() => { cleanup(); });

describe("TodoPane removal glue", () => {
  it("removing a project updates every task that carries it and reloads", async () => {
    render(<TodoPane />);

    // Wait for the mount load to populate the Project filter with the derived "work" option.
    const filter = (await screen.findByRole("combobox", { name: /project filter/i })) as HTMLSelectElement;
    await waitFor(() => expect(within(filter).queryByRole("option", { name: "work" })).toBeTruthy());

    // Select "work" so the in-dropdown Remove option appears, then choose it to open the dialog.
    fireEvent.change(filter, { target: { value: "work" } });
    fireEvent.change(filter, { target: { value: REMOVE_VALUE } });

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
    render(<TodoPane />);

    const filter = (await screen.findByRole("combobox", { name: /project filter/i })) as HTMLSelectElement;
    await waitFor(() => expect(within(filter).queryByRole("option", { name: "work" })).toBeTruthy());

    fireEvent.change(filter, { target: { value: "work" } });
    fireEvent.change(filter, { target: { value: REMOVE_VALUE } });

    const dialog = within(document.getElementById("remove-label-dialog") as HTMLElement);
    const callsBefore = vi.mocked(listTasks).mock.calls.length;
    fireEvent.click(dialog.getByRole("button", { name: /^remove$/i }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("network error"));
    // The catch path reloads too, so the UI reflects whatever landed before the failure.
    await waitFor(() => expect(vi.mocked(listTasks).mock.calls.length).toBeGreaterThan(callsBefore));
  });
});
