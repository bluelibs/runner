import { WaitManager } from "../../../../durable/core/managers/WaitManager";
import { MemoryEventBus } from "../../../../durable/bus/MemoryEventBus";
import { ExecutionStatus } from "../../../../durable/core/types";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { genericError } from "../../../../../errors";
import { lifecycleExecution } from "../../helpers/lifecycle.test.helpers";

const workflowKey = "chain-task";

async function continueRootAndFinishTip(
  store: MemoryStore,
  bus: MemoryEventBus,
): Promise<void> {
  await store.saveExecution(
    lifecycleExecution({
      id: "root",
      workflowKey,
      status: ExecutionStatus.ContinuedAsNew,
      continuedAsExecutionId: "tip",
    }),
  );
  await store.saveExecution(
    lifecycleExecution({
      id: "tip",
      workflowKey,
      status: ExecutionStatus.Running,
    }),
  );
  await publishFinished(bus, "root");
  await store.saveExecution(
    lifecycleExecution({
      id: "tip",
      workflowKey,
      status: ExecutionStatus.Completed,
      result: "tip-done",
    }),
  );
  await publishFinished(bus, "tip");
}

async function publishFinished(bus: MemoryEventBus, executionId: string) {
  await bus.publish(`execution:${executionId}`, {
    type: "finished",
    payload: { executionId },
    timestamp: new Date(),
  });
}

async function seedRunningRoot(): Promise<MemoryStore> {
  const store = new MemoryStore();
  await store.saveExecution(
    lifecycleExecution({
      id: "root",
      workflowKey,
      status: ExecutionStatus.Running,
    }),
  );
  return store;
}

describe("durable: WaitManager follows continuations on the bus", () => {
  it("resolves from the tip's finished notification without polling", async () => {
    const store = await seedRunningRoot();
    const bus = new MemoryEventBus();
    const wait = new WaitManager(store, bus).waitForResult("root", {
      waitPollIntervalMs: 60_000,
    });
    await new Promise((resolve) => setImmediate(resolve));

    await continueRootAndFinishTip(store, bus);

    await expect(wait).resolves.toBe("tip-done");
  });

  it("falls back to polling when subscribing to the tip fails", async () => {
    const store = await seedRunningRoot();
    const bus = new MemoryEventBus();
    const subscribe = bus.subscribe.bind(bus);
    bus.subscribe = async (channel, handler) =>
      channel === "execution:tip"
        ? genericError.throw({ message: "bus-down" })
        : subscribe(channel, handler);
    const wait = new WaitManager(store, bus).waitForResult("root", {
      waitPollIntervalMs: 5,
    });
    await new Promise((resolve) => setImmediate(resolve));

    await continueRootAndFinishTip(store, bus);

    await expect(wait).resolves.toBe("tip-done");
  });
});
