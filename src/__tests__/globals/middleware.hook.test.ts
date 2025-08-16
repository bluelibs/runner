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
      data: { middlewareId: "m", kind: "task", targetId: "t" },
    };

    await middlewareTriggeredListener.run(event as any, {
      logger: logger as any,
      debugConfig: { logMiddlewareBeforeRun: true } as any,
    });

    const completed = {
      id: "global.events.middlewareCompleted",
      data: { middlewareId: "m", kind: "task", targetId: "t" },
    };
    await middlewareCompletedListener.run(completed as any, {
      logger: logger as any,
      debugConfig: { logMiddlewareAfterRun: true } as any,
    });

    expect(
      infos.some((m) => m.includes("[middleware] m started for task t"))
    ).toBe(true);
    expect(
      infos.some((m) => m.includes("[middleware] m completed for task t"))
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
      data: { middlewareId: "m", kind: "resource", targetId: "r" },
    };
    await middlewareTriggeredListener.run(triggered as any, {
      logger: logger as any,
      debugConfig: cfg as any,
    });

    const completed = {
      id: "global.events.middlewareCompleted",
      data: { middlewareId: "m", kind: "resource", targetId: "r" },
    };
    await middlewareCompletedListener.run(completed as any, {
      logger: logger as any,
      debugConfig: cfg as any,
    });

    expect(infos.length).toBe(0);
  });

  it("returns early when deps missing (defensive branch)", async () => {
    const event = {
      id: "global.events.middlewareTriggered",
      data: { middlewareId: "m", kind: "task", targetId: "t" },
    };
    // Should not throw
    await middlewareTriggeredListener.run(event as any, undefined as any);
  });
});
