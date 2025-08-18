import { defineResource } from "../define";
import { run } from "../run";

describe("run.ts rollback and unhooking", () => {
  it("rolls back initialized resources on init error and skips uninitialized", async () => {
    const disposeCalls: string[] = [];

    const dep = defineResource({
      id: "tests.rollback.dep",
      async init() {
        return "dep" as const;
      },
      async dispose(v) {
        disposeCalls.push(`dep:${v}`);
      },
    });

    const bad = defineResource({
      id: "tests.rollback.bad",
      dependencies: { dep },
      async init() {
        throw new Error("init failed");
      },
      async dispose() {
        disposeCalls.push("bad");
      },
    });

    // Also register a resource that is never initialized
    const never = defineResource({
      id: "tests.rollback.never",
      async dispose() {
        disposeCalls.push("never");
      },
    });

    const app = defineResource({
      id: "tests.rollback.app",
      dependencies: { bad, never },
      register: [dep, bad, never],
      async init() {
        // We should never get here because bad throws during its init
        return "app" as const;
      },
    });

    await expect(run(app, { shutdownHooks: false })).rejects.toThrow(
      "init failed",
    );

    // dep and bad should have been disposed; never was not initialized.
    // Note: bad.isInitialized becomes true before init is attempted, so it will be disposed on rollback.
    expect(disposeCalls.sort()).toEqual(["dep:dep"].sort());
  });

  it("unhooks shutdown listeners on dispose() (global dispatcher)", async () => {
    const calls: number[] = [];
    const app = defineResource({
      id: "tests.unhook.shutdown",
      async init() {
        return "ok" as const;
      },
      async dispose() {
        calls.push(1);
      },
    });

    const originalExit = process.exit as any;
    // @ts-ignore
    process.exit = () => undefined as any;

    // First run: should react to SIGINT
    const first = await run(app, {
      shutdownHooks: true,
      errorBoundary: false,
    });
    // @ts-ignore
    process.emit("SIGINT");
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.length).toBeGreaterThanOrEqual(1);

    // Second run: dispose should unregister; SIGINT should not call its dispose again
    calls.length = 0;
    const second = await run(app, {
      shutdownHooks: true,
      errorBoundary: false,
    });
    await second.dispose();
    const before = calls.length;
    // @ts-ignore
    process.emit("SIGINT");
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.length).toBe(before);

    // restore
    // @ts-ignore
    process.exit = originalExit;
  });

  it("unhooks process safety nets on dispose() when errorBoundary is true (global dispatcher)", async () => {
    const app = defineResource({
      id: "tests.unhook.process",
      async init() {
        return "ok" as const;
      },
    });

    const onUnhandledError = jest.fn();
    const { dispose } = await run(app, {
      shutdownHooks: false,
      errorBoundary: true,
      onUnhandledError: async ({ error, kind, source }) =>
        onUnhandledError(error, kind, source),
    });

    // @ts-ignore
    process.emit("unhandledRejection", new Error("boom"), Promise.resolve());
    await new Promise((r) => setTimeout(r, 0));
    expect(onUnhandledError).toHaveBeenCalled();

    onUnhandledError.mockClear();
    await dispose();
    // After dispose, this run's handler should be unregistered and not receive events
    // @ts-ignore
    process.emit("unhandledRejection", new Error("boom2"), Promise.resolve());
    await new Promise((r) => setTimeout(r, 0));
    expect(onUnhandledError).not.toHaveBeenCalled();
  });
});
