import { SuspensionSignal } from "../../durable/core/interfaces/context";
import type { IDurableStore } from "../../durable/core/interfaces/store";
import { TimerType } from "../../durable/core/types";
import {
  commitDurableWaitCompletion,
  createTimedWaitState,
  deleteWaitTimerBestEffort,
  ensureDurableWaitTimer,
  runBestEffortCleanup,
  suspendDurableWait,
} from "../../durable/core/waiterCore";

function createStoreMock(
  overrides: Partial<IDurableStore> = {},
): jest.Mocked<IDurableStore> {
  return {
    saveExecution: jest.fn(),
    saveExecutionIfStatus: jest.fn(),
    getExecution: jest.fn(),
    updateExecution: jest.fn(),
    listIncompleteExecutions: jest.fn(),
    listStepResults: jest.fn(),
    getStepResult: jest.fn(),
    saveStepResult: jest.fn(),
    getSignalState: jest.fn(),
    appendSignalRecord: jest.fn(),
    bufferSignalRecord: jest.fn(),
    enqueueQueuedSignalRecord: jest.fn(),
    consumeQueuedSignalRecord: jest.fn(),
    consumeBufferedSignalForStep: jest.fn(),
    upsertSignalWaiter: jest.fn(),
    peekNextSignalWaiter: jest.fn(),
    takeNextSignalWaiter: jest.fn(),
    deleteSignalWaiter: jest.fn(),
    upsertExecutionWaiter: jest.fn(),
    listExecutionWaiters: jest.fn(),
    commitExecutionWaiterCompletion: jest.fn(),
    deleteExecutionWaiter: jest.fn(),
    createTimer: jest.fn(),
    getReadyTimers: jest.fn(),
    markTimerFired: jest.fn(),
    deleteTimer: jest.fn(),
    createSchedule: jest.fn(),
    getSchedule: jest.fn(),
    updateSchedule: jest.fn(),
    saveScheduleWithTimer: jest.fn(),
    deleteSchedule: jest.fn(),
    listSchedules: jest.fn(),
    listActiveSchedules: jest.fn(),
    ...overrides,
  } as jest.Mocked<IDurableStore>;
}

