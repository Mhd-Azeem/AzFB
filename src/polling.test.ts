import { expect, it, vi } from "vitest";
import { subscribeAutoRefresh } from "./polling";
it("pauses hidden tabs and refreshes on interval, visibility, and reconnect", () => {
  vi.useFakeTimers();
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const win = new EventTarget();
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", win);
  const refresh = vi.fn();
  const stop = subscribeAutoRefresh(refresh, 30000);
  try {
    vi.advanceTimersByTime(30000);
    expect(refresh).toHaveBeenCalledTimes(1);
    doc.visibilityState = "hidden";
    vi.advanceTimersByTime(90000);
    expect(refresh).toHaveBeenCalledTimes(1);
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(refresh).toHaveBeenCalledTimes(2);
    win.dispatchEvent(new Event("online"));
    expect(refresh).toHaveBeenCalledTimes(3);
    stop();
    vi.advanceTimersByTime(30000);
    win.dispatchEvent(new Event("online"));
    expect(refresh).toHaveBeenCalledTimes(3);
  } finally {
    stop();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});
