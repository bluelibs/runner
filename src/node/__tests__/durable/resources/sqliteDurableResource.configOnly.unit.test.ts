import { Logger } from "../../../../models/Logger";
import { defineResource } from "../../../../index";
type DisposeDurableService =
  typeof import("../../../durable/core/DurableService").disposeDurableService;

describe("durable: sqliteDurableResource (config-only)", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  function mockRuntimeDeps() {
    const createRunnerDurableRuntime = jest.fn(async () => ({
      service: { cooldown: jest.fn(async () => {}) },
    }));
    const disposeDurableService = jest.fn<
      ReturnType<DisposeDurableService>,
      Parameters<DisposeDurableService>
    >(async () => {});
    const SqliteStore = jest.fn(function (
      this: { cfg: unknown },
      cfg: unknown,
    ) {
      this.cfg = cfg;
    });
    const MemoryQueue = jest.fn();

    jest.doMock("../../../durable/core/createRunnerDurableRuntime", () => ({
      createRunnerDurableRuntime,
    }));
    jest.doMock("../../../durable/core/DurableService", () => ({
      disposeDurableService,
    }));
    jest.doMock("../../../durable/store/SqliteStore", () => ({ SqliteStore }));
    jest.doMock("../../../durable/queue/MemoryQueue", () => ({ MemoryQueue }));

    let sqliteDurableResource!: typeof import("../../../durable/resources/sqliteDurableResource").sqliteDurableResource;
    jest.isolateModules(() => {
      ({
        sqliteDurableResource,
      } = require("../../../durable/resources/sqliteDurableResource"));
    });
    return {
      sqliteDurableResource,
      createRunnerDurableRuntime,
      disposeDurableService,
      SqliteStore,
      MemoryQueue,
    };
  }

  it("initializes SqliteStore with defaults, optional queue, and custom serializer/namespace", async () => {
    const deps = mockRuntimeDeps();
    const customSer = defineResource({
      id: "custom-ser",
      init: async () => ({}) as never,
    });
    const selector = deps.sqliteDurableResource.dependencies as unknown as (
      cfg: unknown,
    ) => Record<string, unknown>;
    expect(selector({})).toHaveProperty("serializer");
    expect(selector({ serializer: customSer }).serializer).toBe(customSer);
    expect((deps.sqliteDurableResource.context as () => unknown)()).toEqual({
      runtimeConfig: null,
    });

    const forked = deps.sqliteDurableResource.fork("orders-wf");
    const resourceContext = { runtimeConfig: null };
    const durable = await forked.init!(
      {
        namespace: "custom-ns",
        persist: {
          filename: ":memory:",
          busyTimeoutMs: 1_000,
          autoCreateTables: true,
        },
        queue: { enabled: true, consume: true },
      },
      {
        taskRunner: {} as never,
        eventManager: {} as never,
        runnerStore: {} as never,
        logger: new Logger({
          printThreshold: null,
          printStrategy: "pretty",
          bufferLogs: false,
        }),
        serializer: {} as never,
      },
      resourceContext as never,
    );

    expect(deps.SqliteStore).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: "custom-ns",
        filename: ":memory:",
        busyTimeoutMs: 1_000,
        autoCreateTables: true,
      }),
    );
    expect(deps.MemoryQueue).toHaveBeenCalledTimes(1);
    expect(deps.createRunnerDurableRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ roles: { queueConsumer: true } }),
      expect.anything(),
    );

    await forked.cooldown!(
      durable,
      {} as never,
      {} as never,
      resourceContext as never,
    );
    expect(
      (durable.service as unknown as { cooldown: jest.Mock }).cooldown,
    ).toHaveBeenCalledTimes(1);
    await forked.dispose!(
      durable,
      {} as never,
      {} as never,
      resourceContext as never,
    );
    expect(deps.disposeDurableService).toHaveBeenCalledTimes(1);
  });

  it("handles queue disabled/omitted, logger fallback, default id namespace, and empty cooldown/dispose", async () => {
    const deps = mockRuntimeDeps();

    const resourceContext = { runtimeConfig: null };
    const res = deps.sqliteDurableResource.fork("sqlite-default-ns");
    await res.init!(
      { queue: { enabled: false } },
      {
        taskRunner: {} as never,
        eventManager: {} as never,
        runnerStore: {} as never,
        logger: undefined as never,
        serializer: {} as never,
      },
      resourceContext as never,
    );
    expect(deps.MemoryQueue).not.toHaveBeenCalled();
    expect(deps.SqliteStore).toHaveBeenCalledWith(
      expect.objectContaining({ namespace: "sqlite-default-ns" }),
    );

    await res.init!(
      {},
      {
        taskRunner: {} as never,
        eventManager: {} as never,
        runnerStore: {} as never,
        logger: undefined as never,
        serializer: {} as never,
      },
      { runtimeConfig: null } as never,
    );
    expect(deps.MemoryQueue).not.toHaveBeenCalled();

    await res.cooldown!({} as never, {} as never, {} as never, {
      runtimeConfig: null,
    });
    await res.dispose!({} as never, {} as never, {} as never, {
      runtimeConfig: null,
    });
    expect(deps.disposeDurableService).not.toHaveBeenCalled();
  });
});
