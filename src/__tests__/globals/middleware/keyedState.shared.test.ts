import { middlewareKeyCapacityExceededError } from "../../../errors";
import {
  deriveKeyedStateCleanupInterval,
  ensureKeyedStateCapacity,
  syncCleanupTimer,
} from "../../../globals/middleware/keyedState.shared";

describe("keyed state shared helpers", () => {
  it("derives cleanup intervals from the lowest configured value and clamps extremes", () => {
    expect(deriveKeyedStateCleanupInterval([])).toBeUndefined();
    expect(deriveKeyedStateCleanupInterval([5_000, 2_000, 7_500])).toBe(2_000);
    expect(deriveKeyedStateCleanupInterval([100])).toBe(1_000);
    expect(deriveKeyedStateCleanupInterval([120_000])).toBe(60_000);
  });

  it("preserves existing keys, prunes before admission, and throws when maxKeys stays full", () => {
    const prune = jest.fn();

    expect(() =>
      ensureKeyedStateCapacity({
        hasKey: true,
        maxKeys: 1,
        middlewareId: "debounce",
        prune,
        size: () => 1,
      }),
    ).not.toThrow();
    expect(prune).not.toHaveBeenCalled();

    expect(() =>
      ensureKeyedStateCapacity({
        hasKey: false,
        maxKeys: undefined,
        middlewareId: "debounce",
        prune,
        size: () => 10,
      }),
    ).not.toThrow();
    expect(prune).toHaveBeenCalledTimes(1);

    expect(() =>
      ensureKeyedStateCapacity({
        hasKey: false,
        maxKeys: 1,
        middlewareId: "debounce",
        prune,
        size: () => 1,
      }),
    ).toThrow();

    try {
      ensureKeyedStateCapacity({
        hasKey: false,
        maxKeys: 1,
        middlewareId: "debounce",
        prune,
        size: () => 1,
      });
    } catch (error) {
      expect(middlewareKeyCapacityExceededError.is(error)).toBe(true);
    }
  });

  it("reuses an unchanged cleanup timer and cancels it when disabled or replaced", () => {
    const cancel = jest.fn();
    const replacementCancel = jest.fn();
    const setInterval = jest
      .fn()
      .mockReturnValueOnce({ cancel })
      .mockReturnValueOnce({ cancel: replacementCancel });
    const state = {};
    const timers = { setInterval };

    syncCleanupTimer(state, timers as any, 1_000, () => undefined);
    expect(setInterval).toHaveBeenCalledTimes(1);

    syncCleanupTimer(state, timers as any, 1_000, () => undefined);
    expect(setInterval).toHaveBeenCalledTimes(1);

    syncCleanupTimer(state, timers as any, 2_000, () => undefined);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(setInterval).toHaveBeenCalledTimes(2);

    syncCleanupTimer(state, timers as any, undefined, () => undefined);
    expect(replacementCancel).toHaveBeenCalledTimes(1);
  });
});
