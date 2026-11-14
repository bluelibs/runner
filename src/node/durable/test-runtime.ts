import { run as runApplication } from "../../run";
import type { RunOptions } from "../../types/runner";
import type { AnyTask } from "../../types/task";
import type {
  DurableReplayFixture,
  DurableReplayReport,
} from "./core/interfaces/history";
import { MemoryStore } from "./store/MemoryStore";
import { createDurableTestSetup } from "./test-utils";
import { DurableService } from "./core/DurableService";
import type { DurableResource } from "./core/DurableResource";
import { durableExecutionInvariantError } from "../../errors";

/** Test-only logical clock. Ownership, callback timeouts, and heartbeats keep real time. */
class TestClockStore extends MemoryStore {
  constructor(
    /** Logical workflow timer time; independent of backend lease expiry. */ public time: number,
  ) {
    super();
  }
  /** Returns this test adapter's logical timer clock. */
  getWorkflowTime(): number {
    return this.time;
  }
}

/** Options for the isolated Runner-backed workflow test runtime. */
export interface DurableTestRuntimeOptions {
  /** Local definition identity for the test backend. */
  durableId?: string;
  /** Logical start time; defaults to the Unix epoch. */
  now?: Date;
}

/** Builds an isolated test backend with real DI, virtual workflow timers, replay, and restart. */
export function createDurableTestRuntime(
  options: DurableTestRuntimeOptions = {},
) {
  const store = new TestClockStore(options.now?.getTime() ?? 0);
  const setup = createDurableTestSetup({
    durableId: options.durableId,
    store,
    durableConfig: {
      timers: { enabled: false },
      garbageCollection: { enabled: false },
    },
  });
  let runtime: Awaited<ReturnType<typeof runApplication>> | undefined;
  let backend: DurableResource | undefined;
  let app: Parameters<typeof runApplication>[0];
  let runOptions: RunOptions | undefined;
  const requireBackend = (): DurableResource => {
    if (!backend)
      return durableExecutionInvariantError.throw({
        message: "Start the test runtime with test.run(app) first.",
      });
    return backend;
  };
  const service = (): DurableService => {
    const value = requireBackend().service;
    if (!(value instanceof DurableService))
      return durableExecutionInvariantError.throw({
        message: "Test runtime requires the built-in durable service.",
      });
    return value;
  };
  const start = async () => {
    runtime = await runApplication(app, runOptions);
    backend = runtime.getResourceValue(setup.durable);
    return runtime;
  };
  return {
    ...setup,
    /** Current backend facade; reacquire it after restart instead of retaining old references. */
    get backend(): DurableResource {
      return requireBackend();
    },
    /** Current logical workflow-timer time. */
    get now(): Date {
      return new Date(store.time);
    },
    /** Boots the app, which must register durableRegistration and resources.durable. */
    async run(
      definition: Parameters<typeof runApplication>[0],
      options?: RunOptions,
    ) {
      if (runtime)
        return durableExecutionInvariantError.throw({
          message: "Test runtime is already running.",
        });
      app = definition;
      runOptions = options;
      return start();
    },
    /** Drives persisted timers in deadline order, including timers created by resumed workflows. */
    async advanceTimeBy(durationMs: number): Promise<void> {
      if (!Number.isFinite(durationMs) || durationMs < 0)
        return durableExecutionInvariantError.throw({
          message:
            "Virtual time must advance by a finite, nonnegative duration.",
        });
      const driver = service();
      const until = store.time + durationMs;
      for (let processed = 0; ; processed++) {
        if (processed >= 10000)
          return durableExecutionInvariantError.throw({
            message:
              "Virtual timer limit exceeded; check for a zero-delay loop.",
          });
        const ready = await store.getReadyTimers(new Date(until));
        const next = ready.sort(
          (a, b) => a.fireAt.getTime() - b.fireAt.getTime(),
        )[0];
        if (!next) break;
        store.time = Math.max(store.time, next.fireAt.getTime());
        await driver.handleTimer(next);
      }
      store.time = until;
    },
    /** Starts a fresh Runner container from a durable snapshot after all live callbacks settle. */
    async restartWorker() {
      requireBackend();
      for (const execution of await store.listIncompleteExecutions())
        if (await store.hasExecutionLease(execution.id))
          return durableExecutionInvariantError.throw({
            message:
              "Wait for active callbacks to settle before restarting the test worker.",
          });
      const snapshot = store.exportSnapshot();
      await runtime!.dispose();
      runtime = undefined;
      backend = undefined;
      store.restoreSnapshot(snapshot);
      return start();
    },
    /** Checks proposed code against copied checkpoints without running step effects. */
    replay(
      task: AnyTask,
      fixture: DurableReplayFixture,
    ): Promise<DurableReplayReport> {
      return service().replay(task, fixture);
    },
    /** Disposes the current Runner container and backend. */
    async dispose(): Promise<void> {
      await runtime?.dispose();
      runtime = undefined;
      backend = undefined;
    },
  };
}

/** Returned test controls, including the registration consumed by the application graph. */
export type DurableTestRuntime = ReturnType<typeof createDurableTestRuntime>;
