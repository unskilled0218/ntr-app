import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRef } from "react";
import TodoPane, { type TodoPaneHandle } from "./TodoPane";
import { activateTransport } from "../api";
import { deferred, settle } from "../test/deferred";
import type { Task } from "../api";

// Isolate task-pane glue here; server/coordinator boundaries use real transport fixtures elsewhere.
vi.mock("../api", async (importOriginal) => ({
  ...await importOriginal<typeof import("../api")>(),
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
  it("removing a project validates current tasks and projects only its own responses", async () => {
    let stored = [...TASKS];
    vi.mocked(listTasks).mockImplementation(async () => stored);
    vi.mocked(updateTask).mockImplementation(async (id, raw) => {
      const previous = stored.find((task) => task.id === id)!;
      const updated = { ...previous, raw, projects: previous.projects.filter((name) => name !== "work") };
      stored = stored.map((task) => task.id === id ? updated : task);
      return updated;
    });
    render(<TodoPane compact={false} />);

    // Open the Project filter picker and click the "work" row's Remove button.
    await openRemove("work");

    // Confirm in the dialog.
    const dialog = within(document.getElementById("remove-label-dialog") as HTMLElement);
    const callsBefore = vi.mocked(listTasks).mock.calls.length;
    fireEvent.click(dialog.getByRole("button", { name: /^remove$/i }));

    // Only the two "work" tasks are rewritten, with the token stripped; task 2 is untouched.
    await waitFor(() => expect(vi.mocked(updateTask)).toHaveBeenCalledTimes(2));
    expect(vi.mocked(updateTask)).toHaveBeenCalledWith(1, "call bank @phone", expect.objectContaining({ url: "" }));
    expect(vi.mocked(updateTask)).toHaveBeenCalledWith(3, "post", expect.objectContaining({ url: "" }));
    expect(vi.mocked(updateTask).mock.calls.some(([id]) => id === 2)).toBe(false);
    await waitFor(() => expect(vi.mocked(putLabels)).toHaveBeenCalledWith({ project: ["home"], context: ["phone"] }, expect.objectContaining({ url: "" })));

    expect(vi.mocked(listTasks).mock.calls.length).toBeGreaterThan(callsBefore);
    expect(stored.filter((task) => task.projects.includes("work"))).toHaveLength(0);
  });

  it("retains visible content when an update fails", async () => {
    vi.mocked(updateTask).mockRejectedValueOnce(new Error("network error"));
    render(<TodoPane compact={false} />);

    await openRemove("work");

    const dialog = within(document.getElementById("remove-label-dialog") as HTMLElement);
    const callsBefore = vi.mocked(listTasks).mock.calls.length;
    fireEvent.click(dialog.getByRole("button", { name: /^remove$/i }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("network error"));
    expect(vi.mocked(listTasks).mock.calls.length).toBeGreaterThan(callsBefore);
    expect(document.querySelector("#tasks")!.textContent).toContain("call bank");
  });
});

describe("TodoPane live recovery", () => {
  it("retries a failed recovery read without another event and stops after success", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(listTasks).mockRejectedValueOnce(new Error("temporary GET failure"));
      const { container, unmount } = render(<TodoPane compact={false} />);
      await act(settle);
      expect(container.querySelector("#error")!.textContent).toContain("temporary GET failure");
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(container.querySelector("#tasks")!.textContent).toContain("call bank");
      const reads = vi.mocked(listTasks).mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
      expect(listTasks).toHaveBeenCalledTimes(reads);
      unmount();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it("ignores a late old-target task and label read after replacement", async () => {
    const oldTasks = deferred<Task[]>();
    const oldLabels = deferred<{ project: string[]; context: string[] }>();
    vi.mocked(listTasks).mockReturnValueOnce(oldTasks.promise);
    vi.mocked(getLabels).mockReturnValueOnce(oldLabels.promise);
    const ref = createRef<TodoPaneHandle>();
    const { container } = render(<TodoPane ref={ref} compact={false} />);
    localStorage.setItem("ntr.serverUrl", "http://server-b");
    activateTransport();
    vi.mocked(listTasks).mockResolvedValue([task(20, "B task", [], [])]);
    vi.mocked(getLabels).mockResolvedValue({ project: [], context: [] });
    await act(async () => { ref.current!.onTasksChanged(); await settle(); });
    await act(async () => {
      oldTasks.resolve([task(1, "A task +old", ["old"], [])]);
      oldLabels.resolve({ project: ["old"], context: [] });
      await settle();
    });
    expect(container.querySelector("#tasks")!.textContent).toContain("B task");
    expect(container.querySelector("#tasks")!.textContent).not.toContain("A task");
    expect(putLabels).not.toHaveBeenCalled();
  });

  it("drains closely spaced events without allowing an older list to win", async () => {
    const ref = createRef<TodoPaneHandle>();
    const { container } = render(<TodoPane ref={ref} compact={false} />);
    await act(settle);
    const read = deferred<Task[]>();
    vi.mocked(listTasks).mockReturnValueOnce(read.promise).mockResolvedValue([task(2, "latest", [], [])]);
    act(() => { ref.current!.onTasksChanged(); ref.current!.onTasksChanged(); });
    await act(async () => { read.resolve([task(1, "earlier", [], [])]); await settle(); });
    expect(container.querySelector("#tasks")!.textContent).toContain("latest");
    expect(container.querySelector("#tasks")!.textContent).not.toContain("earlier");
  });

  it("cancels failed-read retries on unmount", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(listTasks).mockRejectedValue(new Error("offline"));
      const { unmount } = render(<TodoPane compact={false} />);
      await act(settle);
      unmount();
      const reads = vi.mocked(listTasks).mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
      expect(listTasks).toHaveBeenCalledTimes(reads);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
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

    await waitFor(() => expect(vi.mocked(putLabels)).toHaveBeenCalledWith({ project: [], context: [] }, expect.objectContaining({ url: "" })));
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

describe("TodoPane edit-date refresh", () => {
  it("retains created across successful edits and rejected saves", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 11, 12));
    const description = "Do something +cart due:2026-10-12";
    let current: Task = { ...task(1, description, ["cart"], []), creation_date: "2026-10-10", tags: { due: "2026-10-12" }, raw: `2026-10-10 ${description}` };
    vi.mocked(listTasks).mockImplementation(async () => [current]);
    vi.mocked(updateTask).mockImplementation(async (_id, text) => {
      const updated = text.match(/updated:(\d{4}-\d{2}-\d{2})/)![1];
      current = { ...current, description: text.slice(11), raw: text, tags: { ...current.tags, updated } };
      return current;
    });
    try {
      render(<TodoPane compact={false} />);
      await screen.findByText("Do something");
      const metadata = () => document.querySelector("li.task .meta")!.textContent;
      expect(metadata()).toBe("+cart due:2026-10-12 created:2026-10-10");
      for (const day of [11, 12]) {
        vi.setSystemTime(new Date(2026, 9, day, 12));
        fireEvent.click(screen.getByRole("button", { name: "Edit" }));
        fireEvent.click(within(document.getElementById("edit-task-modal")!).getByRole("button", { name: "Save" }));
        await waitFor(() => expect(metadata()).toBe(`+cart due:2026-10-12 created:2026-10-10 updated:2026-10-${day}`));
        expect(current.creation_date).toBe("2026-10-10");
      }
      const snapshot = structuredClone(current);
      vi.mocked(updateTask).mockRejectedValueOnce(new Error("disk full"));
      vi.setSystemTime(new Date(2026, 9, 13, 12));
      fireEvent.click(screen.getByRole("button", { name: "Edit" }));
      fireEvent.click(within(document.getElementById("edit-task-modal")!).getByRole("button", { name: "Save" }));
      await waitFor(() => expect(screen.getAllByRole("alert").some((el) => el.textContent?.includes("disk full"))).toBe(true));
      expect(metadata()).toBe("+cart due:2026-10-12 created:2026-10-10 updated:2026-10-12");
      expect(current).toEqual(snapshot);
    } finally {
      cleanup();
      vi.useRealTimers();
    }
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
    expect(listTasks).toHaveBeenCalledTimes(1);
    expect(listTasks).toHaveBeenCalledWith({}, expect.objectContaining({ url: "" }));
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
