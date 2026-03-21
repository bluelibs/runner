import { DurableService } from "../../durable/core/DurableService";
import { createSignalWaiterSortKey } from "../../durable/core/signalWaiters";
import { MemoryStore } from "../../durable/store/MemoryStore";
import { genericError } from "../../../errors";
import { Paid } from "./DurableService.signal.test.helpers";
import { sleepingExecution } from "./DurableService.unit.helpers";

describe("durable: SignalHandler error paths", () => {
  it("rethrows non-validation signal delivery failures", async () => {
    class ThrowingStore extends MemoryStore {
      override async saveStepResult(): Promise<void> {
        throw genericError.new({ message: "step-write-failed" });
      }
    }

    const store = new ThrowingStore();
    const service = new DurableService({ store, tasks: [] });

    await store.saveExecution(sleepingExecution());
    await MemoryStore.prototype.saveStepResult.call(store, {
      executionId: "e1",
      stepId: "__signal:paid",
      result: { state: "waiting" },
      completedAt: new Date(),
    });
    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid"),
    });

    await expect(service.signal("e1", Paid, { paidAt: 1 })).rejects.toThrow(
      "step-write-failed",
    );
  });
});
