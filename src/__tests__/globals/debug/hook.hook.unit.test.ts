import { defineHook } from "../../../define";
import { globalTags } from "../../../globals/globalTags";
import { allFalse } from "../../../globals/resources/debug/types";
import { hookInterceptorResource } from "../../../globals/resources/debug/hook.hook";
import { Logger } from "../../../models/Logger";
import { runtimeSource } from "../../../types/runtimeSource";

type HookInterceptorInit = NonNullable<typeof hookInterceptorResource.init>;
type HookInterceptorDeps = Parameters<HookInterceptorInit>[1];
type HookExecutionInterceptor = Parameters<
  HookInterceptorDeps["eventManager"]["interceptHook"]
>[0];
type HookExecutionEvent = Parameters<HookExecutionInterceptor>[2];

function createEmission(id: string): HookExecutionEvent {
  let propagationStopped = false;
  return {
    id,
    data: undefined,
    timestamp: new Date(),
    source: runtimeSource.runtime("tests"),
    meta: {},
    transactional: false,
    stopPropagation() {
      propagationStopped = true;
    },
    isPropagationStopped() {
      return propagationStopped;
    },
    tags: [],
  };
}

describe("globals.resources.debug.hookInterceptorResource (unit)", () => {
  it("logs hook start and completion when enabled", async () => {
    const messages: string[] = [];
    const logger = new Logger({
      printThreshold: null,
      printStrategy: "pretty",
      bufferLogs: false,
    });
    jest.spyOn(logger, "info").mockImplementation(async (message: unknown) => {
      messages.push(String(message));
    });

    let nextCalls = 0;
    let interceptionDone: Promise<void> | undefined;
    const hook = defineHook({
      id: "tests.hook.unit",
      on: "*",
      run: async () => undefined,
    });
    const eventManager = {
      interceptHook: (interceptor: HookExecutionInterceptor) => {
        interceptionDone = interceptor(
          async () => {
            nextCalls += 1;
          },
          hook,
          createEmission("tests.event.unit"),
        );
      },
    };
    const deps = {
      logger,
      eventManager:
        eventManager as unknown as HookInterceptorDeps["eventManager"],
      debugConfig: {
        ...allFalse,
        logHookTriggered: true,
        logHookCompleted: true,
      },
    } satisfies HookInterceptorDeps;

    await hookInterceptorResource.init?.(undefined, deps, undefined);
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
    const logger = new Logger({
      printThreshold: null,
      printStrategy: "pretty",
      bufferLogs: false,
    });
    jest.spyOn(logger, "info").mockImplementation(async (message: unknown) => {
      messages.push(String(message));
    });

    let nextCalls = 0;
    let interceptionDone: Promise<void> | undefined;
    const systemHook = defineHook({
      id: "tests.hook.system",
      on: "*",
      run: async () => undefined,
      tags: [globalTags.system],
    });
    const disabledHook = defineHook({
      id: "tests.hook.disabled",
      on: "*",
      run: async () => undefined,
    });
    const eventManager = {
      interceptHook: (interceptor: HookExecutionInterceptor) => {
        interceptionDone = (async () => {
          await interceptor(
            async () => {
              nextCalls += 1;
            },
            systemHook,
            createEmission("tests.event.system"),
          );

          await interceptor(
            async () => {
              nextCalls += 1;
            },
            disabledHook,
            createEmission("tests.event.disabled"),
          );
        })();
      },
    };
    const deps = {
      logger,
      eventManager:
        eventManager as unknown as HookInterceptorDeps["eventManager"],
      debugConfig: {
        ...allFalse,
        logHookTriggered: false,
        logHookCompleted: false,
      },
    } satisfies HookInterceptorDeps;

    await hookInterceptorResource.init?.(undefined, deps, undefined);
    await interceptionDone;

    expect(nextCalls).toBe(2);
    expect(messages).toEqual([]);
  });
});
