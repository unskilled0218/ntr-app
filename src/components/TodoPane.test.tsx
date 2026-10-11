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
  getLabels: vi.fn(),
  putLabels: vi.fn(),
  errMsg: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

import { completeTask, createTask, deleteTask, getLabels, listTasks, putLabels, uncompleteTask, updateTask } from "../api";

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
  vi.mocked(getLabels).mockResolvedValue({ project: ["work", "home"], context: ["phone"] });
  vi.mocked(putLabels).mockResolvedValue();
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
    expect(vi.mocked(putLabels)).toHaveBeenCalledWith({ project: ["home"], context: ["phone"] });

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

describe("TodoPane remembered labels", () => {
  it("keeps the last task's project selected and in the picker after deletion", async () => {
    const only = task(1, "call bank +work", ["work"], []);
    vi.mocked(listTasks).mockResolvedValue([only]);
    vi.mocked(getLabels).mockResolvedValue({ project: ["work"], context: [] });
    vi.mocked(deleteTask).mockResolvedValue();
    render(<TodoPane compact={false} />);

    fireEvent.click(await screen.findByRole("button", { name: /project filter/i }));
    let picker = within(document.querySelector("dialog.select-modal[open]") as HTMLElement);
    fireEvent.click(picker.getByRole("button", { name: "work" }));

    vi.mocked(listTasks).mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect((screen.getByText("No tasks.") as HTMLParagraphElement).hidden).toBe(false));

    const projectFilter = screen.getByRole("button", { name: /project filter/i });
    expect(projectFilter.textContent).toBe("work");
    fireEvent.click(projectFilter);
    picker = within(document.querySelector("dialog.select-modal[open]") as HTMLElement);
    expect(picker.getByRole("button", { name: "work" })).toBeTruthy();
    expect(vi.mocked(putLabels)).not.toHaveBeenCalled();
  });

  it("forgets an explicitly removed project and clears its filter", async () => {
    let current = [task(1, "call bank +work", ["work"], [])];
    let remembered = { project: ["work"], context: [] as string[] };
    vi.mocked(listTasks).mockImplementation(async () => current);
    vi.mocked(getLabels).mockImplementation(async () => remembered);
    vi.mocked(updateTask).mockImplementation(async () => {
      current = [task(1, "call bank", [], [])];
      return current[0];
    });
    vi.mocked(putLabels).mockImplementation(async (labels) => { remembered = labels; });
    render(<TodoPane compact={false} />);

    fireEvent.click(await screen.findByRole("button", { name: /project filter/i }));
    let picker = within(document.querySelector("dialog.select-modal[open]") as HTMLElement);
    fireEvent.click(picker.getByRole("button", { name: "work" }));
    await openRemove("work");
    fireEvent.click(within(document.getElementById("remove-label-dialog") as HTMLElement).getByRole("button", { name: /^remove$/i }));

    await waitFor(() => expect(vi.mocked(putLabels)).toHaveBeenCalledWith({ project: [], context: [] }));
    await waitFor(() => expect(screen.getByRole("button", { name: /project filter/i }).textContent).toBe("All projects"));
  });

  it("uses task-derived labels when loading remembered labels fails", async () => {
    vi.mocked(getLabels).mockRejectedValue(new Error("old server"));
    vi.mocked(listTasks).mockResolvedValue([task(1, "call +work", ["work"], [])]);
    render(<TodoPane compact={false} />);

    fireEvent.click(await screen.findByRole("button", { name: /project filter/i }));
    const picker = within(document.querySelector("dialog.select-modal[open]") as HTMLElement);
    expect(await picker.findByRole("button", { name: "work" })).toBeTruthy();
  });
});

describe("TodoPane view-option persistence", () => {
  it.each(["active", "completed"])("ignores and removes legacy %s status, showing both task states", async (status) => {
    localStorage.setItem("ntr.status", status);
    const completed = { ...task(4, "finished @phone", [], ["phone"]), completed: true };
    vi.mocked(listTasks).mockResolvedValue([...TASKS, completed]);
    render(<TodoPane compact={false} />);
    await screen.findByText("finished");
    expect(screen.getByText("call bank")).toBeTruthy();
    expect(screen.getAllByRole("checkbox").map((el) => (el as HTMLInputElement).checked)).toEqual([false, false, false, true]);
    expect(localStorage.getItem("ntr.status")).toBeNull();
    expect(vi.mocked(listTasks).mock.calls.every(([filter]) => filter.completed == null && filter.context == null)).toBe(true);
  });

  it("falls back to file order with saved descending direction on first render", async () => {
    localStorage.setItem("ntr.sort", "contexts");
    localStorage.setItem("ntr.sortDir", "desc");
    const { container } = render(<TodoPane compact={false} />);
    await screen.findByText("call bank");
    expect(screen.getByRole("button", { name: "Sort" }).textContent).toBe("File order · DESC");
    expect([...container.querySelectorAll(".task .text")].map((el) => el.textContent)).toEqual(["post", "tidy", "call bank"]);
  });
});

describe.each([false, true])("TodoPane simplified workflow (compact=%s)", (compact) => {
  function openFilters() {
    if (compact) fireEvent.click(screen.getByRole("button", { name: /filter options/i }));
  }

  it("project filtering includes completed tasks and offers no status/context controls", async () => {
    const completed = { ...task(4, "finished +work @phone", ["work"], ["phone"]), completed: true };
    vi.mocked(listTasks).mockImplementation(async (filter) => [...TASKS, completed].filter((t) => !filter.project || t.projects.includes(filter.project)));
    render(<TodoPane compact={compact} />);
    await screen.findByText("finished");
    openFilters();
    expect(screen.queryByRole("button", { name: /status filter|context filter/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /project filter/i }));
    fireEvent.click(within(document.querySelector("dialog.select-modal[open]")!).getByRole("button", { name: "work" }));
    await waitFor(() => expect(screen.queryByText("tidy")).toBeNull());
    const finished = screen.getByText("finished").closest("li")!;
    expect(finished.querySelector(".meta")!.textContent).toBe("+work");
    expect(listTasks).toHaveBeenCalledWith({ project: "work" });
  });

  it("completes and reopens a task without hiding it", async () => {
    let current = { ...TASKS[0] };
    vi.mocked(listTasks).mockImplementation(async () => [current]);
    vi.mocked(completeTask).mockImplementation(async () => { current = { ...current, completed: true }; return current; });
    vi.mocked(uncompleteTask).mockImplementation(async () => { current = { ...current, completed: false }; return current; });
    render(<TodoPane compact={compact} />);
    fireEvent.click(await screen.findByRole("checkbox"));
    await waitFor(() => expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true));
    expect(screen.getByText("call bank")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false));
    expect(completeTask).toHaveBeenCalledWith(1);
    expect(uncompleteTask).toHaveBeenCalledWith(1);
  });

  it("adds and reloads a task", async () => {
    let current = [...TASKS];
    vi.mocked(listTasks).mockImplementation(async () => current);
    vi.mocked(createTask).mockImplementation(async (text) => {
      const created = task(4, text, [], []);
      current = [...current, created];
      return created;
    });
    render(<TodoPane compact={compact} />);
    await screen.findByText("call bank");
    fireEvent.change(screen.getByRole("textbox", { name: /new task/i }), { target: { value: "new task" } });
    fireEvent.submit(document.getElementById("add-form")!);
    await screen.findByText("new task");
    expect(createTask).toHaveBeenCalledWith("new task");
  });
});
