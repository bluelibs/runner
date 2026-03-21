import { journal as journalFactory } from "../../index";
import { defineResource, defineTask } from "../../define";
import { timeoutTaskMiddleware } from "../../globals/middleware/timeout.middleware";
import { createCancellationErrorFromSignal } from "../../tools/abortSignals";
import { run } from "../../run";

function tick(ms: number = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("run shutdown drain abort", () => {
  it("aborts in-flight task signals when graceful drain runs out of budget", async () => {
    const abortReasons: string[] = [];

    const cooperativeTask = defineTask({
      id: "tests-shutdown-drain-abort-cooperative-task",
      middleware: [timeoutTaskMiddleware.with({ ttl: 1_000 })],
      async run(_input, _deps, context) {
        const signal = context?.signal;

        return await new Promise<never>((_resolve, reject) => {
          if (!signal) {
            reject(new Error("Expected task signal"));
            return;
          }

          const onAbort = () => {
            abortReasons.push(String(signal.reason));
            reject(
              createCancellationErrorFromSignal(
                signal,
                "Shutdown drain budget expired",
              ),
            );
          };

          signal.addEventListener("abort", onAbort, { once: true });
        });
      },
    });

    const app = defineResource({
      id: "tests-shutdown-drain-abort-app",
      register: [cooperativeTask],
      async init() {
        return "ok";
      },
    });

    const runtime = await run(app, {
      shutdownHooks: false,
      errorBoundary: false,
      dispose: {
        drainingBudgetMs: 20,
      },
    });

    const taskPromise = runtime.runTask(cooperativeTask);
    await tick();

    await runtime.dispose();

    await expect(taskPromise).rejects.toThrow(
      /Runtime shutdown drain budget expired/,
    );
    expect(abortReasons).toEqual(["Runtime shutdown drain budget expired"]);
  });

  it("does not abort in-flight task signals when drain waiting is disabled", async () => {
    let aborted = false;

    const cooperativeTask = defineTask({
      id: "tests-shutdown-drain-abort-disabled-task",
      middleware: [timeoutTaskMiddleware.with({ ttl: 1_000 })],
      async run(_input, _deps, context) {
        const signal = context?.signal;

        return await new Promise<never>(() => {
          signal?.addEventListener(
            "abort",
            () => {
              aborted = true;
            },
            { once: true },
          );
        });
      },
    });

    const app = defineResource({
      id: "tests-shutdown-drain-abort-disabled-app",
      register: [cooperativeTask],
      async init() {
        return "ok";
      },
    });

    const runtime = await run(app, {
      shutdownHooks: false,
      errorBoundary: false,
      dispose: {
        drainingBudgetMs: 0,
      },
    });

    void runtime.runTask(cooperativeTask).catch(() => undefined);
    await tick();

    await runtime.dispose();
    await tick(10);

    expect(aborted).toBe(false);
  });

  it("reuses the forwarded journal abort controller for nested task trees", async () => {
    const seenSignals: AbortSignal[] = [];

    const childTask = defineTask({
      id: "tests-shutdown-drain-abort-child-task",
      middleware: [timeoutTaskMiddleware.with({ ttl: 1_000 })],
      async run(_input, _deps, context) {
        const signal = context?.signal;
        if (!signal) {
          throw new Error("Expected child signal");
        }

        seenSignals.push(signal);

        return await new Promise<never>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              reject(
                createCancellationErrorFromSignal(
                  signal,
                  "Nested task aborted",
                ),
              );
            },
            { once: true },
          );
        });
      },
    });

    const parentTask = defineTask({
      id: "tests-shutdown-drain-abort-parent-task",
      dependencies: { childTask },
      middleware: [timeoutTaskMiddleware.with({ ttl: 1_000 })],
      async run(_input, { childTask }, context) {
        const signal = context?.signal;
        if (!signal || !context) {
          throw new Error("Expected parent signal and context");
        }

        seenSignals.push(signal);
        return await childTask(undefined, { journal: context.journal });
      },
    });

    const app = defineResource({
      id: "tests-shutdown-drain-abort-nested-app",
      register: [childTask, parentTask],
      async init() {
        return "ok";
      },
    });

    const runtime = await run(app, {
      shutdownHooks: false,
      errorBoundary: false,
      dispose: {
        drainingBudgetMs: 20,
      },
    });

    const taskPromise = runtime.runTask(parentTask);
    await tick();

    await runtime.dispose();

    await expect(taskPromise).rejects.toThrow(
      /Runtime shutdown drain budget expired/,
    );
    expect(seenSignals).toHaveLength(2);
    expect(seenSignals[0]).toBe(seenSignals[1]);
    expect(seenSignals[0]?.aborted).toBe(true);
    expect(seenSignals[0]?.reason).toBe(
      "Runtime shutdown drain budget expired",
    );
  });

  it("re-registers a reused journal with the current runtime", async () => {
    const sharedJournal = journalFactory.create();
    const seenAbortReasons: string[] = [];

    const cooperativeTask = defineTask({
      id: "tests-shutdown-drain-abort-cross-runtime-task",
      middleware: [timeoutTaskMiddleware.with({ ttl: 1_000 })],
      async run(input: { mode: "quick" | "wait" }, _deps, context) {
        if (input.mode === "quick") {
          return "ready";
        }

        const signal = context?.signal;
        return await new Promise<never>((_resolve, reject) => {
          if (!signal) {
            reject(new Error("Expected task signal"));
            return;
          }

          signal.addEventListener(
            "abort",
            () => {
              seenAbortReasons.push(String(signal.reason));
              reject(
                createCancellationErrorFromSignal(
                  signal,
                  "Cross-runtime shutdown abort",
                ),
              );
            },
            { once: true },
          );
        });
      },
    });

    const appA = defineResource({
      id: "tests-shutdown-drain-abort-cross-runtime-app-a",
      register: [cooperativeTask],
      async init() {
        return "a";
      },
    });

    const appB = defineResource({
      id: "tests-shutdown-drain-abort-cross-runtime-app-b",
      register: [cooperativeTask],
      async init() {
        return "b";
      },
    });

    const runtimeA = await run(appA, {
      shutdownHooks: false,
      errorBoundary: false,
      dispose: {
        drainingBudgetMs: 20,
      },
    });
    const runtimeB = await run(appB, {
      shutdownHooks: false,
      errorBoundary: false,
      dispose: {
        drainingBudgetMs: 20,
      },
    });

    await expect(
      runtimeA.runTask(
        cooperativeTask,
        { mode: "quick" },
        { journal: sharedJournal },
      ),
    ).resolves.toBe("ready");

    const taskPromise = runtimeB.runTask(
      cooperativeTask,
      { mode: "wait" },
      { journal: sharedJournal },
    );
    await tick();

    await runtimeA.dispose();
    await tick(10);
    expect(seenAbortReasons).toEqual([]);

    await runtimeB.dispose();

    await expect(taskPromise).rejects.toThrow(
      /Runtime shutdown drain budget expired/,
    );
    expect(seenAbortReasons).toEqual(["Runtime shutdown drain budget expired"]);
  });
});
