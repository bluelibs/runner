import { defineResource, defineTask } from "../../define";
import { cancellationError, genericError } from "../../errors";
import { run } from "../../run";

async function flushMicrotasks(iterations: number = 12): Promise<void> {
  for (let i = 0; i < iterations; i += 1) {
    await Promise.resolve();
  }
}

describe("run() disposal signal", () => {
  it("fails fast when the disposal signal is already aborted", async () => {
    const controller = new AbortController();
    const init = jest.fn(async () => "ready");
    controller.abort("stop before bootstrap");

    const app = defineResource({
      id: "run-disposal-signal-aborted-before-start",
      init,
    });

    try {
      await run(app, {
        signal: controller.signal,
        shutdownHooks: false,
      });
      fail("Expected run() to reject");
    } catch (error) {
      expect(cancellationError.is(error as Error)).toBe(true);
      expect((error as Error).message).toContain("stop before bootstrap");
    }

    expect(init).not.toHaveBeenCalled();
  });

  it("cancels bootstrap and rolls back initialized resources when the signal aborts mid-startup", async () => {
    expect.assertions(2);

    const disposed: string[] = [];
    let releaseChildInit: (() => void) | undefined;
    const childInitGate = new Promise<void>((resolve) => {
      releaseChildInit = resolve;
    });

    const slowChild = defineResource({
      id: "run-disposal-signal-bootstrap-child",
      async init() {
        await childInitGate;
        return "child";
      },
      async dispose(value) {
        disposed.push(String(value));
      },
    });

    const app = defineResource({
      id: "run-disposal-signal-bootstrap-app",
      register: [slowChild],
      async init() {
        return "root";
      },
    });

    const controller = new AbortController();
    const runtimePromise = run(app, {
      signal: controller.signal,
      shutdownHooks: false,
      dispose: {
        drainingBudgetMs: 50,
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort("outer shutdown");
    await new Promise((resolve) => setTimeout(resolve, 0));

    if (!releaseChildInit) {
      throw genericError.new({
        message: "Expected child resource initialization to start",
      });
    }
    releaseChildInit();

    await expect(runtimePromise).rejects.toThrow(
      /outer shutdown during bootstrap/,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(disposed).toContain("child");
  });

  it("starts disposal after the runtime is ready", async () => {
    const controller = new AbortController();
    const disposed: string[] = [];

    const app = defineResource({
      id: "run-disposal-signal-ready-app",
      async init() {
        return "ready";
      },
      async dispose(value) {
        disposed.push(String(value));
      },
    });

    const runtime = await run(app, {
      signal: controller.signal,
      shutdownHooks: false,
    });

    expect(runtime.runOptions.signal).toBe(controller.signal);

    controller.abort("outer shutdown");
    await flushMicrotasks();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(disposed).toEqual(["ready"]);
    await runtime.dispose();
  });

  it("unhooks the signal after manual dispose completes", async () => {
    const controller = new AbortController();
    let disposeCalls = 0;

    const app = defineResource({
      id: "run-disposal-signal-manual-dispose-app",
      async init() {
        return "ready";
      },
      async dispose() {
        disposeCalls += 1;
      },
    });

    const runtime = await run(app, {
      signal: controller.signal,
      shutdownHooks: false,
    });

    await runtime.dispose();
    controller.abort("too late");
    await flushMicrotasks();

    expect(disposeCalls).toBe(1);
  });

  it("reports signal-triggered disposal failures through onUnhandledError", async () => {
    const controller = new AbortController();
    const onUnhandledError = jest.fn();
    let disposeCalls = 0;

    const app = defineResource({
      id: "run-disposal-signal-reporting-app",
      async init() {
        return "ready";
      },
      async dispose() {
        disposeCalls += 1;
        if (disposeCalls === 1) {
          throw genericError.new({ message: "dispose failed" });
        }
      },
    });

    const runtime = await run(app, {
      signal: controller.signal,
      shutdownHooks: false,
      errorBoundary: false,
      onUnhandledError,
    });

    controller.abort("dispose from signal");
    await flushMicrotasks();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onUnhandledError).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "run",
        source: "run.signal",
      }),
    );

    await runtime.dispose();
  });

  it("does not expose the run disposal signal to task execution context", async () => {
    const controller = new AbortController();
    let seenSignal: AbortSignal | undefined;

    const inspectSignal = defineTask<void, Promise<void>>({
      id: "run-disposal-signal-task",
      run: async (_input, _deps, context) => {
        seenSignal = context?.signal;
      },
    });

    const app = defineResource({
      id: "run-disposal-signal-execution-context-app",
      register: [inspectSignal],
      async init() {
        return "ready";
      },
    });

    const runtime = await run(app, {
      signal: controller.signal,
      shutdownHooks: false,
      executionContext: true,
    });

    await runtime.runTask(inspectSignal);

    expect(seenSignal).toBeUndefined();
    await runtime.dispose();
  });
});
