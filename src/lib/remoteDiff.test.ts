import { describe, expect, it } from "vitest";
import type { Task } from "../api";
import { DIFF_WORK_BUDGET, PREVIEW_CHARACTERS, PREVIEW_ROWS, previewPage, remoteDiff, START } from "./remoteDiff";

const note = (baseline: string, snapshot: string) => remoteDiff({ resource: "note", baseline, snapshot, identity: snapshot });
const task = (id: number, raw: string): Task => ({ id, raw, description: raw, completed: false, creation_date: null, completion_date: null, projects: [], contexts: [], tags: {} });
describe("remote diff evidence", () => {
  it("shows changed lines with stable repeated and blank context", () => {
    const diff = note("same\n\nrepeat\nold\nrepeat", "same\n\nrepeat\nnew\nrepeat");
    expect(diff.sections.filter((section) => section.kind === "removed").map((section) => section.text)).toEqual(["old\n"]);
    expect(diff.sections.filter((section) => section.kind === "added").map((section) => section.text)).toEqual(["new\n"]);
    expect(diff.sections.filter((section) => section.kind === "context").map((section) => section.text)).toContain("\n");
  });
  it.each([["", "new"], ["old", ""], ["", ""], ["a\n", "a"]])("describes empty/trailing-newline evidence (%j → %j)", (before, after) => {
    const diff = note(before, after);
    expect(diff.summary).toContain(`accepted ${before.endsWith("\n") ? "yes" : "no"}; incoming ${after.endsWith("\n") ? "yes" : "no"}`);
    expect(diff.sections.length).toBeGreaterThan(0);
  });
  it("falls back before exceeding the LCS work budget", () => {
    const count = Math.ceil(Math.sqrt(DIFF_WORK_BUDGET));
    const before = Array.from({ length: count }, (_, index) => `old${index}`).join("\n");
    const after = Array.from({ length: count }, (_, index) => `new${index}`).join("\n");
    expect(note(before, after).sections).toEqual([{ kind: "removed", text: before }, { kind: "added", text: after }]);
    expect(note(before, after).summary).toContain("paged accepted/incoming blocks");
  });
  it.each(["x".repeat(100_000), "\n".repeat(30_000)])("bounds every page, including huge single lines and blank lines", (before) => {
    const document = note(before, before + "changed");
    let cursor = START, combined = "", pages = 0;
    for (;;) {
      const page = previewPage(document.sections, cursor);
      expect(page.characters).toBeLessThanOrEqual(PREVIEW_CHARACTERS);
      expect(page.rows).toBeLessThanOrEqual(PREVIEW_ROWS);
      expect(page.characters).toBeGreaterThan(0);
      combined += page.fragments.map((fragment) => fragment.text).join(""); pages++;
      if (!page.next) { expect(page.remaining).toBe(0); break; }
      expect(page.remaining).toBeGreaterThan(0); cursor = page.next;
    }
    expect(pages).toBeGreaterThan(1);
    expect(combined).toBe(document.sections.map((section) => section.text).join(""));
  });
  it("handles empty fallback sections without an infinite next page", () => {
    expect(previewPage([{ kind: "removed", text: "" }], START).next).toBeNull();
  });
  it("matches IDs, shows additions/removals and does not invent changes for reordering", () => {
    const a = task(1, "a +work"), b = task(2, "b @home");
    expect(remoteDiff({ resource: "tasks", baseline: [a, b], snapshot: [b, a], identity: "same" }).sections).toEqual([]);
    const diff = remoteDiff({ resource: "tasks", baseline: [a], snapshot: [{ ...a, id: 3 }], identity: "new" });
    expect(diff.sections.map((section) => section.kind)).toEqual(["removed", "added"]);
    expect(diff.sections[0].text).toContain("Task #1"); expect(diff.sections[1].text).toContain("Task #3");
  });
  it.each([{ raw: "edited +work" }, { completed: true }, { completion_date: "2026-10-30" }, { creation_date: "2026-01-01" }])("shows raw or lifecycle-only changes (%j)", (change) => {
    const old = task(1, "same");
    const diff = remoteDiff({ resource: "tasks", baseline: [old], snapshot: [{ ...old, ...change }], identity: "new" });
    expect(diff.sections.map((section) => section.kind)).toEqual(["removed", "added"]);
    expect(diff.sections[1].text).not.toBe(diff.sections[0].text);
  });
});
