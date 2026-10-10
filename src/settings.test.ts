import { afterEach, describe, expect, it } from "vitest";
import {
  getAllowInvalidCert,
  getCompactUi,
  getConflictStrategy,
  getDirection,
  getLastView,
  getServerUrl,
  getSort,
  getStartupView,
  clearLegacyTodoPreferences,
  setAllowInvalidCert,
  setCompactUi,
  setConflictStrategy,
  setDirection,
  setLastView,
  setServerUrl,
  setSort,
  setStartupView,
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

describe("getCompactUi / setCompactUi", () => {
  it("defaults to false when nothing is stored", () => {
    expect(getCompactUi()).toBe(false);
  });

  it("stores '1' when enabled and reads back true", () => {
    setCompactUi(true);
    expect(localStorage.getItem("ntr.compactUi")).toBe("1");
    expect(getCompactUi()).toBe(true);
  });

  it("removes the key when disabled (default is the absence of the key)", () => {
    setCompactUi(true);
    setCompactUi(false);
    expect(localStorage.getItem("ntr.compactUi")).toBeNull();
    expect(getCompactUi()).toBe(false);
  });
});

describe("clearLegacyTodoPreferences", () => {
  it.each(["active", "completed", "all", "bogus"])("removes legacy status %s without changing sort options", (status) => {
    localStorage.setItem("ntr.status", status);
    setSort("priority");
    setDirection("desc");
    clearLegacyTodoPreferences();
    expect(localStorage.getItem("ntr.status")).toBeNull();
    expect(getSort()).toBe("priority");
    expect(getDirection()).toBe("desc");
  });
});

describe("getSort / setSort", () => {
  it("defaults to 'file' when nothing is stored", () => {
    expect(getSort()).toBe("file");
  });

  it("falls back to 'file' for a key not in SORTS (e.g. the removed 'alpha')", () => {
    localStorage.setItem("ntr.sort", "alpha");
    expect(getSort()).toBe("file");
  });

  it("round-trips a valid non-default sort key", () => {
    setSort("priority");
    expect(localStorage.getItem("ntr.sort")).toBe("priority");
    expect(getSort()).toBe("priority");
  });

  it("falls back from the removed contexts sort while retaining direction", () => {
    localStorage.setItem("ntr.sort", "contexts");
    setDirection("desc");
    expect(getSort()).toBe("file");
    expect(getDirection()).toBe("desc");
  });

  it("removes the key for 'file' (default is the absence of the key)", () => {
    setSort("priority");
    setSort("file");
    expect(localStorage.getItem("ntr.sort")).toBeNull();
    expect(getSort()).toBe("file");
  });
});

describe("getDirection / setDirection", () => {
  it("defaults to 'asc' when nothing is stored", () => {
    expect(getDirection()).toBe("asc");
  });

  it("falls back to 'asc' for a value not in DIRECTIONS", () => {
    localStorage.setItem("ntr.sortDir", "sideways");
    expect(getDirection()).toBe("asc");
  });

  it("round-trips 'desc'", () => {
    setDirection("desc");
    expect(localStorage.getItem("ntr.sortDir")).toBe("desc");
    expect(getDirection()).toBe("desc");
  });

  it("removes the key for 'asc' (default is the absence of the key)", () => {
    setDirection("desc");
    setDirection("asc");
    expect(localStorage.getItem("ntr.sortDir")).toBeNull();
    expect(getDirection()).toBe("asc");
  });
});

describe("getStartupView / setStartupView", () => {
  it("defaults to 'note' when nothing is stored", () => {
    expect(getStartupView()).toBe("note");
  });

  it("round-trips 'todo' and 'last'", () => {
    setStartupView("todo");
    expect(getStartupView()).toBe("todo");
    setStartupView("last");
    expect(getStartupView()).toBe("last");
  });

  it("falls back to 'note' for an unrecognised stored value", () => {
    localStorage.setItem("ntr.startupView", "bogus");
    expect(getStartupView()).toBe("note");
  });

  it("removes the key for 'note' (default is the absence of the key)", () => {
    setStartupView("todo");
    setStartupView("note");
    expect(localStorage.getItem("ntr.startupView")).toBeNull();
    expect(getStartupView()).toBe("note");
  });
});

describe("getLastView / setLastView", () => {
  it("defaults to 'note' when nothing is stored", () => {
    expect(getLastView()).toBe("note");
  });

  it("round-trips 'todo'", () => {
    setLastView("todo");
    expect(getLastView()).toBe("todo");
  });

  it("falls back to 'note' for an unrecognised stored value", () => {
    localStorage.setItem("ntr.lastView", "bogus");
    expect(getLastView()).toBe("note");
  });

  it("stores 'note' as an observed last view instead of removing the key", () => {
    setLastView("todo");
    setLastView("note");
    expect(localStorage.getItem("ntr.lastView")).toBe("note");
    expect(getLastView()).toBe("note");
  });
});
