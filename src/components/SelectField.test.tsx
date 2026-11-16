import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import SelectField, { type FieldOption } from "./SelectField";
import { cancelDialog, clickWithRemovedTargetLabelActivation, deferDialogCloseEvents } from "../test/dialog";
import type { ListSelectorSession } from "../lib/listActions";

// The jsdom <dialog>.showModal()/close() polyfill lives in src/test/setup.ts (vitest setupFiles).

const OPTIONS: FieldOption[] = [
  { value: "", label: "All lists" },
  { value: "work", label: "work", removable: true },
  { value: "home", label: "home", removable: true },
];

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup(); });

// The single open picker dialog.
const openDialog = () => within(document.querySelector("dialog.select-modal[open]") as HTMLElement);

describe("SelectField", () => {
  it("retains an Add action choice, restores its row once, and still closes ordinary selection", () => {
    let session: ListSelectorSession | undefined;
    const change = vi.fn((_value: string, origin?: ListSelectorSession) => { session = origin; });
    render(<SelectField ariaLabel="List" value="work" options={[{ value: "+add", label: "+ Add list..." }, ...OPTIONS]} retainChoices={["+add"]} onChange={change} />);
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    const opened = document.querySelector("dialog.select-modal[open]") as HTMLDialogElement;
    const add = within(opened).getByRole("button", { name: "+ Add list..." }); fireEvent.click(add);
    expect(opened.open).toBe(true); expect(change).toHaveBeenCalledWith("+add", expect.any(Object));
    act(() => session!.restore("+add")); expect(document.activeElement).toBe(add);
    act(() => { expect(session!.close()).toBe(false); session!.restore("home"); });
    expect(document.activeElement).toBe(add); expect(opened.open).toBe(true);
    fireEvent.click(within(opened).getByRole("button", { name: "home" })); expect(opened.open).toBe(false);
  });
  it("invalidates an old scoped session without closing or focusing a newer picker", () => {
    let session: ListSelectorSession | undefined;
    const props = { ariaLabel:"List", value:"work", options:OPTIONS, retainActions:true, onChange:vi.fn(), onRemove:(_value:string, origin?:ListSelectorSession) => { session = origin; } };
    const view = render(<SelectField {...props} scopeKey="one" />);
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    fireEvent.click(openDialog().getByRole("button", { name: "Remove work" })); const old = session!;
    view.rerender(<SelectField {...props} scopeKey="two" />);
    expect(document.querySelector("dialog.select-modal[open]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    const cancel = openDialog().getByRole("button", { name: "Cancel" }); cancel.focus();
    act(() => { old.restore("work"); expect(old.close()).toBe(false); });
    expect(document.activeElement).toBe(cancel); expect(document.querySelector("dialog.select-modal[open]")).toBeTruthy();
  });
  it("restores removal focus to Remove rather than the neighboring Rename control", () => {
    let session: ListSelectorSession | undefined;
    render(<SelectField ariaLabel="List" value="work" options={[{ value:"work", label:"work", renamable:true, removable:true }]} onChange={vi.fn()} retainActions onRename={vi.fn()} onRemove={(_name, origin) => { session = origin; }} />);
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    const remove = openDialog().getByRole("button", { name: "Remove work" }); fireEvent.click(remove);
    act(() => session!.restore("work")); expect(document.activeElement).toBe(remove);
  });
  it("waits for the mapped revision before focusing and ignores an obsolete session", () => {
    let session: ListSelectorSession | undefined;
    const onRename = vi.fn((_name: string, origin?: ListSelectorSession) => { session = origin; });
    const options = [{ value: "work", label: "work", renamable: true }];
    const view = render(<SelectField ariaLabel="List" value="work" options={options} onChange={vi.fn()} onRename={onRename} retainActions revision={0} />);
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    const old = openDialog().getByRole("button", { name: "Rename work" }); old.focus(); fireEvent.click(old);
    act(() => session!.restore("team", 1));
    expect(document.activeElement).toBe(old);
    view.rerender(<SelectField ariaLabel="List" value="team" options={[{ value: "team", label: "team", renamable: true }]} onChange={vi.fn()} onRename={onRename} retainActions revision={1} />);
    expect(document.activeElement).toBe(openDialog().getByRole("button", { name: "Rename team" }));
    const obsolete = session!;
    fireEvent.click(openDialog().getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    const cancel = openDialog().getByRole("button", { name: "Cancel" }); cancel.focus();
    act(() => obsolete.restore("team", 1));
    expect(document.activeElement).toBe(cancel);
    act(() => obsolete.close()); expect(document.querySelector("dialog.select-modal[open]")).toBeTruthy();
  });
  it("shows the selected option's label on the trigger", () => {
    render(<SelectField ariaLabel="List filter" value="work" options={OPTIONS} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /list filter/i }).textContent).toBe("work");
  });

  it("is closed until the trigger is clicked, then lists every option", () => {
    render(<SelectField ariaLabel="List filter" value="" options={OPTIONS} onChange={vi.fn()} />);
    expect(document.querySelector("dialog.select-modal[open]")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /list filter/i }));
    // The dialog carries the field's accessible name (matches the visible title).
    expect(screen.getByRole("dialog", { name: /list filter/i })).toBeTruthy();
    const dialog = openDialog();
    expect(dialog.getByRole("button", { name: "All lists" })).toBeTruthy();
    expect(dialog.getByRole("button", { name: "work" })).toBeTruthy();
    expect(dialog.getByRole("button", { name: "home" })).toBeTruthy();
  });

  it("calls onChange with the chosen value and closes the dialog", () => {
    const onChange = vi.fn();
    render(<SelectField ariaLabel="List filter" value="" options={OPTIONS} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /list filter/i }));
    fireEvent.click(openDialog().getByRole("button", { name: "work" }));

    expect(onChange).toHaveBeenCalledWith("work");
    expect(document.querySelector("dialog.select-modal[open]")).toBeNull();
  });

  it("shows a Remove button on removable rows and calls onRemove (closing the picker first)", () => {
    const onRemove = vi.fn();
    render(
      <SelectField ariaLabel="List filter" value="" options={OPTIONS} onChange={vi.fn()} onRemove={onRemove} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /list filter/i }));
    const dialog = openDialog();
    // The "All lists" row is not removable; the label rows are.
    expect(dialog.queryByRole("button", { name: /remove all lists/i })).toBeNull();
    fireEvent.click(dialog.getByRole("button", { name: /remove work/i }));

    expect(onRemove).toHaveBeenCalledWith("work");
    expect(document.querySelector("dialog.select-modal[open]")).toBeNull();
  });

  it("shows no Remove buttons when onRemove is not provided", () => {
    render(<SelectField ariaLabel="List filter" value="" options={OPTIONS} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /list filter/i }));
    expect(openDialog().queryByRole("button", { name: /remove/i })).toBeNull();
  });

  // Backdrop dismissal (useBackdropClose via usePickerDialog) — also covers SortField/OptionsModal,
  // which share the same hook.
  it("closes when the backdrop (the dialog element itself) is clicked", () => {
    render(<SelectField ariaLabel="List filter" value="" options={OPTIONS} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /list filter/i }));
    const dialog = document.querySelector("dialog.select-modal") as HTMLElement;
    expect(dialog.hasAttribute("open")).toBe(true);

    fireEvent.click(dialog); // e.target === dialog -> a backdrop click
    expect(document.querySelector("dialog.select-modal[open]")).toBeNull();
  });

  it("stays open when a click lands on inner content rather than the backdrop", () => {
    render(<SelectField ariaLabel="List filter" value="" options={OPTIONS} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /list filter/i }));
    fireEvent.click(openDialog().getByText("List filter")); // the title <h2>, target !== dialog
    expect(document.querySelector("dialog.select-modal[open]")).not.toBeNull();
  });

  it.each(["Cancel", "native cancel"])("closes and reopens a standalone picker through %s", (method) => {
    const onChange = vi.fn();
    render(<SelectField ariaLabel="List filter" value="work" options={OPTIONS} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "List filter" }));
    const dialog = document.querySelector("dialog.select-modal") as HTMLDialogElement;
    if (method === "native cancel") cancelDialog(dialog);
    else fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(dialog.open).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "List filter" }));
    expect(dialog.open).toBe(true);
  });

  it("ignores a deferred close when its trigger has reopened the picker", () => {
    const deferred = deferDialogCloseEvents();
    try {
      render(<SelectField ariaLabel="List filter" value="work" options={OPTIONS} onChange={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: "List filter" }));
      fireEvent.click(openDialog().getByRole("button", { name: "Cancel" }));
      fireEvent.click(screen.getByRole("button", { name: "List filter" }));
      deferred.flush();
      expect((document.querySelector("dialog.select-modal") as HTMLDialogElement).open).toBe(true);
      expect(openDialog().getByRole("button", { name: "work" })).toBeTruthy();
    } finally {
      deferred.restore();
    }
  });

  it.each(["choice", "removal"])("is natively closed before handing off a %s action", (action) => {
    const observed: boolean[] = [];
    const onAction = vi.fn(() => observed.push((document.querySelector("dialog.select-modal") as HTMLDialogElement).open));
    render(<SelectField ariaLabel="List" value="work" options={OPTIONS} onChange={onAction} onRemove={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    fireEvent.click(openDialog().getByRole("button", { name: action === "choice" ? "home" : "Remove work" }));
    expect(observed).toEqual([false]);
    expect(onAction).toHaveBeenCalledOnce();
    expect(onAction).toHaveBeenCalledWith(action === "choice" ? "home" : "work");
  });

  it.each(["List"])("keeps label-wrapped %s closed under modeled removed-target label activation", (name) => {
    const onChange = vi.fn();
    render(<label>{name}<SelectField ariaLabel={name} value="work" options={OPTIONS} onChange={onChange} /></label>);
    const trigger = screen.getByRole("button", { name });
    for (let cycle = 0; cycle < 2; cycle++) {
      fireEvent.click(trigger);
      const dialog = document.querySelector("dialog.select-modal") as HTMLDialogElement;
      expect(dialog.open).toBe(true);
      clickWithRemovedTargetLabelActivation(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(dialog.open).toBe(false);
      expect(trigger.textContent).toBe("work");
      expect(onChange).not.toHaveBeenCalled();
    }
  });

  it.each(["choice", "removal"])("does not reactivate a label-wrapped picker after a modeled %s click", (action) => {
    const onChange = vi.fn();
    const onRemove = vi.fn();
    render(<label>List<SelectField ariaLabel="List" value="work" options={OPTIONS} onChange={onChange} onRemove={onRemove} /></label>);
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    const dialog = document.querySelector("dialog.select-modal") as HTMLDialogElement;
    clickWithRemovedTargetLabelActivation(within(dialog).getByRole("button", { name: action === "choice" ? "home" : "Remove work" }));
    expect(dialog.open).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(action === "choice" ? 1 : 0);
    expect(onRemove).toHaveBeenCalledTimes(action === "removal" ? 1 : 0);
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    expect(dialog.open).toBe(true);
  });
});
