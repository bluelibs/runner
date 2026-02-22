import { globalTags } from "../../../globals/globalTags";
import { hookInterceptorResource } from "../../../globals/resources/debug/hook.hook";

describe("globals.resources.debug.hookInterceptorResource (unit)", () => {
  it("logs hook start and completion when enabled", async () => {
    const messages: string[] = [];
    const logger = {
      info: async (message: string) => {
        messages.push(message);
      },
    };

    let nextCalls = 0;
    let interceptionDone: Promise<void> | undefined;
    const eventManager = {
      interceptHook: (interceptor: Function) => {
        interceptionDone = interceptor(
          async () => {
            nextCalls += 1;
          },
          { id: "tests.hook.unit" },
          { id: "tests.event.unit" },
        );
      },
    };

    await hookInterceptorResource.init?.(
      undefined as never,
      {
        logger,
        eventManager,
        debugConfig: {
          logHookTriggered: true,
          logHookCompleted: true,
        },
      } as never,
      undefined as never,
    );
    await interceptionDone;

    expect(nextCalls).toBe(1);
    expect(
      messages.some((m) => m.includes("Hook triggered for tests.hook.unit")),
    ).toBe(true);
    expect(
      messages.some((m) => m.includes("Hook completed for tests.hook.unit")),
    ).toBe(true);
  });

  it("skips logging for system hooks and for disabled flags", async () => {
    const messages: string[] = [];
    const logger = {
      info: async (message: string) => {
        messages.push(message);
      },
    };

    let nextCalls = 0;
    let interceptionDone: Promise<void> | undefined;
    const eventManager = {
      interceptHook: (interceptor: Function) => {
        interceptionDone = (async () => {
          await interceptor(
            async () => {
              nextCalls += 1;
            },
            { id: "tests.hook.system", tags: [globalTags.system] },
            { id: "tests.event.system" },
          );

          await interceptor(
            async () => {
              nextCalls += 1;
            },
            { id: "tests.hook.disabled" },
            { id: "tests.event.disabled" },
          );
        })();
      },
    };

    await hookInterceptorResource.init?.(
      undefined as never,
      {
        logger,
        eventManager,
        debugConfig: {
          logHookTriggered: false,
          logHookCompleted: false,
        },
      } as never,
      undefined as never,
    );
    await interceptionDone;

    expect(nextCalls).toBe(2);
    expect(messages).toEqual([]);
  });
});
