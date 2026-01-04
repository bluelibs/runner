import { DurableService } from "../core/DurableService";
import { MemoryStore } from "../store/MemoryStore";

async function waitUntil(
  predicate: () => Promise<boolean>,
  options: { timeoutMs: number; intervalMs: number },
): Promise<void> {
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, options.intervalMs));
  }
  throw new Error("Timed out waiting for condition");
}

describe("durable: DurableService handleTimer audit branches", () => {
  it("uses configured claimTtlMs and records sleep_completed with attempt from execution", async () => {
    class ClaimStore extends MemoryStore {
      public lastClaimTtlMs: number | null = null;

      async claimTimer(
        timerId: string,
        workerId: string,
        ttlMs: number,
      ): Promise<boolean> {
        this.lastClaimTtlMs = ttlMs;
        return await super.claimTimer(timerId, workerId, ttlMs);
      }
    }

    const store = new ClaimStore();
    const service = new DurableService({
      store,
      audit: { enabled: true },
      polling: { interval: 1, claimTtlMs: 1234 },
    });

    await store.saveExecution({
      id: "exec-1",
      taskId: "t",
      input: undefined,
      status: "sleeping",
      attempt: 2,
      maxAttempts: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await store.createTimer({
      id: "t-claim",
      type: "sleep",
      executionId: "exec-1",
      stepId: "sleep:1",
      fireAt: new Date(0),
      status: "pending",
    });

    service.start();
    try {
      await waitUntil(
        async () => {
          const result = await store.getStepResult("exec-1", "sleep:1");
          return (
            result !== null &&
            typeof result.result === "object" &&
            result.result !== null &&
            "state" in result.result &&
            result.result.state === "completed"
          );
        },
        { timeoutMs: 2_000, intervalMs: 5 },
      );

      const audit = await store.listAuditEntries?.("exec-1");
      expect(audit).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "sleep_completed",
            executionId: "exec-1",
            attempt: 2,
            stepId: "sleep:1",
            timerId: "t-claim",
          }),
        ]),
      );
      expect(store.lastClaimTtlMs).toBe(1234);
    } finally {
      await service.stop();
    }
  });

  it("skips sleep completion when execution metadata is missing", async () => {
    const store = new MemoryStore();
    const service = new DurableService({
      store,
      audit: { enabled: true },
      polling: { interval: 1 },
    });

    await store.createTimer({
      id: "t-missing",
      type: "sleep",
      stepId: "sleep:missing",
      fireAt: new Date(0),
      status: "pending",
    });

    service.start();
    try {
      await waitUntil(
        async () =>
          (await store.getReadyTimers(new Date(0))).length === 0,
        { timeoutMs: 2_000, intervalMs: 5 },
      );

      expect(await store.getStepResult("missing-exec", "sleep:missing")).toBeNull();
    } finally {
      await service.stop();
    }
  });
  it("records sleep_completed with attempt=0 when execution metadata is missing", async () => {
    const store = new MemoryStore();
    const service = new DurableService({
      store,
      audit: { enabled: true },
      polling: { interval: 1 },
    });

    await store.createTimer({
      id: "t1",
      type: "sleep",
      executionId: "missing-exec",
      stepId: "sleep:1",
      fireAt: new Date(0),
      status: "pending",
    });

    service.start();
    try {
      await waitUntil(
        async () => {
          const result = await store.getStepResult("missing-exec", "sleep:1");
          return (
            result !== null &&
            typeof result.result === "object" &&
            result.result !== null &&
            "state" in result.result &&
            result.result.state === "completed"
          );
        },
        { timeoutMs: 2_000, intervalMs: 5 },
      );

      const audit = await store.listAuditEntries?.("missing-exec");
      expect(audit).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "sleep_completed",
            executionId: "missing-exec",
            attempt: 0,
            stepId: "sleep:1",
            timerId: "t1",
          }),
        ]),
      );
    } finally {
      await service.stop();
    }
  });

  it("records signal_timed_out for non-__signal step ids with attempt=0 when execution metadata is missing", async () => {
    const store = new MemoryStore();
    const service = new DurableService({
      store,
      audit: { enabled: true },
      polling: { interval: 1 },
    });

    await store.saveStepResult({
      executionId: "missing-exec-2",
      stepId: "sig123:wait",
      result: { state: "waiting" },
      completedAt: new Date(),
    });

    await store.createTimer({
      id: "t2",
      type: "signal_timeout",
      executionId: "missing-exec-2",
      stepId: "sig123:wait",
      fireAt: new Date(0),
      status: "pending",
    });

    service.start();
    try {
      await waitUntil(
        async () => {
          const result = await store.getStepResult("missing-exec-2", "sig123:wait");
          return (
            typeof result?.result === "object" &&
            result.result !== null &&
            "state" in result.result &&
            result.result.state === "timed_out"
          );
        },
        { timeoutMs: 2_000, intervalMs: 5 },
      );

      const audit = await store.listAuditEntries?.("missing-exec-2");
      expect(audit).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "signal_timed_out",
            executionId: "missing-exec-2",
            attempt: 0,
            stepId: "sig123:wait",
            signalId: "sig123",
            timerId: "t2",
          }),
        ]),
      );
    } finally {
      await service.stop();
    }
  });
});
