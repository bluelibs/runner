import { r, resources, run, tags } from "../../../..";
import { durableResource } from "../../../../durable/core/resource";
import { MemoryEventBus } from "../../../../durable/bus/MemoryEventBus";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { waitUntil } from "../../../../durable/test-utils";

describe("durable: workflow admission integration", () => {
  it("enforces numeric concurrency across executions of one workflow", async () => {
    const store = new MemoryStore();
    const durable = durableResource.fork("workflow-admission");
    const registration = durable.with({
      store,
      eventBus: new MemoryEventBus(),
      polling: { interval: 5 },
    });

    const releases = new Map<number, () => void>();
    const started: number[] = [];
    const task = r
      .task("serial-workflow")
      .tags([
        tags.durableWorkflow.with({
          key: "orders.serial",
          concurrency: 1,
        }),
      ])
      .run(async (input: { id: number }) => {
        started.push(input.id);
        await new Promise<void>((resolve) => releases.set(input.id, resolve));
        return input.id;
      })
      .build();

    const app = r
      .resource("app")
      .register([resources.durable, registration, task])
      .build();
    const runtime = await run(app, { logs: { printThreshold: null } });
    const service = runtime.getResourceValue(durable);

    const firstStart = service.start(task, { id: 1 });
    await waitUntil(() => started.length === 1, {
      timeoutMs: 1_000,
      intervalMs: 5,
    });

    const secondExecutionId = await service.start(task, { id: 2 });
    expect(started).toEqual([1]);
    await expect(store.getExecution(secondExecutionId)).resolves.toEqual(
      expect.objectContaining({ status: "pending" }),
    );

    releases.get(1)?.();
    await firstStart;
    await waitUntil(() => started.length === 2, {
      timeoutMs: 2_000,
      intervalMs: 5,
    });
    releases.get(2)?.();

    await expect(
      service.wait<number>(secondExecutionId, {
        timeout: 2_000,
        waitPollIntervalMs: 5,
      }),
    ).resolves.toBe(2);

    await runtime.dispose();
  });
});
