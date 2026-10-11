import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Task } from "../api";
import TaskItem from "./TaskItem";

afterEach(cleanup);

const task: Task = {
  id: 1, completed: false, priority: "A", creation_date: "2026-06-01", completion_date: null,
  description: "call @phone @store +work mail@phone https://site/@phone",
  projects: ["work"], contexts: ["phone", "store"], tags: {}, raw: "",
};

describe("TaskItem", () => {
  it("hides project/context tokens from description while retaining project metadata and ordinary @ text", () => {
    const { container } = render(<TaskItem task={task} onToggle={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(container.querySelector(".text")!.textContent).toBe("(A)call mail@phone https://site/@phone");
    expect(container.querySelector(".meta")!.textContent).toBe("created 2026-06-01 · +work");
  });

  it("shows fallback text for context-only tasks and retains edit/delete/complete actions", () => {
    const onToggle = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const contextOnly = { ...task, priority: null, creation_date: null, projects: [], description: "@phone @store" };
    render(<TaskItem task={contextOnly} onToggle={onToggle} onEdit={onEdit} onDelete={onDelete} />);
    expect(screen.getByText("Task without description")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onToggle).toHaveBeenCalledWith(contextOnly);
    expect(onEdit).toHaveBeenCalledWith(contextOnly);
    expect(onDelete).toHaveBeenCalledWith(contextOnly);
  });

  it("hides multiple and repeated project tokens while retaining each metadata project", () => {
    const multiple = { ...task, priority: null, creation_date: null, description: "call +work @phone +home +work", projects: ["work", "home"] };
    const { container } = render(<TaskItem task={multiple} onToggle={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(container.querySelector(".text")!.textContent).toBe("call");
    expect(container.querySelector(".meta")!.textContent).toBe("+work +home");
  });

  it("preserves embedded plus signs, URLs, and tokens absent from the parsed projects", () => {
    const boundaries = { ...task, priority: null, description: "C++ +workshop mail+work@example.com https://site/+work +work @phone" };
    const { container } = render(<TaskItem task={boundaries} onToggle={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(container.querySelector(".text")!.textContent).toBe("C++ +workshop mail+work@example.com https://site/+work");
    expect(container.querySelector(".meta")!.textContent).toBe("created 2026-06-01 · +work");
  });

  it("keeps parsed tags visible when hiding labels", () => {
    const tagged = { ...task, priority: null, description: "call +work @phone due:2026-06-30 pri:A custom:value", tags: { due: "2026-06-30", pri: "A", custom: "value" } };
    const { container } = render(<TaskItem task={tagged} onToggle={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(container.querySelector(".text")!.textContent).toBe("call due:2026-06-30 pri:A custom:value");
    expect(container.querySelector(".meta")!.textContent).toBe("created 2026-06-01 · +work");
  });

  it.each(["+work", "+work @phone"])("shows fallback text and project metadata for '%s'", (description) => {
    const labelsOnly = { ...task, priority: null, creation_date: null, description };
    const { container } = render(<TaskItem task={labelsOnly} onToggle={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(container.querySelector(".text")!.textContent).toBe("Task without description");
    expect(container.querySelector(".meta")!.textContent).toBe("+work");
  });

  it("retains an unlabelled description without inventing project metadata", () => {
    const unlabelled = { ...task, priority: null, creation_date: null, description: "call bank", projects: [], contexts: [] };
    const { container } = render(<TaskItem task={unlabelled} onToggle={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(container.querySelector(".text")!.textContent).toBe("call bank");
    expect(container.querySelector(".meta")).toBeNull();
  });

  it.each([false, true])("preserves lifecycle metadata and original action payloads when completed=%s", (completed) => {
    const original: Task = {
      ...task, completed, priority: completed ? null : "A", completion_date: completed ? "2026-06-02" : null,
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
    expect(container.querySelector(".text")!.textContent).toBe(`${completed ? "" : "(A)"}call due:2026-06-30`);
    expect(container.querySelector(".meta")!.textContent).toBe(`created 2026-06-01${completed ? " · done 2026-06-02" : ""} · +work`);
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
});
