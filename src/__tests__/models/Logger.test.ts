import { Logger, ILog, PrintStrategy } from "../../models/Logger";
import { createMessageError } from "../../errors";

describe("Logger", () => {
  let consoleSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  const createLogger = (
    opts?: Partial<{
      threshold: any;
      strategy: PrintStrategy;
      buffer: boolean;
    }>,
  ) =>
    new Logger({
      printThreshold:
        opts && Object.prototype.hasOwnProperty.call(opts, "threshold")
          ? opts.threshold
          : "info",
      printStrategy: opts?.strategy ?? "pretty",
      bufferLogs: opts?.buffer ?? false,
    });

  const gather = () => {
    const logs = consoleSpy.mock.calls.map((c) => String(c[0]));
    const errs = consoleErrorSpy.mock.calls.map((c) => String(c[0]));
    return [...logs, ...errs].join("\n");
  };

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.clearAllMocks();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("supports with() to bind and merge context, and uses bound source as fallback", async () => {
    const base = createLogger();
    const logger = base.with({
      source: "worker",
      additionalContext: { userId: 42 },
    });

    await logger.info("hello");

    const all = gather();
    expect(all).toContain("worker");
    expect(all).toContain("Context:");
    expect(all).toContain('"userId": 42');

    // Override source from logInfo
    consoleSpy.mockClear();
    await logger.info("hello", { source: "override" });
    const overridden = consoleSpy.mock.calls
      .map((c) => String(c[0]))
      .join("\n");
    expect(overridden).toContain("override");
  });

  it("triggers local listeners even when below print threshold", async () => {
    const logger = createLogger({ threshold: "error" });
    const seen: any[] = [];
    logger.onLog((log) => {
      seen.push(log);
    });

    await logger.info("not printed");

    expect(seen).toHaveLength(1);
    expect(seen[0].level).toBe("info");
    expect(consoleSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("respects print threshold severity", async () => {
    const logger = createLogger({ threshold: "warn" });
    await logger.info("INFO_MSG");
    await logger.warn("WARN_MSG");
    await logger.error("ERROR_MSG");

    const outputs = gather();
    expect(outputs).not.toContain("INFO_MSG");
    expect(outputs).toContain("WARN_MSG");
    expect(outputs).toContain("ERROR_MSG");
    // Ensure warn/error went to stderr path
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("buffers logs until markAsReady() and then prints and notifies listeners in order", async () => {
    const logger = createLogger({ buffer: true, threshold: "trace" });
    const levels: string[] = [];
    logger.onLog((log) => {
      levels.push(String(log.message));
    });

    await logger.info("first");
    await logger.warn("second");
    expect(consoleSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(levels).toHaveLength(0);

    await logger.lock();

    // listeners then printing
    expect(levels).toEqual(["first", "second"]);
    const outputs = gather();
    expect(outputs.indexOf("first")).toBeGreaterThanOrEqual(0);
    expect(outputs.indexOf("second")).toBeGreaterThan(outputs.indexOf("first"));

    // New logs after ready are not buffered
    consoleSpy.mockClear();
    levels.length = 0;
    await logger.info("third");
    expect(levels).toEqual(["third"]);
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("markAsReady is idempotent (second call is no-op)", async () => {
    const logger = createLogger({ buffer: true, threshold: "trace" });
    await logger.info("first");
    await logger.lock();
    consoleSpy.mockClear();
    await logger.lock();
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("catches errors from log listeners and logs a listener error without stopping others", async () => {
    const logger = createLogger({ threshold: "trace" });
    const seen: string[] = [];
    logger.onLog(() => {
      throw createMessageError("listener failed");
    });
    logger.onLog((log) => {
      seen.push(String(log.message));
    });

    await logger.info("hello");

    // second listener still executed
    expect(seen).toEqual(["hello"]);
    // an internal error is printed about the listener failure
    const outputs = gather();
    expect(outputs).toContain("Error in log listener");
  });

  it("formats non-Error thrown by listener using String(error)", async () => {
    const logger = createLogger({ threshold: "trace" });
    logger.onLog(() => {
      // throw a primitive to exercise the fallback branch

      throw "primitive";
    });
    await logger.info("hi");
    const outputs = gather();
    expect(outputs).toContain("Error in log listener");
    expect(outputs).toContain("primitive");
  });

  it("does not print anything when threshold is null", async () => {
    const logger = createLogger({ threshold: null });
    await logger.info("should not print");
    await logger.error("should also not print");
    expect(consoleSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("formats errors without stack: shows only the error line", async () => {
    const logger = createLogger({ threshold: "trace" });
    const err = new Error("NoStack");
    Object.defineProperty(err, "stack", { value: undefined });
    await logger.error("oops", { error: err });
    const outputs = gather();
    expect(outputs).toContain("Error: NoStack");
    expect(outputs).not.toContain("↳");
  });

  it("prints data when provided and omits when empty", async () => {
    const logger = createLogger({ threshold: "trace" });

    await logger.info("with data", { data: { foo: "bar", nested: { a: 1 } } });
    let outputs = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(outputs).toContain("Data:");
    expect(outputs).toContain('"foo": "bar"');
    expect(outputs).toContain('"nested":');

    consoleSpy.mockClear();
    await logger.info("empty data", { data: {} });
    outputs = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(outputs).not.toContain("Data:");
  });

  it("prints context merging bound and log contexts, omitting source", async () => {
    const base = createLogger({ threshold: "trace" });
    const logger = base.with({
      source: "svc",
      additionalContext: { traceId: "t-1" },
    });
    await logger.info("ctx msg", { sessionId: "s-1" });
    const outputs = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(outputs).toContain("Context:");
    expect(outputs).toContain('"traceId": "t-1"');
    expect(outputs).toContain('"sessionId": "s-1"');
    // source should not be listed under context
    expect(outputs).not.toMatch(/Context:[\s\S]*"source"/);
  });

  it("does not print context section when it would be empty", () => {
    const logger = createLogger({ threshold: "trace" });
    const log = {
      level: "info",
      message: "no ctx",
      timestamp: new Date(),
      source: undefined,
      error: undefined,
      data: undefined,
      context: undefined,
    } as unknown as ILog;
    logger.print(log);
    const outputs = gather();
    expect(outputs).toContain("no ctx");
    expect(outputs).not.toContain("Context:");
  });

  it("omits context section when only bound source exists (filtered to empty)", async () => {
    const base = createLogger({ threshold: "trace" });
    const logger = base.with({ source: "only-src" });
    await logger.info("msg");
    const outputs = gather();
    expect(outputs).toContain("only-src");
    expect(outputs).not.toContain("Context:");
  });

  it("formats object messages with indented subsequent lines", async () => {
    const logger = createLogger({ threshold: "trace" });
    await logger.info({ k: "v", nested: { a: 1 } });
    const outputs = gather();
    // subsequent lines are prefixed with 2 spaces
    expect(outputs).toMatch(/\n\s{2,}\"nested\":/);
  });

  it("convenience methods call the core log with expected levels", async () => {
    const logger = createLogger({ threshold: "trace", strategy: "plain" });
    const spy = jest.spyOn(logger, "log");
    await logger.trace("t");
    await logger.debug("d");
    await logger.info("i");
    await logger.warn("w");
    await logger.error("e");
    await logger.critical("c");
    const levels = spy.mock.calls.map((c) => c[0]);
    expect(levels).toEqual([
      "trace",
      "debug",
      "info",
      "warn",
      "error",
      "critical",
    ]);
  });

  it("print gracefully handles unknown levels by falling back for formatting", () => {
    const logger = createLogger({ threshold: "trace" });
    const fake = {
      level: "custom", // not a known level
      message: "custom level",
      timestamp: new Date("2020-01-01T00:00:00.123Z"),
      source: "src",
      error: undefined,
      data: undefined,
      context: {},
    } as unknown as ILog;
    consoleSpy.mockClear();
    consoleErrorSpy.mockClear();
    logger.print(fake);
    const outputs = gather();
    expect(outputs).toContain("custom level");
    // icon should be the default ● when unknown
    expect(outputs).toMatch(/●[\s\S]*CUSTOM/);
  });

  it("prints object messages with indentation (strategy does not affect content formatting)", async () => {
    const logger = new Logger({
      printThreshold: "info",
      printStrategy: "json_pretty",
      bufferLogs: false,
      useColors: true,
    });
    await logger.info({ a: 1, b: { c: 2 } });
    const outputs = gather();
    expect(outputs).toContain('"a": 1');
    expect(outputs).toContain('"b": {');
    expect(outputs).toContain('"c": 2');
  });

  it("with() delegates buffering and listeners to the root logger", async () => {
    // Root buffers; child logs should be buffered and later flushed by root.lock()
    const root = new Logger({
      printThreshold: "trace",
      printStrategy: "pretty",
      bufferLogs: true,
    });

    const seen: string[] = [];
    root.onLog((log) => {
      seen.push(String(log.message));
    });

    const child = root.with({ source: "child" });

    await child.info("m1");
    await child.warn("m2");

    // Nothing emitted yet because root buffers
    expect(consoleSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(seen).toHaveLength(0);

    // Flushing the root should notify listeners first, then print
    await root.lock();

    expect(seen).toEqual(["m1", "m2"]);
    const outputs = gather();
    // Order across stdout/stderr is not guaranteed when aggregating streams; ensure both got printed
    expect(outputs).toContain("m1");
    expect(outputs).toContain("m2");
  });

  it("registering listener on child delegates to root logger", async () => {
    const root = new Logger({
      printThreshold: "trace",
      printStrategy: "pretty",
      bufferLogs: false,
    });

    const child = root.with({ source: "child" });

    const seen: string[] = [];
    // This should hit the delegation branch in onLog()
    child.onLog((log) => {
      seen.push(String(log.message));
    });

    await root.info("from root");
    await child.info("from child");

    expect(seen).toEqual(["from root", "from child"]);
  });

  it("child.triggerLogListeners delegates up to root (private path)", async () => {
    const root = new Logger({
      printThreshold: null,
      printStrategy: "pretty",
      bufferLogs: false,
    });

    const child = root.with({ source: "child" });

    const seen: string[] = [];
    root.onLog((log) => {
      seen.push(String(log.message));
    });

    const spy = jest.spyOn(
      root as unknown as { triggerLogListeners: any },
      "triggerLogListeners",
    );

    // Directly invoke the private method on the child to cover the branch
    await (
      child as unknown as { triggerLogListeners: (log: any) => Promise<void> }
    ).triggerLogListeners({
      level: "info",
      message: "via child",
      timestamp: new Date(),
    });

    expect(spy).toHaveBeenCalled();
    expect(seen).toEqual(["via child"]);
  });

  it("respects NO_COLOR env by disabling ANSI color codes", async () => {
    const prev = process.env.NO_COLOR;
    process.env.NO_COLOR = "1";
    try {
      const logger = createLogger({ threshold: "info" });
      await logger.info("plain");
      const outputs = gather();
      // No ESC sequences should be present
      expect(outputs).not.toMatch(/\x1b\[/);
    } finally {
      if (prev === undefined) {
        const env = process.env;
        delete env.NO_COLOR;
      } else {
        process.env.NO_COLOR = prev;
      }
    }
  });

  it("prints errors with stack", async () => {
    const logger = createLogger({ threshold: "trace" });
    const err = new Error("WithStack");
    Object.defineProperty(err, "stack", { value: "stack" });
    await logger.error("oops", { error: err });
    const outputs = gather();
    expect(outputs).toContain("Error: WithStack");
  });

  it("extractErrorInfo returns expected structure for real Error objects", async () => {
    const logger = createLogger({ threshold: null });
    let captured: any;
    logger.onLog((log) => {
      captured = log;
    });
    const err = new Error("RealBoom");
    Object.defineProperty(err, "stack", { value: "STACK_TRACE" });
    await logger.error("trigger", { error: err });
    expect(captured).toBeDefined();
    expect(captured.error).toBeDefined();
    expect(captured.error.name).toBe("Error");
    expect(captured.error.message).toBe("RealBoom");
    expect(captured.error.stack).toBe("STACK_TRACE");
  });

  it("extractErrorInfo handles non-Error values by coercing to string and using UnknownError name", async () => {
    const logger = createLogger({ threshold: null });
    let captured: any;
    logger.onLog((log) => {
      captured = log;
    });
    await logger.error("trigger primitive", {
      error: "primitive boom" as unknown as Error,
    });
    expect(captured).toBeDefined();
    expect(captured.error).toEqual({
      name: "UnknownError",
      message: "primitive boom",
    });
  });
});
