import { r, run } from "../../../../index";
import { resources, tags } from "../../../node";
import { durableResource } from "../../../durable/core/resource";
import { MemoryStore } from "../../../durable/store/MemoryStore";

const logs = { printThreshold: null } as const;

describe("durable event identity", () => {
  it.each([undefined, "child"])(
    "links and deduplicates cross-backend children with idempotency key %s",
    async (idempotencyKey) => {
      const parentStore = new MemoryStore();
      const childStore = new MemoryStore();
      const parents = durableResource.fork("parents");
      const children = durableResource.fork("children");
      const event = r
        .event("created")
        .tags([tags.durableEvent.with({ durable: children })])
        .build();
      const parent = r
        .task("parent")
        .dependencies({ emit: event, parents })
        .run(async (_, { emit, parents }) => {
          await emit(undefined, { stepId: "create", idempotencyKey });
          await parents.use().sleep(1, { stepId: "replay" });
          return "done";
        })
        .build();
      const runtime = await run(
        r
          .resource("app")
          .register([
            resources.durable,
            parents.with({ store: parentStore, polling: { interval: 5 } }),
            children.with({ store: childStore }),
            resources.durableEventBridge,
            event,
            parent,
          ])
          .build(),
        { logs },
      );
      try {
        const result = await runtime
          .getResourceValue(parents)
          .startAndWait(parent);
        expect(await childStore.listExecutions()).toHaveLength(1);
        expect((await childStore.listExecutions())[0].parentExecutionId).toBe(
          result.durable.executionId,
        );
      } finally {
        await runtime.dispose();
      }
    },
  );

  it("honors explicit emission deduplication without requiring a key", async () => {
    const store = new MemoryStore();
    const durable = durableResource.fork("workflows");
    const event = r.event("created").tags([tags.durableEvent]).build();
    const runtime = await run(
      r
        .resource("app")
        .register([
          resources.durable,
          durable.with({ store }),
          resources.durableEventBridge,
          event,
        ])
        .build(),
      { logs },
    );
    try {
      await runtime.emitEvent(event, undefined, {
        idempotencyKey: "external-retry",
      });
      await runtime.emitEvent(event, undefined, {
        idempotencyKey: "external-retry",
      });
      expect(await store.listExecutions()).toHaveLength(1);
    } finally {
      await runtime.dispose();
    }
  });

  it("enforces the parent's implicit step-id policy", async () => {
    const durable = durableResource.fork("workflows");
    const event = r.event("created").tags([tags.durableEvent]).build();
    const parent = r
      .task("parent")
      .dependencies({ emit: event })
      .run(async (_, { emit }) => {
        await emit();
        return "done";
      })
      .build();
    const runtime = await run(
      r
        .resource("app")
        .register([
          resources.durable,
          durable.with({
            store: new MemoryStore(),
            determinism: { implicitInternalStepIds: "error" },
            execution: { maxAttempts: 1 },
          }),
          resources.durableEventBridge,
          event,
          parent,
        ])
        .build(),
      { logs },
    );
    try {
      await expect(
        runtime.getResourceValue(durable).startAndWait(parent),
      ).rejects.toThrow("implicit step id");
    } finally {
      await runtime.dispose();
    }
  });
});
