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
  it("hides context tokens in description and metadata while retaining ordinary @ text", () => {
    const { container } = render(<TaskItem task={task} onToggle={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(container.querySelector(".text")!.textContent).toBe("(A)call +work mail@phone https://site/@phone");
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
});
