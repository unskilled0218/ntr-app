import { afterEach, describe, expect, it, vi } from "vitest";

// Mock the Tauri plugin seam: openLink must call it for allowed schemes and never for disallowed ones,
// without a Tauri runtime present.
const openUrl = vi.fn<(url: string) => Promise<void>>();
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: (url: string) => openUrl(url) }));

import { openLink } from "./openLink";

afterEach(() => openUrl.mockReset());

describe("openLink", () => {
  it("opens http, https and mailto URLs via the opener plugin", () => {
    openUrl.mockResolvedValue(undefined);
    openLink("https://x.io");
    openLink("http://x.io/a?b=1&c=2");
    openLink("mailto:a@b.com");
    expect(openUrl.mock.calls).toEqual([["https://x.io"], ["http://x.io/a?b=1&c=2"], ["mailto:a@b.com"]]);
  });

  it("ignores other schemes so a crafted note cannot reach the system handler", () => {
    openLink("javascript:alert(1)");
    openLink("file:///etc/passwd");
    openLink("data:text/html,<script>1</script>");
    openLink("not a url");
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("swallows a rejected open so it never throws into the editor", () => {
    openUrl.mockRejectedValue(new Error("no runtime"));
    expect(() => openLink("https://x.io")).not.toThrow();
  });
});
