import { DurableService } from "../../durable/core/DurableService";
import { MemoryStore } from "../../durable/store/MemoryStore";
import { signalSetup, Paid, X } from "./DurableService.signal.test.helpers";
import { SpyQueue, sleepingExecution } from "./DurableService.unit.helpers";

describe("durable: DurableService - signals audit", () => {
  it("signal records audit entries when audit is enabled", async () => {
    const { base, service } = await signalSetup({
      queue: false,
      audit: true,
    });

    await service.signal("e1", Paid, { paidAt: 1 });

    await expect(base.getSignalState("e1", "paid")).resolves.toEqual({
      executionId: "e1",
      signalId: "paid",
      queued: [
        expect.objectContaining({
          payload: { paidAt: 1 },
          serializedPayload: JSON.stringify({ paidAt: 1 }),
        }),
      ],
      history: [expect.objectContaining({ payload: { paidAt: 1 } })],
    });
    const entries = await base.listAuditEntries("e1");
    expect(entries.some((entry) => entry.kind === "signal_delivered")).toBe(
      true,
    );
  });

  it("signal does not audit missing executions", async () => {
    const { base, service } = await signalSetup({
      queue: false,
      audit: true,
      seedExecution: false,
    });

    await service.signal("missing", X, { ok: true });

    const entries = await base.listAuditEntries("missing");
    expect(entries).toEqual([]);
  });

  it("signal audits delivered payloads with attempt=0 when execution disappears after delivery", async () => {
    class DisappearingExecutionStore extends MemoryStore {
      private reads = 0;

      override async getExecution(executionId: string) {
        this.reads += 1;
        if (this.reads === 1) {
          return await super.getExecution(executionId);
        }
        return null;
      }
    }

    const store = new DisappearingExecutionStore();
    const queue = new SpyQueue();
    const service = new DurableService({
      store,
      queue,
      tasks: [],
      audit: { enabled: true },
    });

    await store.saveExecution(sleepingExecution());
    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: { state: "waiting" },
      completedAt: new Date(),
    });

    await service.signal("e1", Paid, { paidAt: 1 });

    const entries = await store.listAuditEntries("e1");
    expect(entries[0]?.attempt).toBe(0);
    expect(queue.enqueued).toEqual([]);
  });
});
