import { afterEach, describe, expect, it } from "vitest";
import {
  getAllowInvalidCert,
  getConflictStrategy,
  getServerUrl,
  setAllowInvalidCert,
  setConflictStrategy,
  setServerUrl,
} from "./settings";

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

describe("getConflictStrategy", () => {
  it("defaults to 'ask' when nothing is stored", () => {
    expect(getConflictStrategy()).toBe("ask");
  });

  it("falls back to 'ask' for an unrecognised stored value", () => {
    localStorage.setItem("ntr.conflictStrategy", "bogus");
    expect(getConflictStrategy()).toBe("ask");
  });

  it("round-trips 'server' and 'local'", () => {
    setConflictStrategy("server");
    expect(getConflictStrategy()).toBe("server");
    setConflictStrategy("local");
    expect(getConflictStrategy()).toBe("local");
  });
});

describe("setConflictStrategy", () => {
  it("removes the key for 'ask' (the default is the absence of the key)", () => {
    setConflictStrategy("server");
    setConflictStrategy("ask");
    expect(localStorage.getItem("ntr.conflictStrategy")).toBeNull();
    expect(getConflictStrategy()).toBe("ask");
  });
});

describe("getAllowInvalidCert", () => {
  it("defaults to false when nothing is stored", () => {
    expect(getAllowInvalidCert()).toBe(false);
  });

  it("returns true only for the exact stored '1' value", () => {
    setAllowInvalidCert(true);
    expect(getAllowInvalidCert()).toBe(true);
  });
});

describe("setAllowInvalidCert", () => {
  it("stores '1' when enabled", () => {
    setAllowInvalidCert(true);
    expect(localStorage.getItem("ntr.allowInvalidCert")).toBe("1");
  });

  it("removes the key when disabled (default is the absence of the key)", () => {
    setAllowInvalidCert(true);
    setAllowInvalidCert(false);
    expect(localStorage.getItem("ntr.allowInvalidCert")).toBeNull();
    expect(getAllowInvalidCert()).toBe(false);
  });
});
