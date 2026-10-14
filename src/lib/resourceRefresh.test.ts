import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResourceRefresh } from "./resourceRefresh";
import { deferred, settle } from "../test/deferred";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("ResourceRefresh", () => {
  it("coalesces requests during a read and drains the latest state without overlap", async () => {
    const first = deferred<void>();
    const read = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    const recovery = new ResourceRefresh(read, { onError: vi.fn() });
    recovery.request();
    recovery.request();
    recovery.request();
    expect(read).toHaveBeenCalledTimes(1);
    first.resolve();
    await settle();
    expect(read).toHaveBeenCalledTimes(2);
    expect(recovery.busy).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retries failed event-triggered work with capped backoff and stops on success", async () => {
    const read = vi.fn().mockRejectedValue(new Error("offline"));
    const error = vi.fn();
    const recovery = new ResourceRefresh(read, { onError: error });
    recovery.request();
    await settle();
    for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
      const before = read.mock.calls.length;
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(read).toHaveBeenCalledTimes(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(read).toHaveBeenCalledTimes(before + 1);
    }
    read.mockResolvedValue(undefined);
    await vi.advanceTimersByTimeAsync(30000);
    expect(recovery.busy).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(error).toHaveBeenCalled();
  });

  it("keeps blocked work pending until resumed and cancels timers and old drains", async () => {
    let allowed = false;
    const old = deferred<void>();
    const read = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(undefined);
    const idle = vi.fn();
    const recovery = new ResourceRefresh(read, { canRun: () => allowed, onError: vi.fn(), onIdle: idle });
    recovery.request();
    expect(read).not.toHaveBeenCalled();
    allowed = true;
    void recovery.resume();
    recovery.cancel();
    recovery.request();
    await settle();
    old.reject(new Error("obsolete"));
    await settle();
    expect(idle).toHaveBeenCalledTimes(1);
    expect(recovery.busy).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    read.mockRejectedValue(new Error("offline"));
    recovery.request();
    await settle();
    recovery.cancel();
    expect(vi.getTimerCount()).toBe(0);
  });
});
