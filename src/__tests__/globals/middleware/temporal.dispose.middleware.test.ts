import { defineResource, defineTask } from "../../../define";
import { run } from "../../../run";
import {
  debounceTaskMiddleware,
  temporalResource,
  throttleTaskMiddleware,
  type TemporalResourceState,
} from "../../../globals/middleware/temporal.middleware";

const createTemporalState = (
  overrides: Partial<TemporalResourceState> = {},
): TemporalResourceState => ({
  isDisposed: false,
  debounceStates: new WeakMap(),
  throttleStates: new WeakMap(),
  trackedDebounceStates: new Set(),
  trackedThrottleStates: new Set(),
  ...overrides,
});

describe("Temporal Middleware: Dispose", () => {
  it("rejects pending debounce callers when runtime is disposed", async () => {
    let callCount = 0;
    const task = defineTask({
      id: "debounce.dispose.task",
      middleware: [debounceTaskMiddleware.with({ ms: 1000 })],
      run: async (input: string) => {
        callCount += 1;
        return input;
      },
    });

    const app = defineResource({
      id: "debounce.dispose.app",
      register: [task],
    });

    const runtime = await run(app);
    const pending = runtime.runTask(task, "a");

    await runtime.dispose();

    await expect(pending).rejects.toThrow(
      "Temporal middleware resource has been disposed.",
    );
    expect(callCount).toBe(0);
  });

  it("rejects pending throttle callers when runtime is disposed", async () => {
    let callCount = 0;
    const task = defineTask({
      id: "throttle.dispose.task",
      middleware: [throttleTaskMiddleware.with({ ms: 1000 })],
      run: async (input: string) => {
        callCount += 1;
        return input;
      },
    });

    const app = defineResource({
      id: "throttle.dispose.app",
      register: [task],
    });

    const runtime = await run(app);
    await expect(runtime.runTask(task, "a")).resolves.toBe("a");
    const pending = runtime.runTask(task, "b");

    await runtime.dispose();

    await expect(pending).rejects.toThrow(
      "Temporal middleware resource has been disposed.",
    );
    expect(callCount).toBe(1);
  });

  it("throws immediately when debounce middleware state is already disposed", async () => {
    const deps = {
      state: createTemporalState({ isDisposed: true }),
    } satisfies Parameters<typeof debounceTaskMiddleware.run>[1];

    await expect(
      debounceTaskMiddleware.run(
        {
          task: {
            definition: { id: "debounce.disposed" } as any,
            input: "x",
          },
          next: async () => "ok",
        } as any,
        deps,
        { ms: 10 },
      ),
    ).rejects.toThrow("Temporal middleware resource has been disposed.");
  });

  it("throws immediately when throttle middleware state is already disposed", async () => {
    const deps = {
      state: createTemporalState({ isDisposed: true }),
    } satisfies Parameters<typeof throttleTaskMiddleware.run>[1];

    await expect(
      throttleTaskMiddleware.run(
        {
          task: {
            definition: { id: "throttle.disposed" } as any,
            input: "x",
          },
          next: async () => "ok",
        } as any,
        deps,
        { ms: 10 },
      ),
    ).rejects.toThrow("Temporal middleware resource has been disposed.");
  });

  it("rejects debounce callers when callback runs after state becomes disposed", async () => {
    expect.assertions(1);
    const state = createTemporalState();
    const deps = { state };

    let scheduled: (() => Promise<void>) | undefined;
    const setTimeoutSpy = jest.spyOn(globalThis, "setTimeout");
    setTimeoutSpy.mockImplementation(((fn: any) => {
      scheduled = fn;
      return 1 as any;
    }) as any);

    try {
      const pending = debounceTaskMiddleware.run(
        {
          task: {
            definition: { id: "debounce.dispose.callback" } as any,
            input: "x",
          },
          next: async () => "ok",
        } as any,
        deps,
        { ms: 10 },
      );

      state.isDisposed = true;
      await scheduled?.();

      await expect(pending).rejects.toThrow(
        "Temporal middleware resource has been disposed.",
      );
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  it("rejects throttle callers when callback runs after state becomes disposed", async () => {
    expect.assertions(2);
    const state = createTemporalState();
    const deps = { state };

    let scheduled: (() => Promise<void>) | undefined;
    const setTimeoutSpy = jest.spyOn(globalThis, "setTimeout");
    setTimeoutSpy.mockImplementation(((fn: any) => {
      scheduled = fn;
      return 1 as any;
    }) as any);
    const config = { ms: 100000 };

    try {
      await expect(
        throttleTaskMiddleware.run(
          {
            task: {
              definition: { id: "throttle.dispose.callback" } as any,
              input: "a",
            },
            next: async (input?: string) => input,
          } as any,
          deps,
          config,
        ),
      ).resolves.toBe("a");

      const pending = throttleTaskMiddleware.run(
        {
          task: {
            definition: { id: "throttle.dispose.callback" } as any,
            input: "b",
          },
          next: async (input?: string) => input,
        } as any,
        deps,
        config,
      );

      state.isDisposed = true;
      await scheduled?.();

      await expect(pending).rejects.toThrow(
        "Temporal middleware resource has been disposed.",
      );
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  it("handles temporal resource dispose when tracked sets are missing", async () => {
    type TemporalDispose = NonNullable<typeof temporalResource.dispose>;
    type TemporalDisposeArgs = Parameters<TemporalDispose>;

    const state: TemporalDisposeArgs[0] = {
      isDisposed: false,
      debounceStates: new WeakMap(),
      throttleStates: new WeakMap(),
      trackedDebounceStates: new Set(),
      trackedThrottleStates: new Set(),
    };
    Object.defineProperty(state, "trackedDebounceStates", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(state, "trackedThrottleStates", {
      value: undefined,
      configurable: true,
      writable: true,
    });

    await expect(
      temporalResource.dispose?.(
        state,
        undefined as TemporalDisposeArgs[1],
        {} as TemporalDisposeArgs[2],
        {} as TemporalDisposeArgs[3],
      ),
    ).resolves.toBeUndefined();
  });

  it("recreates tracked debounce state set when missing", async () => {
    expect.assertions(2);
    jest.useFakeTimers();
    try {
      const state = createTemporalState();
      Object.defineProperty(state, "trackedDebounceStates", {
        value: undefined,
        configurable: true,
        writable: true,
      });
      const deps = { state } as Parameters<
        typeof debounceTaskMiddleware.run
      >[1];

      const pending = debounceTaskMiddleware.run(
        {
          task: {
            definition: { id: "debounce.recreate.tracked-set" } as any,
            input: "x",
          },
          next: async () => "ok",
        } as any,
        deps,
        { ms: 10 },
      );

      jest.advanceTimersByTime(10);
      await Promise.resolve();
      await expect(pending).resolves.toBe("ok");
      expect(state.trackedDebounceStates).toBeInstanceOf(Set);
    } finally {
      jest.useRealTimers();
    }
  });
});
