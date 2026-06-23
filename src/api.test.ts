import { describe, expect, it } from "vitest";
import { errMsg } from "./api";

describe("errMsg", () => {
  it("uses an Error's message", () => {
    expect(errMsg(new Error("x"))).toBe("x");
  });

  it("stringifies a non-Error (IPC rejections arrive as plain strings)", () => {
    expect(errMsg("y")).toBe("y");
  });
});
