import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import LabelModal from "./LabelModal";
import RemoveLabelDialog from "./RemoveLabelDialog";
import NoteConflictDialog from "./NoteConflictDialog";
import OpenLinkDialog from "./OpenLinkDialog";
import OptionsModal from "./OptionsModal";
import FilterBar from "./FilterBar";
import { cancelDialog, deferDialogCloseEvents } from "../test/dialog";

afterEach(cleanup);

const FAMILIES = ["label", "removal", "note conflict", "link"] as const;
type Family = typeof FAMILIES[number];

function ControlledModal({ family, onDismiss, onConfirm }: { family: Family; onDismiss(): void; onConfirm(): void }) {
  const [open, setOpen] = useState(true);
  function dismiss() { onDismiss(); setOpen(false); }
  function confirm() { onConfirm(); setOpen(false); }
  return <>
    <button type="button" onClick={() => setOpen(true)}>Reopen</button>
    <button type="button" onClick={() => setOpen(false)}>Owner closes</button>
    {family === "label" && <LabelModal kind={open ? "list" : null} onClose={dismiss} onConfirm={confirm} />}
    {family === "removal" && <RemoveLabelDialog target={open ? { kind: "list", name: "work" } : null} onCancel={dismiss} onConfirm={confirm} />}
    {family === "note conflict" && <NoteConflictDialog open={open} mine="unsaved work" theirs="incoming work" onClose={dismiss} onKeepMine={confirm} onUseTheirs={confirm} />}
    {family === "link" && <OpenLinkDialog url={open ? "https://example.com" : null} onCancel={dismiss} onConfirm={confirm} />}
  </>;
}

describe("externally controlled modal lifecycle", () => {
  it.each(FAMILIES.flatMap((family) => ["backdrop", "native cancel"].map((method) => ({ family, method }))))(
    "$family dismissal through $method updates its owner once without confirming", ({ family, method }) => {
      const onDismiss = vi.fn();
      const onConfirm = vi.fn();
      render(<ControlledModal family={family} onDismiss={onDismiss} onConfirm={onConfirm} />);
      const dialog = document.querySelector("dialog") as HTMLDialogElement;
      expect(dialog.open).toBe(true);
      if (method === "backdrop") fireEvent.click(dialog);
      else cancelDialog(dialog);
      expect(dialog.open).toBe(false);
      expect(onDismiss).toHaveBeenCalledOnce();
      expect(onConfirm).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
      expect(dialog.open).toBe(true);
      expect(onDismiss).toHaveBeenCalledOnce();
    },
  );

  it.each(["label", "removal", "link"] as const)("%s Cancel does not confirm or cancel twice", (family) => {
    const onDismiss = vi.fn();
    const onConfirm = vi.fn();
    render(<ControlledModal family={family} onDismiss={onDismiss} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect((document.querySelector("dialog") as HTMLDialogElement).open).toBe(false);
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it.each(FAMILIES)("%s confirmation does not invoke cancellation on the subsequent close", (family) => {
    const onDismiss = vi.fn();
    const onConfirm = vi.fn();
    render(<ControlledModal family={family} onDismiss={onDismiss} onConfirm={onConfirm} />);
    if (family === "label") fireEvent.change(screen.getByRole("textbox", { name: "New label name" }), { target: { value: "garden" } });
    const button = { label: "Add", removal: "Remove", "note conflict": "Use theirs", link: "Open" }[family];
    fireEvent.click(screen.getByRole("button", { name: button }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onDismiss).not.toHaveBeenCalled();
    expect((document.querySelector("dialog") as HTMLDialogElement).open).toBe(false);
  });

  it.each(FAMILIES)("%s ignores an old programmatic close after reopening", (family) => {
    const deferred = deferDialogCloseEvents();
    const onDismiss = vi.fn();
    try {
      render(<ControlledModal family={family} onDismiss={onDismiss} onConfirm={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: "Owner closes" }));
      fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
      deferred.flush();
      expect((document.querySelector("dialog") as HTMLDialogElement).open).toBe(true);
      expect(onDismiss).not.toHaveBeenCalled();
    } finally {
      deferred.restore();
    }
  });

  it("dismissing a sibling link overlay leaves the existing Options modal usable", () => {
    const onConfirm = vi.fn();
    function Owner() {
      const [url, setUrl] = useState<string | null>(null);
      return <>
        <OptionsModal ariaLabel="Task options"><button type="button" onClick={() => setUrl("https://example.com")}>Show overlay</button></OptionsModal>
        <OpenLinkDialog url={url} onConfirm={onConfirm} onCancel={() => setUrl(null)} />
      </>;
    }
    render(<Owner />);
    fireEvent.click(screen.getByRole("button", { name: "Task options" }));
    fireEvent.click(screen.getByRole("button", { name: "Show overlay" }));
    const overlay = document.getElementById("open-link-dialog") as HTMLDialogElement;
    cancelDialog(overlay);
    expect(overlay.open).toBe(false);
    const options = document.querySelector("dialog.options-modal") as HTMLDialogElement;
    expect(options.open).toBe(true);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(within(options).getByRole("button", { name: "Done" }));
    expect(options.open).toBe(false);
  });

  it("hands off a filter picker to a sibling removal prompt without losing Options", () => {
    const deferred = deferDialogCloseEvents();
    const onConfirm = vi.fn();
    try {
      function Owner() {
        const [target, setTarget] = useState<{ kind: "list"; name: string } | null>(null);
        return <>
          <FilterBar compact list="work" sort="file" dir="asc" serverLabels={{ list: ["work"], context: [] }}
            onList={vi.fn()} onSort={vi.fn()} onDir={vi.fn()} onRemove={(kind, name) => setTarget({ kind, name })} />
          <RemoveLabelDialog target={target} onConfirm={onConfirm} onCancel={() => setTarget(null)} />
        </>;
      }
      render(<Owner />);
      fireEvent.click(screen.getByRole("button", { name: "Filter options" }));
      fireEvent.click(screen.getByRole("button", { name: "List filter" }));
      const picker = document.querySelector("dialog.select-modal[open]") as HTMLDialogElement;
      fireEvent.click(within(picker).getByRole("button", { name: "Remove work" }));
      const prompt = document.getElementById("remove-label-dialog") as HTMLDialogElement;
      const options = document.querySelector("dialog.options-modal") as HTMLDialogElement;
      expect(prompt.open).toBe(true);
      expect(picker.open).toBe(false);
      deferred.flush();
      expect(prompt.open).toBe(true);
      expect(options.open).toBe(true);
      fireEvent.click(within(prompt).getByRole("button", { name: "Cancel" }));
      deferred.flush();
      expect(prompt.open).toBe(false);
      expect(options.open).toBe(true);
      expect(onConfirm).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "List filter" }).textContent).toBe("work");
      fireEvent.click(screen.getByRole("button", { name: "List filter" }));
      expect(picker.open).toBe(true);
    } finally {
      deferred.restore();
    }
  });
});
