import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Task } from "../api";
import TaskItem from "./TaskItem";

afterEach(cleanup);

const task: Task = {
  id: 1, completed: false, creation_date: "2026-06-01", completion_date: null,
  description: "call @phone @store +work mail@phone https://site/@phone",
  lists: ["work"], contexts: ["phone", "store"], tags: {}, raw: "",
};

describe("TaskItem", () => {
  it("displays datetime due with its offset once, without hiding malformed date tokens", () => {
    const due = "2026-11-16T23:30:00-05:00";
    const { container } = render(<TaskItem task={{ ...task, description: `call due:${due} updated:bad`, tags: { due, updated: "bad" } }} onToggle={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(container.querySelector(".meta")!.textContent).toContain(`due:${due}`);
    expect(container.querySelector(".text")!.textContent).toBe("call updated:bad");
  });
  it("hides list/context tokens from description while retaining list metadata and ordinary @ text", () => {
    const { container } = render(<TaskItem task={task} onToggle={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(container.querySelector(".text")!.textContent).toBe("call mail@phone https://site/@phone");
    expect(container.querySelector(".priority")).toBeNull();
    expect(container.querySelector(".meta")!.textContent).toBe("+work created:2026-06-01");
  });

  it("shows fallback text for context-only tasks and retains edit/delete/complete actions", () => {
    const onToggle = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const contextOnly = { ...task, priority: null, creation_date: null, lists: [], description: "@phone @store" };
    render(<TaskItem task={contextOnly} onToggle={onToggle} onEdit={onEdit} onDelete={onDelete} />);
    expect(screen.getByText("Task without description")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onToggle).toHaveBeenCalledWith(contextOnly);
    expect(onEdit).toHaveBeenCalledWith(contextOnly);
    expect(onDelete).toHaveBeenCalledWith(contextOnly);
  });

  it("hides multiple and repeated list tokens while retaining each metadata list", () => {
    const multiple = { ...task, priority: null, creation_date: null, description: "call +work @phone +home +work", lists: ["work", "home"] };
    const { container } = render(<TaskItem task={multiple} onToggle={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(container.querySelector(".text")!.textContent).toBe("call");
    expect(container.querySelector(".meta")!.textContent).toBe("+work +home");
  });

  it("preserves embedded plus signs, URLs, and tokens absent from the parsed lists", () => {
    const boundaries = { ...task, priority: null, description: "C++ +workshop mail+work@example.com https://site/+work +work @phone" };
    const { container } = render(<TaskItem task={boundaries} onToggle={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(container.querySelector(".text")!.textContent).toBe("C++ +workshop mail+work@example.com https://site/+work");
    expect(container.querySelector(".meta")!.textContent).toBe("+work created:2026-06-01");
  });

  it("relocates due while keeping unrelated parsed tags visible", () => {
    const tagged = { ...task, priority: null, description: "call +work @phone due:2026-06-30 pri:A custom:value", tags: { due: "2026-06-30", pri: "A", custom: "value" } };
    const { container } = render(<TaskItem task={tagged} onToggle={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(container.querySelector(".text")!.textContent).toBe("call pri:A custom:value");
    expect(container.querySelector(".meta")!.textContent).toBe("+work due:2026-06-30 created:2026-06-01");
  });

  it.each(["+work", "+work @phone"])("shows fallback text and list metadata for '%s'", (description) => {
    const labelsOnly = { ...task, priority: null, creation_date: null, description };
    const { container } = render(<TaskItem task={labelsOnly} onToggle={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(container.querySelector(".text")!.textContent).toBe("Task without description");
    expect(container.querySelector(".meta")!.textContent).toBe("+work");
  });

  it("retains an unlabelled description without inventing list metadata", () => {
    const unlabelled = { ...task, priority: null, creation_date: null, description: "call bank", lists: [], contexts: [] };
    const { container } = render(<TaskItem task={unlabelled} onToggle={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(container.querySelector(".text")!.textContent).toBe("call bank");
    expect(container.querySelector(".meta")).toBeNull();
  });

  it.each([false, true])("preserves lifecycle metadata and original action payloads when completed=%s", (completed) => {
    const original: Task = {
      ...task, completed, completion_date: completed ? "2026-06-02" : null,
      description: "call +work @phone due:2026-06-30", tags: { due: "2026-06-30" },
      raw: `${completed ? "x 2026-06-02" : "(A)"} 2026-06-01 call +work @phone due:2026-06-30`,
    };
    const snapshot = structuredClone(original);
    const onToggle = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const { container } = render(<TaskItem task={original} onToggle={onToggle} onEdit={onEdit} onDelete={onDelete} />);
    expect(container.querySelector("li.task")!.classList.contains("completed")).toBe(completed);
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(completed);
    expect(container.querySelector(".text")!.textContent).toBe("call");
    expect(container.querySelector(".meta")!.textContent).toBe(`+work due:2026-06-30 created:2026-06-01${completed ? " done:2026-06-02" : ""}`);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onToggle).toHaveBeenCalledOnce();
    expect(onToggle.mock.calls[0][0]).toBe(original);
    expect(onEdit).toHaveBeenCalledOnce();
    expect(onEdit.mock.calls[0][0]).toBe(original);
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onDelete.mock.calls[0][0]).toBe(original);
    expect(original).toEqual(snapshot);
  });

  it("renders the supplied example with creation and update dates together", () => {
    const example = { ...task, priority: null, creation_date: "2026-10-10", lists: ["cart"], contexts: [],
      description: "Do something +cart due:2026-10-12 updated:2026-10-11", tags: { due: "2026-10-12", updated: "2026-10-11" } };
    const { container } = render(<TaskItem task={example} onToggle={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(container.querySelector(".text")!.textContent).toBe("Do something");
    expect(container.querySelector(".meta")!.textContent).toBe("+cart due:2026-10-12 created:2026-10-10 updated:2026-10-11");
  });

  it.each(["due", "updated"])("uses effective %s tag precedence without losing invalid legacy text", (key) => {
    for (const invalidLast of [false, true]) {
      const tokens = invalidLast ? [`${key}:2026-10-11`, `${key}:later`] : [`${key}:later`, `${key}:2026-10-11`];
      const source = { ...task, priority: null, creation_date: null, lists: [], contexts: [], description: `call ${tokens.join(" ")}`, tags: { [key]: invalidLast ? "later" : "2026-10-11" } };
      const snapshot = structuredClone(source);
      const { container, unmount } = render(<TaskItem task={source} onToggle={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
      expect(container.querySelector(".text")!.textContent).toBe(invalidLast ? source.description : `call ${key}:later`);
      expect(container.querySelector(".meta")?.textContent ?? "").toBe(invalidLast ? "" : `${key}:2026-10-11`);
      expect(source).toEqual(snapshot);
      unmount();
    }
  });

  it("hides duplicate valid housekeeping only for displayed keys and preserves boundaries", () => {
    const source = { ...task, priority: null, creation_date: null, lists: [], contexts: [],
      description: "call due:2026-10-10 due:2026-10-11 updated:2026-10-11 updated:2026-10-11 updated:bad updatedAt:2026-10-11 https://site/updated:2026-10-11 custom:value",
      tags: { due: "2026-10-11", updated: "bad", custom: "value" } };
    const { container } = render(<TaskItem task={source} onToggle={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(container.querySelector(".text")!.textContent).toBe("call updated:2026-10-11 updated:2026-10-11 updated:bad updatedAt:2026-10-11 https://site/updated:2026-10-11 custom:value");
    expect(container.querySelector(".meta")!.textContent).toBe("due:2026-10-11");
  });

  it("shows a date-only fallback without inventing a creation date", () => {
    const source = { ...task, priority: null, creation_date: null, description: "+work @phone updated:2026-10-11", tags: { updated: "2026-10-11" } };
    const { container } = render(<TaskItem task={source} onToggle={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(container.querySelector(".text")!.textContent).toBe("Task without description");
    expect(container.querySelector(".meta")!.textContent).toBe("+work updated:2026-10-11");
  });
});
