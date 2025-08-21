import { defineResource } from "../../define";
import { run } from "../../run";

describe("run.ts shutdown hooks & error boundary", () => {
  it("installs process safety nets and calls onUnhandledError for uncaughtException", async () => {
    const app = defineResource({
      id: "tests.app.safety",
      async init() {
        return "ok" as const;
      },
    });

    const onUnhandledError = jest.fn();
    const { dispose } = await run(app, {
      errorBoundary: true,
      shutdownHooks: false,
      onUnhandledError: async ({ error, kind, source }) => {
        onUnhandledError(error, kind, source);
      },
    });

    // Emit uncaughtException without killing the process by catching internally
    // @ts-ignore
    process.emit("uncaughtException", new Error("boom-uncaught"));

    // Give event loop a tick
    await new Promise((r) => setTimeout(r, 0));

    expect(onUnhandledError).toHaveBeenCalled();
    const err = onUnhandledError.mock.calls[0][0];
    expect(err).toBeInstanceOf(Error);

    await dispose();
  });

  it("calls onUnhandledError on unhandledRejection", async () => {
    const app = defineResource({
      id: "tests.app.unhandledRejection",
      async init() {
        return "ok" as const;
      },
    });

    const onUnhandledError = jest.fn();
    const { dispose } = await run(app, {
      errorBoundary: true,
      shutdownHooks: false,
      onUnhandledError: async ({ error, kind, source }) =>
        onUnhandledError(error, kind, source),
    });

    // @ts-ignore
    process.emit(
      "unhandledRejection",
      new Error("boom-unhandled"),
      Promise.resolve(),
    );

    await new Promise((r) => setTimeout(r, 0));

    expect(onUnhandledError).toHaveBeenCalled();
    const err = onUnhandledError.mock.calls[0][0];
    expect(err).toBeInstanceOf(Error);

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
