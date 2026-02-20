import { LogPrinter } from "../../models/LogPrinter";
import { createMessageError } from "../../errors";

describe("LogPrinter", () => {
  const origLog = console.log;
  const origErr = console.error;
  let logs: string[];
  let errs: string[];

  beforeAll(() => {
    console.log = (...args: any[]) => logs.push(args.map(String).join(" "));
    console.error = (...args: any[]) => errs.push(args.map(String).join(" "));
  });

  beforeEach(() => {
    logs = [];
    errs = [];
    LogPrinter.setWriters({
      log: (msg: unknown) => logs.push(String(msg)),
      error: (msg: unknown) => errs.push(String(msg)),
    });
  });

  afterEach(() => {
    LogPrinter.resetWriters();
  });

  afterAll(() => {
    console.log = origLog;
    console.error = origErr;
  });

  const baseLog = {
    level: "info" as const,
    message: "hello",
    timestamp: new Date("2020-01-01T00:00:00.123Z"),
  };

  it("pretty prints to stdout", () => {
    const p = new LogPrinter({ strategy: "pretty", useColors: false });
    p.print({ ...baseLog });
    expect(logs.length).toBeGreaterThan(0);
    expect(errs.length).toBe(0);
  });

  it("routes warn/error/critical to stderr", () => {
    const p = new LogPrinter({ strategy: "pretty", useColors: false });
    p.print({ ...baseLog, level: "warn" });
    p.print({ ...baseLog, level: "error" });
    p.print({ ...baseLog, level: "critical" });
    expect(errs.length).toBeGreaterThanOrEqual(3);
  });

  it("prints json compact and pretty", () => {
    const p = new LogPrinter({ strategy: "json", useColors: false });
    p.print({ ...baseLog, message: { a: 1 } });
    expect(() => JSON.parse(logs[0])).not.toThrow();
    logs = [];
    const p2 = new LogPrinter({ strategy: "json_pretty", useColors: false });
    p2.print({ ...baseLog, message: { a: 1 } });
    expect(logs[0].includes("\n")).toBe(true);
  });

  it("plain prints like pretty without ANSI even when useColors is true", () => {
    const p = new LogPrinter({ strategy: "plain", useColors: true });
    p.print({ ...baseLog });
    expect(logs.length).toBeGreaterThan(0);
    expect(errs.length).toBe(0);
    const combined = logs.join("\n");
    expect(combined).not.toMatch(/\x1b\[/);
  });

  it("pretty prints error stack frames", () => {
    const p = new LogPrinter({ strategy: "pretty", useColors: true });
    const error = new Error("Test Error");
    error.stack =
      "Error: Test Error\n  at Object.<anonymous> (test.ts:1:1)\n  at process (node.js:1:1)";

    p.print({
      level: "error",
      message: "msg",
      timestamp: new Date("2020-01-01T00:00:00.123Z"),
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
    });

    expect(errs.join("\n")).toContain("Object.<anonymous>");
    expect(errs.join("\n")).toContain("process (node.js:1:1)");
  });

  it("handles circular and bigint in message/data/context", () => {
    const p = new LogPrinter({ strategy: "json", useColors: false });
    const circ: any = { x: 1 };
    circ.self = circ;
    p.print({ ...baseLog, message: circ });
    expect(logs[0]).toContain("[Circular]");
    logs = [];
    p.print({ ...baseLog, message: { big: BigInt(10) } });
    expect(logs[0]).toContain('"10"');
    // Force stringify fallback path by throwing in toString
    logs = [];
    const bad = {
      toJSON() {
        throw createMessageError("no json 4u");
      },
      toString() {
        throw createMessageError("no string 4u");
      },
    } as unknown as any;
    // Should not throw and should return [Unserializable]
    p.print({ ...baseLog, message: bad });
    expect(logs[0]).toContain("[Unserializable]");
  });

  it("resetWriters restores default console writers", () => {
    LogPrinter.resetWriters();
    const spyLog = jest.spyOn(console, "log").mockImplementation(() => {});
    const spyErr = jest.spyOn(console, "error").mockImplementation(() => {});

    try {
      const p = new LogPrinter({ strategy: "pretty", useColors: false });
      p.print({ ...baseLog, level: "info" });
      p.print({ ...baseLog, level: "warn" });
      expect(spyLog).toHaveBeenCalled();
      expect(spyErr).toHaveBeenCalled();
    } finally {
      spyLog.mockRestore();
      spyErr.mockRestore();
    }
  });

  it("does not throw when console is missing", () => {
    const savedConsole = globalThis.console;

    try {
      (globalThis as any).console = undefined;
      LogPrinter.resetWriters();

      const p = new LogPrinter({ strategy: "pretty", useColors: false });
      expect(() => p.print({ ...baseLog, level: "info" })).not.toThrow();
      expect(() => p.print({ ...baseLog, level: "error" })).not.toThrow();
    } finally {
      (globalThis as any).console = savedConsole;
      LogPrinter.resetWriters();
    }
  });
});
