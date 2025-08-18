import {
  middlewareCompletedListener,
  middlewareTriggeredListener,
} from "../../globals/resources/debug/middleware.hook";

describe("globals.resources.debug.middleware listeners", () => {
  it("logs for middleware triggered/completed when enabled", async () => {
    const infos: string[] = [];
    const logger = {
      info: async (msg: string) => infos.push(String(msg)),
    };
    const event = {
      id: "global.events.middlewareTriggered",
      data: { middleware: { id: "m" }, kind: "task", targetId: "t" },
    } as any;

    await middlewareTriggeredListener.run(event as any, {
      logger: logger as any,
      debugConfig: { logMiddlewareBeforeRun: true } as any,
    });

    const completed = {
      id: "global.events.middlewareCompleted",
      data: { middleware: { id: "m" }, kind: "task", targetId: "t" },
    } as any;
    await middlewareCompletedListener.run(completed as any, {
      logger: logger as any,
      debugConfig: { logMiddlewareAfterRun: true } as any,
    });

    expect(
      infos.some((m) => m.includes("[middleware] m started for task t")),
    ).toBe(true);
    expect(
      infos.some((m) => m.includes("[middleware] m completed for task t")),
    ).toBe(true);
  });

  it("does not log when flags disabled", async () => {
    const infos: string[] = [];
    const logger = {
      info: async (msg: string) => infos.push(String(msg)),
    };
    const cfg = {
      logMiddlewareBeforeRun: false,
      logMiddlewareAfterRun: false,
    };
    const triggered = {
      id: "global.events.middlewareTriggered",
      data: { middleware: { id: "m" }, kind: "resource", targetId: "r" },
    } as any;
    await middlewareTriggeredListener.run(triggered as any, {
      logger: logger as any,
      debugConfig: cfg as any,
    });

    const completed = {
      id: "global.events.middlewareCompleted",
      data: { middleware: { id: "m" }, kind: "resource", targetId: "r" },
    } as any;
    await middlewareCompletedListener.run(completed as any, {
      logger: logger as any,
      debugConfig: cfg as any,
    });

    expect(infos.length).toBe(0);
  });

  it("returns early when deps missing (defensive branch)", async () => {
    const event = {
      id: "global.events.middlewareTriggered",
      data: { middleware: { id: "m" }, kind: "task", targetId: "t" },
    } as any;
    // Should not throw
    await middlewareTriggeredListener.run(event as any, undefined as any);
  });
});
