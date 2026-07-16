import { afterEach, describe, expect, it, vi } from "vitest";
import { writeClipboard } from "./clipboard";

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const originalExecCommand = document.execCommand;

afterEach(() => {
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
  document.execCommand = originalExecCommand;
});

describe("writeClipboard", () => {
  it("uses navigator.clipboard.writeText when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

    await writeClipboard("hello");

    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("falls back to execCommand when navigator.clipboard is unavailable", async () => {
    Reflect.deleteProperty(navigator, "clipboard");
    document.execCommand = vi.fn().mockReturnValue(true);

    await writeClipboard("hello");

    expect(document.execCommand).toHaveBeenCalledWith("copy");
  });

  it("throws when both clipboard paths fail", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    document.execCommand = vi.fn().mockReturnValue(false);

    await expect(writeClipboard("hello")).rejects.toThrow("clipboard write failed");
  });
});
