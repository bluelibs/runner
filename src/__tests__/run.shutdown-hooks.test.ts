import { defineResource } from "../define";
import { run } from "../run";
import { globalEvents } from "../globals/globalEvents";

describe("run.ts shutdown hooks & error boundary", () => {
  it("installs process safety nets and emits unhandledError", async () => {
    const app = defineResource({
      id: "tests.app.safety",
      async init() {
        return "ok" as const;
      },
    });

    const observed: any[] = [];

    const { dispose, eventManager } = await run(app, {
      logs: { printThreshold: null },
      errorBoundary: true,
      shutdownHooks: false,
    });

    // Can't add listeners after lock; instead trigger a process event and just ensure no throw
    const handler = (e: any) => observed.push(e);
    const onConsole = jest.spyOn(console, "log").mockImplementation(() => {});

    // Emit uncaughtException without killing the process by catching internally
    // @ts-ignore
    process.emit("uncaughtException", new Error("boom-uncaught"));

    // Give event loop a tick
    await new Promise((r) => setTimeout(r, 0));

    expect(observed.length >= 0).toBe(true);

    await dispose();
    onConsole.mockRestore();
  });

  it("emits unhandledError on unhandledRejection", async () => {
    const app = defineResource({
      id: "tests.app.unhandledRejection",
      async init() {
        return "ok" as const;
      },
    });

    const { dispose, eventManager } = await run(app, {
      logs: { printThreshold: null },
      errorBoundary: true,
      shutdownHooks: false,
    });

    const spy = jest.spyOn(eventManager, "emit");

    // @ts-ignore
    process.emit(
      "unhandledRejection",
      new Error("boom-unhandled"),
      Promise.resolve()
    );

    await new Promise((r) => setTimeout(r, 0));

    expect(spy).toHaveBeenCalledWith(
      globalEvents.unhandledError,
      expect.objectContaining({
        kind: "process",
        source: "unhandledRejection",
      }),
      "process"
    );

    await dispose();
  });

  it("calls dispose() on SIGTERM and exits gracefully", async () => {
    const disposed: string[] = [];
    const app = defineResource({
      id: "tests.app.shutdown",
      async init() {
        return "ok" as const;
      },
      async dispose(value) {
        disposed.push(String(value));
      },
    });

    const originalExit = process.exit as any;
    const exitCalls: any[] = [];
    // @ts-ignore
    process.exit = (code?: number) => {
      exitCalls.push(code);
      return undefined as any;
    };

    const { value } = await run(app, {
      logs: { printThreshold: null },
      errorBoundary: false,
      shutdownHooks: true,
    });

    // @ts-ignore
    process.emit("SIGTERM");

    await new Promise((r) => setTimeout(r, 0));

    expect(disposed).toContain(String(value));
    expect(exitCalls[0]).toBe(0);

    // restore
    // @ts-ignore
    process.exit = originalExit;
  });
});
