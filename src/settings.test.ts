import { afterEach, describe, expect, it } from "vitest";
import { getServerUrl, setServerUrl } from "./settings";

afterEach(() => {
  localStorage.clear();
});

describe("getServerUrl", () => {
  it("returns empty string when key is absent", () => {
    expect(getServerUrl()).toBe("");
  });

  it("returns the stored URL after setServerUrl", () => {
    setServerUrl("http://127.0.0.1:8080");
    expect(getServerUrl()).toBe("http://127.0.0.1:8080");
  });
});

describe("setServerUrl", () => {
  it("stores a non-empty URL", () => {
    setServerUrl("http://example.com");
    expect(localStorage.getItem("ntr.serverUrl")).toBe("http://example.com");
  });

  it("removes the key when given an empty string", () => {
    setServerUrl("http://example.com");
    setServerUrl("");
    expect(localStorage.getItem("ntr.serverUrl")).toBeNull();
    expect(getServerUrl()).toBe("");
  });
});
