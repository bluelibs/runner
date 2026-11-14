import { r, run } from "../../../../index";
import { resources, tags } from "../../../node";
import { durableResource } from "../../../durable/core/resource";
import { MemoryStore } from "../../../durable/store/MemoryStore";

const durable = durableResource.fork("workflows");
const logs = { printThreshold: null } as const;

function deployment(
  store: MemoryStore,
  calls: string[],
  options: {
    moved?: boolean;
    key?: string;
    compensation?: boolean;
    failHook?: boolean;
    failUndo?: boolean;
    failParent?: boolean;
  } = {},
) {
  const label = options.moved ? "current" : "original";
  const event = r
    .event<{ orderId: string }>(options.moved ? "placed" : "created")
    .tags([
      tags.durableEvent.with({
        key: options.key,
        compensation: options.compensation ? "required" : undefined,
      }),
    ])
    .build();
  const owner = r
    .resource(options.moved ? "checkout" : "orders")
    .register([event])
    .build();
  const first = r
    .hook("reserve")
    .on(event)
    .order(1)
    .run(async (emission) => {
      calls.push(`${label}:reserve`);
      return { reservationId: emission.data.orderId };
    })
    .compensate(async (receipt) => {
      calls.push(`${label}:undo:${receipt.reservationId}`);
      if (options.failUndo) throw new Error("undo offline");
    })
    .build();
  const second = r
    .hook("charge")
    .on(event)
    .order(2)
    .run(async () => {
      calls.push(`${label}:charge`);
      if (options.failHook) throw new Error("payment offline");
    })
    .compensate(async () => {})
    .build();
  const parent = r
    .task("parent")
    .dependencies({ emit: event, durable })
    .run(async (_, { emit, durable }) => {
      await emit({ orderId: "order-1" });
      return durable.use().step("finish", async () => {
        if (options.failParent) throw new Error("parent interrupted");
        return "done";
      });
    })
    .build();
  const app = r
    .resource("app")
    .register([
      resources.durable,
      durable.with({ store, execution: { maxAttempts: 1 } }),
      resources.durableEventBridge,
      owner,
      first,
      second,
      parent,
    ])
    .build();
  return { app, event, parent };
}

describe("durable event persistence keys", () => {
  it.each([false, true])(
    "recovers a renamed and moved event with compensation=%s",
    async (compensation) => {
      const store = new MemoryStore();
      const calls: string[] = [];
      const original = deployment(store, calls, {
        key: "orders.placed",
        failHook: true,
        failUndo: compensation,
        compensation,
      });
      const first = await run(original.app, { logs });
      let executionId: string;
      try {
        await expect(
          first.emitEvent(
            original.event,
            { orderId: "order-1" },
            {
              idempotencyKey: "request-1",
            },
          ),
        ).rejects.toThrow(compensation ? "compensation" : "payment offline");
        const execution = (await store.listExecutions())[0];
        executionId = execution.id;
        expect(execution.input).toMatchObject({
          eventId: "app.orders.events.created",
          eventKey: "orders.placed",
        });
        if (!compensation) {
          // Model process loss after saving the first hook but before saving the outcome.
          await store.saveExecution({
            ...execution,
            status: "pending",
            completedAt: undefined,
            error: undefined,
          });
        }
      } finally {
        await first.dispose();
      }
      calls.length = 0;
      const moved = deployment(store, calls, {
        moved: true,
        key: "orders.placed",
        compensation,
      });
      const second = await run(moved.app, { logs });
      try {
        const service = second.getResourceValue(durable);
        if (compensation) await service.operator.retryRollback(executionId!);
        await service.recover();
        if (compensation) {
          await expect(service.wait(executionId!)).rejects.toThrow(
            "payment offline",
          );
          expect(calls).toEqual(["current:undo:order-1"]);
        } else {
          await expect(service.wait(executionId!)).resolves.toMatchObject({
            succeededListeners: 2,
          });
          expect(calls).toEqual(["current:charge"]);
          await second.emitEvent(
            moved.event,
            { orderId: "order-1" },
            {
              idempotencyKey: "request-1",
            },
          );
          expect(await store.listExecutions()).toHaveLength(1);
          expect(calls).toEqual(["current:charge"]);
        }
      } finally {
        await second.dispose();
      }
    },
  );

  it("reuses a parent's child after the event moves without an explicit emission step id", async () => {
    const store = new MemoryStore();
    const calls: string[] = [];
    const original = deployment(store, calls, {
      key: "orders.placed",
      failParent: true,
    });
    const first = await run(original.app, { logs });
    let parentId: string;
    try {
      await expect(
        first.getResourceValue(durable).startAndWait(original.parent),
      ).rejects.toThrow("parent interrupted");
      const parent = (await store.listExecutions()).find(
        (execution) => execution.parentExecutionId === undefined,
      )!;
      parentId = parent.id;
      await store.saveExecution({
        ...parent,
        status: "pending",
        completedAt: undefined,
        error: undefined,
      });
    } finally {
      await first.dispose();
    }
    calls.length = 0;
    const moved = deployment(store, calls, {
      key: "orders.placed",
      moved: true,
    });
    const second = await run(moved.app, { logs });
    try {
      const service = second.getResourceValue(durable);
      await service.recover();
      await expect(service.wait(parentId!)).resolves.toBe("done");
      const children = (await store.listExecutions()).filter(
        (execution) => execution.parentExecutionId === parentId!,
      );
      expect(children).toHaveLength(1);
      expect(calls).toEqual([]);
    } finally {
      await second.dispose();
    }
  });

  it("keeps canonical-id recovery for executions admitted without a key", async () => {
    const store = new MemoryStore();
    const calls: string[] = [];
    const original = deployment(store, calls, { failHook: true });
    const first = await run(original.app, { logs });
    let executionId: string;
    try {
      await expect(
        first.emitEvent(original.event, { orderId: "order-1" }),
      ).rejects.toThrow();
      const execution = (await store.listExecutions())[0];
      executionId = execution.id;
      expect(execution.input).not.toHaveProperty(
        "eventKey",
        expect.any(String),
      );
      await store.saveExecution({
        ...execution,
        status: "pending",
        completedAt: undefined,
      });
    } finally {
      await first.dispose();
    }
    const updated = deployment(store, calls, { key: "orders.placed" });
    const second = await run(updated.app, { logs });
    try {
      const service = second.getResourceValue(durable);
      await service.recover();
      await expect(service.wait(executionId!)).resolves.toMatchObject({
        succeededListeners: 2,
      });
      expect(calls).toEqual([
        "original:reserve",
        "original:charge",
        "original:charge",
      ]);
    } finally {
      await second.dispose();
    }
  });
});
