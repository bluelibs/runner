import {
  __resetProcessHooksForTests,
  __waitForProcessHooksIdleForTests,
  registerProcessLevelSafetyNets,
  registerShutdownHook,
} from "../../tools/processShutdownHooks";
import { getPlatform } from "../../platform";

describe("processShutdownHooks", () => {
  afterEach(() => {
    __resetProcessHooksForTests();
    jest.restoreAllMocks();
  });

  it("waits for in-flight process safety-net dispatches", async () => {
    let releaseHandler!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });

    const handler = jest.fn(async () => {
      await gate;
    });

    const cleanup = registerProcessLevelSafetyNets(handler);
    try {
      process.emit("uncaughtException", new Error("pending-handler"));

      const waitForIdle = __waitForProcessHooksIdleForTests();
      let resolved = false;
      void waitForIdle.then(() => {
        resolved = true;
      });

      await Promise.resolve();
      expect(resolved).toBe(false);

      releaseHandler();
      await expect(waitForIdle).resolves.toBeUndefined();
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });

  it("logs when a process safety-net handler throws", async () => {
    expect.assertions(2);
    const consoleSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const cleanup = registerProcessLevelSafetyNets(async () => {
      throw "handler failed";
    });
    try {
      process.emit("uncaughtException", new Error("uncaught value"));
      process.emit("unhandledRejection", "rejection value", Promise.resolve());
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(consoleSpy).toHaveBeenCalledWith(
        "[runner] Process error handler failed.",
        expect.objectContaining({ source: "uncaughtException" }),
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        "[runner] Process error handler failed.",
        expect.objectContaining({ source: "unhandledRejection" }),
      );
    } finally {
      cleanup();
      consoleSpy.mockRestore();
    }
  });

  it("runs shutdown disposers only once when multiple signals arrive quickly", async () => {
    let releaseDispose: (() => void) | undefined;
    const disposeGate = new Promise<void>((resolve) => {
      releaseDispose = resolve;
    });
    const disposer = jest.fn(async () => {
      await disposeGate;
    });

    const exitSpy = jest
      .spyOn(getPlatform(), "exit")
      .mockImplementation(() => undefined);

    const cleanup = registerShutdownHook(disposer);
    try {
      process.emit("SIGTERM");
      process.emit("SIGINT");

      await Promise.resolve();
      expect(disposer).toHaveBeenCalledTimes(1);

      if (!releaseDispose) {
        throw new Error("Expected disposer gate release function");
      }
      releaseDispose();

      await __waitForProcessHooksIdleForTests();
      expect(exitSpy).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });
});
