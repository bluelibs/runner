import { LogPrinter } from "../../models/LogPrinter";

describe("LogPrinter", () => {
  const origLog = console.log;
  const origErr = console.error;
  let logs: string[];
  let errs: string[];

  beforeEach(() => {
    logs = [];
    errs = [];
    LogPrinter.setWriters({
      log: (msg: any) => logs.push(String(msg)),
      error: (msg: any) => errs.push(String(msg)),
    });
  });

  afterEach(() => {
    LogPrinter.resetWriters();
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

  it("handles none strategy as no-op", () => {
    const p = new LogPrinter({ strategy: "none", useColors: false });
    p.print({ ...baseLog });
    expect(logs.length + errs.length).toBe(0);
  });

  it("handles circular and bigint in message/data/context", () => {
    const p = new LogPrinter({ strategy: "json", useColors: false });
    const circ: any = { x: 1 };
    circ.self = circ;
    p.print({ ...baseLog, message: circ });
    expect(logs[0]).toContain("[Circular]");
    logs = [];
    p.print({ ...baseLog, message: { big: BigInt(10) } as any });
    expect(logs[0]).toContain('"10"');
    // Force stringify fallback path by throwing in toString
    logs = [];
    const bad = {
      toJSON() {
        throw new Error("no json 4u");
      },
      toString() {
        throw new Error("no string 4u");
      },
    } as any;
    // Should not throw and should return [Unserializable]
    p.print({ ...baseLog, message: bad });
    expect(logs[0]).toContain("[Unserializable]");
  });

  it("resetWriters restores default console writers", () => {
    LogPrinter.resetWriters();
    const spyLog = jest.spyOn(console, "log").mockImplementation(() => {});
    const spyErr = jest
      .spyOn(console, "error")
      .mockImplementation((() => {}) as any);

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
});
