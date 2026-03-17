import { defineResource, defineTask } from "../../../define";
import { run } from "../../../run";
import {
  type DebounceState,
  debounceTaskMiddleware,
  type TemporalMiddlewareConfig,
  temporalResource,
  throttleTaskMiddleware,
  type ThrottleState,
  type TemporalResourceState,
} from "../../../globals/middleware/temporal.middleware";

const testTenantContext = {
  tryUse: () => undefined,
};

const createTemporalState = (
  overrides: Partial<TemporalResourceState<TemporalMiddlewareConfig>> = {},
): TemporalResourceState<TemporalMiddlewareConfig> => ({
  isDisposed: false,
  debounceStates: new WeakMap<
    TemporalMiddlewareConfig,
    Map<string, DebounceState>
  >(),
  throttleStates: new WeakMap<
    TemporalMiddlewareConfig,
    Map<string, ThrottleState>
  >(),
  trackedDebounceStates: new Set(),
  trackedThrottleStates: new Set(),
  ...overrides,
});

describe("Temporal Middleware: Dispose", () => {
  it("rejects pending debounce callers when runtime is disposed", async () => {
    let callCount = 0;
    const task = defineTask({
      id: "debounce-dispose-task",
      middleware: [debounceTaskMiddleware.with({ ms: 1000 })],
      run: async (input: string) => {
        callCount += 1;
        return input;
      },
    });

    const app = defineResource({
      id: "debounce-dispose-app",
      register: [task],
    });

    const runtime = await run(app, {
      dispose: {
        drainingBudgetMs: 0,
      },
    });
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
      id: "throttle-dispose-task",
      middleware: [
        throttleTaskMiddleware.with({
          ms: 1000,
          keyBuilder: () => "shared",
        }),
      ],
      run: async (input: string) => {
        callCount += 1;
        return input;
      },
    });

    const app = defineResource({
      id: "throttle-dispose-app",
      register: [task],
    });

    const runtime = await run(app, {
      dispose: {
        drainingBudgetMs: 0,
      },
    });
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
      identityContext: testTenantContext,
    } satisfies Parameters<typeof debounceTaskMiddleware.run>[1];

    await expect(
      debounceTaskMiddleware.run(
        {
          task: {
            definition: { id: "debounce-disposed" } as any,
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
      identityContext: testTenantContext,
    } satisfies Parameters<typeof throttleTaskMiddleware.run>[1];

    await expect(
      throttleTaskMiddleware.run(
        {
          task: {
            definition: { id: "throttle-disposed" } as any,
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
    const deps = { state, identityContext: testTenantContext };

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
            definition: { id: "debounce-dispose-callback" } as any,
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
    const deps = { state, identityContext: testTenantContext };

    let scheduled: (() => Promise<void>) | undefined;
    const setTimeoutSpy = jest.spyOn(globalThis, "setTimeout");
    setTimeoutSpy.mockImplementation(((fn: any) => {
      scheduled = fn;
      return 1 as any;
    }) as any);
    const config = { ms: 100000, keyBuilder: () => "shared" };

    try {
      await expect(
        throttleTaskMiddleware.run(
          {
            task: {
              definition: { id: "throttle-dispose-callback" } as any,
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
            definition: { id: "throttle-dispose-callback" } as any,
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

  it("fails fast when tracked sets are missing during resource disposal", async () => {
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
    ).rejects.toThrow(/forEach/);
  });

  it("rejects tracked debounce/throttle states during resource disposal", async () => {
    const debounceReject = jest.fn();
    const throttleReject = jest.fn();

    const debounceState = {
      key: "debounce-dispose-key",
      resolveList: [],
      rejectList: [debounceReject],
      latestInput: "debounce-input",
      timeoutId: setTimeout(() => undefined, 1_000),
    };

    const throttleState = {
      key: "throttle-dispose-key",
      lastExecution: 0,
      resolveList: [],
      rejectList: [throttleReject],
      latestInput: "throttle-input",
      timeoutId: setTimeout(() => undefined, 1_000),
      currentPromise: Promise.resolve("pending"),
    };

    type TemporalDispose = NonNullable<typeof temporalResource.dispose>;
    type TemporalDisposeArgs = Parameters<TemporalDispose>;

    const state: TemporalDisposeArgs[0] = createTemporalState({
      trackedDebounceStates: new Set([debounceState]),
      trackedThrottleStates: new Set([throttleState]),
    });

    await expect(
      temporalResource.dispose?.(
        state,
        undefined as TemporalDisposeArgs[1],
        {} as TemporalDisposeArgs[2],
        {} as TemporalDisposeArgs[3],
      ),
    ).resolves.toBeUndefined();

    expect(debounceReject).toHaveBeenCalledTimes(1);
    expect(throttleReject).toHaveBeenCalledTimes(1);
  });

  it("rejects tracked debounce states during disposal even without an active timer", async () => {
    const debounceReject = jest.fn();
    type TemporalDispose = NonNullable<typeof temporalResource.dispose>;
    type TemporalDisposeArgs = Parameters<TemporalDispose>;

    const state: TemporalDisposeArgs[0] = createTemporalState({
      trackedDebounceStates: new Set([
        {
          key: "debounce-no-timer",
          resolveList: [],
          rejectList: [debounceReject],
          latestInput: "debounce-input",
        },
      ]),
    });

    await expect(
      temporalResource.dispose?.(
        state,
        undefined as TemporalDisposeArgs[1],
        {} as TemporalDisposeArgs[2],
        {} as TemporalDisposeArgs[3],
      ),
    ).resolves.toBeUndefined();

    expect(debounceReject).toHaveBeenCalledTimes(1);
  });

  it("fails fast when tracked debounce state set is missing", async () => {
    const state = createTemporalState();
    Object.defineProperty(state, "trackedDebounceStates", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const deps = {
      state,
      identityContext: testTenantContext,
    } as Parameters<typeof debounceTaskMiddleware.run>[1];

    await expect(
      debounceTaskMiddleware.run(
        {
          task: {
            definition: { id: "debounce-recreate-tracked-set" } as any,
            input: "x",
          },
          next: async () => "ok",
        } as any,
        deps,
        { ms: 10 },
      ),
    ).rejects.toThrow(/add/);
  });

  it("sweeps empty debounce maps and disposes the internal cleanup timer", async () => {
    const cancel = jest.fn();
    const state = await temporalResource.init?.(
      undefined as never,
      {
        timers: {
          setInterval: jest.fn(() => ({ cancel })),
        },
      } as never,
      {} as never,
    );
    const config: TemporalMiddlewareConfig = { ms: 50 };
    const staleState: DebounceState = {
      key: "stale",
      latestInput: undefined,
      rejectList: [],
      resolveList: [],
      scheduledAt: Date.now() - 100,
    };
    const keyedStates = new Map<string, DebounceState>([["stale", staleState]]);

    state?.registerDebounceStateMap?.(config, keyedStates);
    state?.trackedDebounceStates.add(staleState);
    state?.sweepIdleStates?.(Date.now());

    expect(state?.debounceStates.get(config)).toBeUndefined();
    state?.disposeCleanupTimer?.();
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
