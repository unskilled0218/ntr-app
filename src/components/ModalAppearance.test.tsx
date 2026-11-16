import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import css from "../style.css?raw";

// jsdom checks the cascade and DOM contract, not real-browser geometry/top-layer behavior.
const sources = import.meta.glob<string>("./*.tsx", { query: "?raw", import: "default", eager: true });
const variants = [
  ["settings-modal", ""], ["label-modal", ""], ["edit-task-modal", ""],
  ["rename-list-dialog", "action-modal rename-modal"], ["remove-label-dialog", ""],
  ["ha-confirmation", ""], ["select-picker", "select-modal"], ["sort-picker", "select-modal"],
  ["compact-options", "options-modal"], ["remote-update", "action-modal remote-modal"],
  ["conflict-dialog", ""], ["note-conflict", ""], ["open-link-dialog", ""],
] as const;
let sheet: HTMLStyleElement;
beforeEach(() => {
  sheet = document.createElement("style"); sheet.textContent = css; document.head.append(sheet);
});
afterEach(() => { cleanup(); sheet.remove(); });

function rule(selector: string): CSSStyleDeclaration {
  const found = [...sheet.sheet!.cssRules].find((entry) => "selectorText" in entry && String(entry.selectorText).split(",").map((part) => part.trim()).includes(selector)) as CSSStyleRule | undefined;
  expect(found, `missing shared modal rule: ${selector}`).toBeDefined();
  return found!.style;
}

function declaration(selector: string, property: string, value: string) {
  const expected = document.createElement("div").style;
  expected.setProperty(property, value);
  expect(rule(selector).getPropertyValue(property)).toBe(expected.getPropertyValue(property));
}

function surface(dialog: HTMLElement) {
  const style = getComputedStyle(dialog);
  return Object.fromEntries(["background-color", "border-top-width", "border-top-style", "border-top-color", "border-radius", "padding", "color", "font-size", "font-family", "line-height"].map((key) => [key, style.getPropertyValue(key)]));
}

describe("Settings-style modal contract", () => {
  it("opts every production dialog template into the shared surface", () => {
    const templates = Object.entries(sources).filter(([path]) => !path.endsWith(".test.tsx"))
      .flatMap(([path, source]) => [...source.matchAll(/<dialog\s+[^>]*>/g)].map(([tag]) => ({ path, tag })));
    expect(templates.length).toBeGreaterThanOrEqual(13);
    for (const { path, tag } of templates) {
      expect(tag.match(/className="([^"]+)"/)?.[1].split(/\s+/), path).toContain("app-modal");
    }
  });

  it.each(variants)("gives %s the same shell as Settings", (id, specialized) => {
    const { container } = render(<>
      <dialog className="app-modal" open data-testid="reference" />
      <dialog id={id} className={`app-modal ${specialized}`} open data-testid="subject" />
    </>);
    expect(surface(container.querySelector('[data-testid="subject"]')!)).toEqual(surface(container.querySelector('[data-testid="reference"]')!));
    const style = getComputedStyle(container.querySelector('[data-testid="subject"]')!);
    expect(style.borderRadius).toBe("8px");
    expect(style.padding).toBe("20px");
    expect(style.borderTopWidth).toBe("1px");
  });

  it("lays out only open dialogs and leaves closed dialogs hidden", () => {
    const { container } = render(<><dialog className="app-modal" /><dialog className="app-modal" open /></>);
    const [closed, opened] = container.querySelectorAll("dialog");
    expect(getComputedStyle(closed).display).toBe("none");
    expect(getComputedStyle(opened).display).toBe("flex");
    expect(getComputedStyle(opened).gap).toBe("12px");
  });

  it("shares heading, field and form spacing without inherited picker font shrinkage", () => {
    const { container } = render(<dialog className="app-modal" open>
      <form><h2>Title</h2><label>Name<input /></label><p>Explanation</p>
        <label>Picker<dialog className="app-modal select-modal" open><h2>Choices</h2></dialog></label>
      </form>
    </dialog>);
    expect(getComputedStyle(container.querySelector("h2")!).fontSize).toBe("17.6px");
    expect(getComputedStyle(container.querySelector("h2")!).margin).toBe("0px");
    expect(getComputedStyle(container.querySelector("form")!).gap).toBe("12px");
    expect(getComputedStyle(container.querySelector("label")!).gap).toBe("3.2px");
    expect(getComputedStyle(container.querySelector("label")!).fontSize).toBe("12.8px");
    expect(getComputedStyle(container.querySelector("p")!).margin).toBe("0px");
    expect(surface(container.querySelector("dialog dialog")!)).toEqual(surface(container.querySelector("dialog")!));
    expect(getComputedStyle(container.querySelector("input")!).borderRadius).toBe("6px");
  });

  it("bounds all modal shells and preserves scrollable wide previews", () => {
    const shell = rule("dialog.app-modal");
    declaration("dialog.app-modal", "min-width", "min(22rem, calc(100vw - 2rem))");
    declaration("dialog.app-modal", "max-width", "min(36rem, calc(100vw - 2rem))");
    declaration("dialog.app-modal", "max-height", "calc(100dvh - 2rem)");
    expect(shell.getPropertyValue("overflow-y")).toBe("auto");
    expect(shell.getPropertyValue("overflow-wrap")).toBe("anywhere");
    expect(rule("dialog.app-modal.remote-modal").getPropertyValue("width")).toBe("48rem");
    expect(rule(".remote-preview").getPropertyValue("overflow")).toBe("auto");
    expect(rule(".note-conflict-versions").getPropertyValue("flex-wrap")).toBe("wrap");
  });

  it("keeps primary, destructive and selected actions distinct and keyboard focus visible", () => {
    const { container } = render(<dialog className="app-modal" open><div className="modal-actions">
      <button>Cancel</button><button className="primary">Confirm</button><button type="submit">Submit</button>
      <button className="picker-remove">Remove</button><button className="picker-choice" aria-current="true">Selected</button>
    </div></dialog>);
    const [neutral, primary, submit, destructive, selected] = container.querySelectorAll("button");
    expect(getComputedStyle(container.querySelector(".modal-actions")!).flexWrap).toBe("wrap");
    expect(getComputedStyle(neutral).backgroundColor).toBe("rgb(255, 255, 255)");
    expect(getComputedStyle(primary).backgroundColor).toBe("rgb(37, 99, 235)");
    expect(getComputedStyle(submit).backgroundColor).toBe("rgb(37, 99, 235)");
    expect(getComputedStyle(destructive).color).toBe("rgb(185, 28, 28)");
    expect(getComputedStyle(selected).color).toBe("rgb(37, 99, 235)");
    expect(rule(".app-modal :focus-visible").getPropertyValue("outline")).toBe("2px solid var(--accent)");
  });

  it("uses the same white surface behind the sticky update actions", () => {
    const footer = rule(".remote-modal > .modal-actions");
    expect(footer.getPropertyValue("position")).toBe("sticky");
    expect(footer.getPropertyValue("background")).toBe("var(--modal-bg)");
    expect(rule("dialog.app-modal").getPropertyValue("--modal-bg")).toBe("#fff");
  });
});
