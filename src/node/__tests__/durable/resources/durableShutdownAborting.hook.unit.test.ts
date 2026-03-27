import { Logger } from "../../../../models/Logger";
import { DurableResource } from "../../../durable/core/DurableResource";
import { durableShutdownAbortingHook } from "../../../durable/resources/durableShutdownAborting.hook";
import type { IDurableService } from "../../../durable/core/interfaces/service";
import { AsyncLocalStorage } from "node:async_hooks";
import type { IDurableContext } from "../../../durable/core/interfaces/context";
import type { TagDependencyAccessor } from "../../../../types/tagged";
import { durableRuntimeTag } from "../../../durable/tags/durableRuntime.tag";

type HookRun = NonNullable<typeof durableShutdownAbortingHook.run>;
type HookRunDeps = Parameters<HookRun>[1];

function createLogger(): Logger {
  return new Logger({
    printThreshold: null,
    printStrategy: "pretty",
    bufferLogs: false,
  });
}

function createMockDurableService(): IDurableService {
  return {
    cooldown: jest.fn(async () => undefined),
    interruptActiveAttempts: jest.fn(),
    start: jest.fn(async () => "execution-id"),
    cancelExecution: jest.fn(async () => undefined),
    wait: jest.fn(async () => undefined),
    startAndWait: jest.fn(async () => ({
      durable: { executionId: "execution-id" },
      data: undefined,
    })),
    schedule: jest.fn(async () => "schedule-id"),
    ensureSchedule: jest.fn(async () => "schedule-id"),
    recover: jest.fn(async () => ({
      scannedCount: 0,
      recoveredCount: 0,
      skippedCount: 0,
      failedCount: 0,
      recovered: [],
      skipped: [],
      failures: [],
    })),
    stop: jest.fn(async () => undefined),
    pauseSchedule: jest.fn(async () => undefined),
    resumeSchedule: jest.fn(async () => undefined),
    getSchedule: jest.fn(async () => null),
    listSchedules: jest.fn(async () => []),
    updateSchedule: jest.fn(async () => undefined),
    removeSchedule: jest.fn(async () => undefined),
    signal: jest.fn(async () => undefined),
  } as unknown as IDurableService;
}

function createTaggedDurableResources(
  resources: TagDependencyAccessor<typeof durableRuntimeTag>["resources"],
): TagDependencyAccessor<typeof durableRuntimeTag> {
  return {
    tasks: [],
    resources,
    events: [],
    hooks: [],
    taskMiddlewares: [],
    resourceMiddlewares: [],
    errors: [],
  };
}

describe("durable: durableShutdownAbortingHook", () => {
  it("interrupts initialized durable resources only", async () => {
    const logger = createLogger();
    const durableService = createMockDurableService();
    const durable = new DurableResource(
      durableService,
      new AsyncLocalStorage<IDurableContext>(),
    );
    const durableRuntimes = createTaggedDurableResources([
      {
        definition: { id: "tests.durable", tags: [durableRuntimeTag] } as any,
        config: undefined,
        value: durable,
      },
      {
        definition: { id: "tests.lazy", tags: [durableRuntimeTag] } as any,
        config: undefined,
        value: undefined,
      },
    ]);

    const deps = { durableRuntimes, logger } satisfies HookRunDeps;

    await durableShutdownAbortingHook.run?.(undefined as never, deps);

    expect(durableService.interruptActiveAttempts).toHaveBeenCalledTimes(1);
  });

  it("logs and continues when one durable runtime fails to interrupt", async () => {
    const logger = createLogger();
    const warn = jest.spyOn(logger, "warn").mockResolvedValue(undefined);
    const failingService = createMockDurableService();
    const healthyService = createMockDurableService();

    (
      failingService.interruptActiveAttempts as unknown as jest.Mock
    ).mockImplementation(() => {
      throw new Error("interrupt-failed");
    });

    const durableRuntimes = createTaggedDurableResources([
      {
        definition: { id: "tests.failing", tags: [durableRuntimeTag] } as any,
        config: undefined,
        value: new DurableResource(
          failingService,
          new AsyncLocalStorage<IDurableContext>(),
        ),
      },
      {
        definition: { id: "tests.healthy", tags: [durableRuntimeTag] } as any,
        config: undefined,
        value: new DurableResource(
          healthyService,
          new AsyncLocalStorage<IDurableContext>(),
        ),
      },
    ]);

    const deps = { durableRuntimes, logger } satisfies HookRunDeps;

    await durableShutdownAbortingHook.run?.(undefined as never, deps);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(healthyService.interruptActiveAttempts).toHaveBeenCalledTimes(1);
  });
});
