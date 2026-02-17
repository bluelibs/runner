import { defineResource } from "../../define";
import { run } from "../../run";
import { createMessageError } from "../../errors";

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

    const originalExit = process.exit;
    const exitCalls: any[] = [];
    (process as unknown as { exit: unknown }).exit = ((code?: number) => {
      exitCalls.push(code);
      return undefined as unknown as never;
    }) as unknown as never;

    try {
      const { value } = await run(app, {
        errorBoundary: false,
        shutdownHooks: true,
      });

      process.emit("SIGTERM");

      await new Promise((r) => setTimeout(r, 0));

      expect(disposed).toContain(String(value));
      expect(exitCalls[0]).toBe(0);
    } finally {
      (process as unknown as { exit: unknown }).exit = originalExit;
    }
  });

  it("exits with code 1 when shutdown disposers fail", async () => {
    const app = defineResource({
      id: "tests.app.shutdown.fail",
      async init() {
        return "ok" as const;
      },
      async dispose() {
        throw createMessageError("dispose failed");
      },
    });

    const originalExit = process.exit;
    const exitCalls: any[] = [];
    (process as unknown as { exit: unknown }).exit = ((code?: number) => {
      exitCalls.push(code);
      return undefined as unknown as never;
    }) as unknown as never;

    const consoleSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      await run(app, {
        errorBoundary: false,
        shutdownHooks: true,
      });

      process.emit("SIGTERM");
      await new Promise((r) => setTimeout(r, 0));

      expect(exitCalls[0]).toBe(1);
      expect(consoleSpy).toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
      (process as unknown as { exit: unknown }).exit = originalExit;
    }
  });
});
