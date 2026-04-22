import { MemoryStore } from "../../../durable/store/MemoryStore";
import { createSignalWaiterSortKey } from "../../../durable/core/signalWaiters";

type MemoryStoreLegacyState = {
  executions: Map<string, unknown>;
  executionIdByIdempotencyKey: Map<string, string>;
  stepResults: Map<string, Map<string, unknown>>;
  signalStates: Map<string, Map<string, unknown>>;
  signalWaiters: Map<string, Map<string, Map<string, unknown>>>;
  executionWaiters: Map<string, Map<string, unknown>>;
  auditEntries: Map<string, unknown[]>;
  timers: Map<string, unknown>;
  schedules: Map<string, unknown>;
  locks: Map<string, { id: string; expires: number }>;
};

describe("durable: MemoryStore compatibility", () => {
  it("keeps legacy backing fields reachable for internal tests and probes", () => {
    const store = new MemoryStore() as unknown as MemoryStoreLegacyState;
    const executions = new Map<string, unknown>();
    const executionIdByIdempotencyKey = new Map<string, string>();
    const stepResults = new Map<string, Map<string, unknown>>();
    const signalStates = new Map<string, Map<string, unknown>>();
    const signalWaiters = new Map<string, Map<string, Map<string, unknown>>>();
    const executionWaiters = new Map<string, Map<string, unknown>>();
    const auditEntries = new Map<string, unknown[]>();
    const timers = new Map<string, unknown>();
    const schedules = new Map<string, unknown>();
    const locks = new Map<string, { id: string; expires: number }>();

    store.executions = executions;
    store.executionIdByIdempotencyKey = executionIdByIdempotencyKey;
    store.stepResults = stepResults;
    store.signalStates = signalStates;
    store.signalWaiters = signalWaiters;
    store.executionWaiters = executionWaiters;
    store.auditEntries = auditEntries;
    store.timers = timers;
    store.schedules = schedules;
    store.locks = locks;

    expect(store.executions).toBe(executions);
    expect(store.executionIdByIdempotencyKey).toBe(executionIdByIdempotencyKey);
    expect(store.stepResults).toBe(stepResults);
    expect(store.signalStates).toBe(signalStates);
    expect(store.signalWaiters).toBe(signalWaiters);
    expect(store.executionWaiters).toBe(executionWaiters);
    expect(store.auditEntries).toBe(auditEntries);
    expect(store.timers).toBe(timers);
    expect(store.schedules).toBe(schedules);
    expect(store.locks).toBe(locks);
  });

  it("supports default list query options through the split helpers", async () => {
    const store = new MemoryStore();

    await expect(store.listExecutions()).resolves.toEqual([]);
    await expect(store.listAuditEntries("missing")).resolves.toEqual([]);
  });

  it("keeps a signal bucket alive while the same signal still has waiters", async () => {
    const store = new MemoryStore();
    const firstStepId = "__signal:paid:first";
    const secondStepId = "__signal:paid:second";

    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: firstStepId,
      sortKey: createSignalWaiterSortKey("paid", firstStepId),
    });
    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: secondStepId,
      sortKey: createSignalWaiterSortKey("paid", secondStepId),
    });

    await store.deleteSignalWaiter("e1", "paid", firstStepId);

    const signalWaiters = (
      store as unknown as Pick<MemoryStoreLegacyState, "signalWaiters">
    ).signalWaiters;
    expect(signalWaiters.get("e1")?.has("paid")).toBe(true);
    await expect(store.takeNextSignalWaiter("e1", "paid")).resolves.toEqual({
      executionId: "e1",
      signalId: "paid",
      stepId: secondStepId,
      sortKey: createSignalWaiterSortKey("paid", secondStepId),
    });
  });
});