describe("durable: waiter core helpers", () => {
  it("creates timed wait state only when timeout metadata exists", () => {
    expect(createTimedWaitState({ state: "waiting" as const })).toEqual({
      state: "waiting",
    });
    expect(
      createTimedWaitState({ state: "waiting" as const }, 10, "timer-1"),
    ).toEqual({
      state: "waiting",
      timeoutAtMs: 10,
      timerId: "timer-1",
    });
  });

  it("runs best-effort cleanup helpers without surfacing cleanup errors", async () => {
    await expect(
      runBestEffortCleanup(async () => {
        throw new Error("cleanup failed");
      }),
    ).resolves.toBeUndefined();

    const store = createStoreMock({
      deleteTimer: jest.fn(async () => {
        throw new Error("timer cleanup failed");
      }),
    });
    await expect(
      deleteWaitTimerBestEffort(store, "timer-1"),
    ).resolves.toBeUndefined();
  });

  it("commits wait completion through atomic or fallback paths", async () => {
    const atomicStore = createStoreMock();
    const atomicCommit = jest.fn(async () => true);

    await expect(
      commitDurableWaitCompletion({
        store: atomicStore,
        stepResult: {
          executionId: "parent",
          stepId: "step",
          result: { state: "completed" },
          completedAt: new Date(),
        },
        commitAtomically: atomicCommit,
      }),
    ).resolves.toBe(true);
    expect(atomicCommit).toHaveBeenCalled();
    expect(atomicStore.saveStepResult).not.toHaveBeenCalled();

    const fallbackStore = createStoreMock();
    const onFallbackCommitted = jest.fn(async () => undefined);

    await expect(
      commitDurableWaitCompletion({
        store: fallbackStore,
        stepResult: {
          executionId: "parent",
          stepId: "step",
          result: { state: "completed" },
          completedAt: new Date(),
        },
        timerId: "timer-1",
        onFallbackCommitted,
      }),
    ).resolves.toBe(true);
    expect(fallbackStore.saveStepResult).toHaveBeenCalled();
    expect(onFallbackCommitted).toHaveBeenCalled();
    expect(fallbackStore.deleteTimer).toHaveBeenCalledWith("timer-1");

    const fallbackWithoutExtraCleanup = createStoreMock();
    await expect(
      commitDurableWaitCompletion({
        store: fallbackWithoutExtraCleanup,
        stepResult: {
          executionId: "parent",
          stepId: "step",
          result: { state: "completed" },
          completedAt: new Date(),
        },
      }),
    ).resolves.toBe(true);
    expect(fallbackWithoutExtraCleanup.saveStepResult).toHaveBeenCalled();
  });

  it("keeps fallback wait cleanup best-effort after the step result is durable", async () => {
    const store = createStoreMock();
    const onFallbackCommitted = jest.fn(async () => {
      throw new Error("cleanup failed");
    });

    await expect(
      commitDurableWaitCompletion({
        store,
        stepResult: {
          executionId: "parent",
          stepId: "step",
          result: { state: "completed" },
          completedAt: new Date(),
        },
        timerId: "timer-1",
        onFallbackCommitted,
      }),
    ).resolves.toBe(true);

    expect(store.saveStepResult).toHaveBeenCalled();
    expect(onFallbackCommitted).toHaveBeenCalled();
    expect(store.deleteTimer).toHaveBeenCalledWith("timer-1");
  });

  it("re-arms, creates, and skips timeout timers as needed", async () => {
    const rearmStore = createStoreMock();
    await expect(
      ensureDurableWaitTimer({
        store: rearmStore,
        executionId: "parent",
        stepId: "step",
        timerType: TimerType.Timeout,
        timeoutMs: 5,
        existing: { timeoutAtMs: 10_000, timerId: "timer-1" },
        createTimerId: () => "new-timer",
        persistWaitingState: jest.fn(),
      }),
    ).resolves.toEqual({
      timerId: "timer-1",
      timeoutAtMs: 10_000,
      persistedWaitingState: false,
    });

    const createStore = createStoreMock();
    const persistWaitingState = jest.fn(async () => undefined);
    const onTimerCreated = jest.fn(async () => undefined);
    await expect(
      ensureDurableWaitTimer({
        store: createStore,
        executionId: "parent",
        stepId: "step",
        timerType: TimerType.SignalTimeout,
        timeoutMs: 5,
        createTimerId: () => "timer-2",
        persistWaitingState,
        onTimerCreated,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        timerId: "timer-2",
        persistedWaitingState: true,
      }),
    );
    expect(persistWaitingState).toHaveBeenCalled();
    expect(onTimerCreated).toHaveBeenCalled();

    const noTimeoutStore = createStoreMock();
    await expect(
      ensureDurableWaitTimer({
        store: noTimeoutStore,
        executionId: "parent",
        stepId: "step",
        timerType: TimerType.Timeout,
        createTimerId: () => "timer-3",
        persistWaitingState: jest.fn(),
      }),
    ).resolves.toEqual({
      timerId: undefined,
      timeoutAtMs: undefined,
      persistedWaitingState: false,
    });
  });

  it("cleans up a freshly created wait timer when persisting the waiting state fails", async () => {
    const store = createStoreMock({
      createTimer: jest.fn(async () => undefined),
      deleteTimer: jest.fn(async () => undefined),
    });

    await expect(
      ensureDurableWaitTimer({
        store,
        executionId: "parent",
        stepId: "step",
        timerType: TimerType.Timeout,
        timeoutMs: 5,
        createTimerId: () => "timer-cleanup",
        persistWaitingState: jest.fn(async () => {
          throw new Error("persist-failed");
        }),
      }),
    ).rejects.toThrow("persist-failed");

    expect(store.deleteTimer).toHaveBeenCalledWith("timer-cleanup");
  });

  it("persists optional waiting state, registers waiters, and suspends", async () => {
    const store = createStoreMock();
    const registerWaiter = jest.fn(async () => undefined);

    await expect(
      suspendDurableWait({
        store,
        executionId: "parent",
        stepId: "step",
        waitingState: { state: "waiting" },
        registerWaiter,
      }),
    ).rejects.toBeInstanceOf(SuspensionSignal);
    expect(store.saveStepResult).toHaveBeenCalled();
    expect(registerWaiter).toHaveBeenCalled();

    const storeWithoutState = createStoreMock();
    await expect(
      suspendDurableWait({
        store: storeWithoutState,
        executionId: "parent",
        stepId: "step",
        registerWaiter,
      }),
    ).rejects.toBeInstanceOf(SuspensionSignal);
    expect(storeWithoutState.saveStepResult).not.toHaveBeenCalled();
  });
});
