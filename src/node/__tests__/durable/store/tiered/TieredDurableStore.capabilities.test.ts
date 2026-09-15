import { TieredDurableStore } from "../../../../durable/store/tiered/TieredDurableStore";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { createStubExecution, createStubStore } from "./stub.helpers";

const HOT_ONLY_OPTIONALS: Array<keyof TieredDurableStore> = [
  "appendAuditEntry",
  "commitSignalDelivery",
  "commitExecutionWaiterCompletion",
  "claimTimer",
  "renewTimerClaim",
  "releaseTimerClaim",
  "finalizeClaimedTimer",
  "listStuckExecutions",
  "acquireLock",
  "renewLock",
  "releaseLock",
];

const OPERATOR_OPTIONALS: Array<keyof TieredDurableStore> = [
  "retryRollback",
  "skipStep",
  "forceFail",
  "editStepResult",
];

describe("durable: TieredDurableStore capabilities", () => {
  it("forwards hot-only capabilities bound to hot", async () => {
    const hot = new MemoryStore();
    const cold = new MemoryStore();
    const tiered = new TieredDurableStore({ hot, cold });

    for (const capability of HOT_ONLY_OPTIONALS) {
      expect(typeof tiered[capability]).toBe("function");
    }

    await hot.createTimer({
      id: "timer-1",
      type: "sleep",
      fireAt: new Date("2024-01-01T00:00:00.000Z"),
      status: "pending",
    });
    await expect(tiered.claimTimer!("timer-1", "worker-1", 1000)).resolves.toBe(
      true,
    );
    await expect(
      tiered.renewTimerClaim!("timer-1", "worker-1", 1000),
    ).resolves.toBe(true);
  });

  it("leaves hot-only capabilities undefined when hot lacks them", () => {
    const bareHot = createStubStore({ without: [...HOT_ONLY_OPTIONALS] });
    const tiered = new TieredDurableStore({
      hot: bareHot,
      cold: new MemoryStore(),
    });

    for (const capability of HOT_ONLY_OPTIONALS) {
      expect(tiered[capability]).toBeUndefined();
    }
  });

  it("combines init/dispose across tiers", async () => {
    const hotInit = jest.fn();
    const hotDispose = jest.fn();
    const coldInit = jest.fn();
    const coldDispose = jest.fn();
    const tiered = new TieredDurableStore({
      hot: createStubStore({
        overrides: { init: hotInit, dispose: hotDispose },
      }),
      cold: createStubStore({
        overrides: { init: coldInit, dispose: coldDispose },
      }),
    });

    await tiered.init!();
    expect(hotInit).toHaveBeenCalledTimes(1);
    expect(coldInit).toHaveBeenCalledTimes(1);
    await tiered.dispose!();
    expect(hotDispose).toHaveBeenCalledTimes(1);
    expect(coldDispose).toHaveBeenCalledTimes(1);

    const hotOnly = new TieredDurableStore({
      hot: createStubStore({ overrides: { init: hotInit } }),
      cold: new MemoryStore(),
    });
    await hotOnly.init!();
    expect(hotInit).toHaveBeenCalledTimes(2);
    expect(hotOnly.dispose).toBeUndefined();

    const coldOnly = new TieredDurableStore({
      hot: new MemoryStore(),
      cold: createStubStore({ overrides: { dispose: coldDispose } }),
    });
    expect(coldOnly.init).toBeUndefined();
    await coldOnly.dispose!();
    expect(coldDispose).toHaveBeenCalledTimes(2);

    const neither = new TieredDurableStore({
      hot: new MemoryStore(),
      cold: new MemoryStore(),
    });
    expect(neither.init).toBeUndefined();
    expect(neither.dispose).toBeUndefined();
  });

  it("binds lifecycle hooks to their own tier", async () => {
    let hotThis: unknown;
    let coldThis: unknown;
    const hot = createStubStore({
      overrides: {
        init: async function (this: unknown) {
          hotThis = this;
        },
      },
    });
    const cold = createStubStore({
      overrides: {
        init: async function (this: unknown) {
          coldThis = this;
        },
      },
    });
    const tiered = new TieredDurableStore({ hot, cold });

    await tiered.init!();

    expect(hotThis).toBe(hot);
    expect(coldThis).toBe(cold);
  });

  it("exposes tiered reads when either tier supports them", async () => {
    const full = new TieredDurableStore({
      hot: new MemoryStore(),
      cold: new MemoryStore(),
    });
    expect(typeof full.listAuditEntries).toBe("function");
    expect(typeof full.listSignalStates).toBe("function");

    const coldOnly = new TieredDurableStore({
      hot: createStubStore({
        without: ["listAuditEntries", "listSignalStates"],
      }),
      cold: new MemoryStore(),
    });
    expect(typeof coldOnly.listAuditEntries).toBe("function");
    expect(typeof coldOnly.listSignalStates).toBe("function");

    const neither = new TieredDurableStore({
      hot: createStubStore({
        without: ["listAuditEntries", "listSignalStates"],
      }),
      cold: createStubStore({
        without: ["listAuditEntries", "listSignalStates"],
      }),
    });
    expect(neither.listAuditEntries).toBeUndefined();
    expect(neither.listSignalStates).toBeUndefined();
  });

  it("exposes operator actions only when hot supports them", () => {
    const full = new TieredDurableStore({
      hot: new MemoryStore(),
      cold: new MemoryStore(),
    });
    for (const capability of OPERATOR_OPTIONALS) {
      expect(typeof full[capability]).toBe("function");
    }

    const bare = new TieredDurableStore({
      hot: createStubStore({ without: [...OPERATOR_OPTIONALS] }),
      cold: new MemoryStore(),
    });
    for (const capability of OPERATOR_OPTIONALS) {
      expect(bare[capability]).toBeUndefined();
    }
  });

  it("reads cold execution details through the operator path", async () => {
    const cold = new MemoryStore();
    await cold.saveExecution(createStubExecution());
    const tiered = new TieredDurableStore({ hot: new MemoryStore(), cold });

    await expect(tiered.getExecution("exec-1")).resolves.toMatchObject({
      id: "exec-1",
    });
  });
});
