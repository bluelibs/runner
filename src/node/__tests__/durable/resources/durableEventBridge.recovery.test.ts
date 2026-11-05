import { r, run } from "../../../../index";
import { resources, tags } from "../../../node";
import { durableResource } from "../../../durable/core/resource";
import { MemoryStore } from "../../../durable/store/MemoryStore";

const logs = { printThreshold: null } as const;

describe("durable event recovery", () => {
  it("resumes failed compensation without rerunning forward work or completed undos", async () => {
    const store = new MemoryStore();
    const durable = durableResource.fork("workflows");
    const event = r
      .event("created")
      .tags([tags.durableEvent.with({ compensation: "required" })])
      .build();
    const calls: string[] = [];
    let failUndo = true;
    const first = r
      .hook("first")
      .on(event)
      .order(1)
      .run(async () => {
        calls.push("up1");
        return 1;
      })
      .compensate(async () => {
        calls.push("down1");
      })
      .build();
    const second = r
      .hook("second")
      .on(event)
      .order(2)
      .run(async () => {
        calls.push("up2");
        return 2;
      })
      .compensate(async () => {
        calls.push("down2");
        if (failUndo) throw new Error("refund offline");
      })
      .build();
    const fail = r
      .hook("fail")
      .on(event)
      .order(3)
      .run(async () => {
        calls.push("fail");
        throw new Error("declined");
      })
      .compensate(async () => {})
      .build();
    const app = r
      .resource("app")
      .register([
        resources.durable,
        durable.with({ store, execution: { maxAttempts: 1 } }),
        resources.durableEventBridge,
        event,
        first,
        second,
        fail,
      ])
      .build();
    const runtime = await run(app, { logs });
    try {
      await expect(runtime.emitEvent(event)).rejects.toThrow("compensation");
      const execution = (await store.listExecutions())[0];
      expect(execution.status).toBe("compensation_failed");
      expect(calls).toEqual(["up1", "up2", "fail", "down2", "down1"]);
      failUndo = false;
      const d = runtime.getResourceValue(durable);
      await d.operator.retryRollback(execution.id);
      await d.recover();
      expect((await store.getExecution(execution.id))!.status).toBe("failed");
      expect(calls).toEqual(["up1", "up2", "fail", "down2", "down1", "down2"]);
    } finally {
      await runtime.dispose();
    }
  });

  it("replays completed hooks while retrying a failed hook", async () => {
    const store = new MemoryStore();
    const durable = durableResource.fork("workflows");
    const event = r.event("created").tags([tags.durableEvent]).build();
    let firstCalls = 0;
    let secondCalls = 0;
    const first = r
      .hook("first")
      .on(event)
      .order(1)
      .run(async () => {
        firstCalls++;
        return "receipt";
      })
      .build();
    const second = r
      .hook("second")
      .on(event)
      .order(2)
      .run(async () => {
        if (++secondCalls === 1) throw new Error("transient");
      })
      .build();
    const runtime = await run(
      r
        .resource("app")
        .register([
          resources.durable,
          durable.with({ store, polling: { interval: 5 } }),
          resources.durableEventBridge,
          event,
          first,
          second,
        ])
        .build(),
      { logs },
    );
    try {
      await runtime.emitEvent(event);
      expect(firstCalls).toBe(1);
      expect(secondCalls).toBe(2);
    } finally {
      await runtime.dispose();
    }
  });

  it("dispatches through a queue consumer and collects successful event history", async () => {
    const durable = resources.memoryWorkflow.fork("workflows");
    const event = r
      .event("created")
      .tags([tags.durableEvent.with({ retention: { onComplete: "delete" } })])
      .build();
    let calls = 0;
    const hook = r
      .hook("effect")
      .on(event)
      .run(async () => {
        calls++;
      })
      .build();
    const runtime = await run(
      r
        .resource("app")
        .register([
          resources.durable,
          durable.with({
            queue: { consume: true },
            garbageCollection: { intervalMs: 5 },
          }),
          resources.durableEventBridge,
          event,
          hook,
        ])
        .build(),
      { logs },
    );
    try {
      await runtime.emitEvent(event);
      const store = runtime.getResourceValue(durable).getStore();
      const execution = (await store.listExecutions!())[0];
      await store.collectCompletedHistory!(new Date(), 100);
      expect(calls).toBe(1);
      expect(await store.listStepResults(execution.id)).toEqual([]);
      await expect(
        runtime.getResourceValue(durable).wait(execution.id),
      ).resolves.toMatchObject({ succeededListeners: 1 });
    } finally {
      await runtime.dispose();
    }
  });
  it("wakes a suspended queued parent when child compensation fails", async () => {
    const durable = resources.memoryWorkflow.fork("workflows");
    const event = r
      .event("created")
      .tags([tags.durableEvent.with({ compensation: "required" })])
      .build();
    const first = r
      .hook("first")
      .on(event)
      .order(1)
      .run(async () => 1)
      .compensate(async () => {
        throw new Error("undo offline");
      })
      .build();
    const second = r
      .hook("second")
      .on(event)
      .order(2)
      .run(async () => {
        throw new Error("declined");
      })
      .compensate(async () => {})
      .build();
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
            queue: { consume: true },
            execution: { maxAttempts: 1 },
          }),
          resources.durableEventBridge,
          event,
          first,
          second,
          parent,
        ])
        .build(),
      { logs },
    );
    try {
      await expect(
        runtime.getResourceValue(durable).startAndWait(parent, undefined, {
          waitTimeout: 3000,
          waitPollIntervalMs: 5,
        }),
      ).rejects.toThrow("undo offline");
    } finally {
      await runtime.dispose();
    }
  });

  it("treats a similarly worded business error as failure rather than parking forever", async () => {
    const durable = resources.memoryWorkflow.fork("workflows");
    const task = r
      .task("fails")
      .run(async () => {
        throw new Error("Compensation failed externally");
      })
      .build();
    const runtime = await run(
      r
        .resource("app")
        .register([
          resources.durable,
          durable.with({ execution: { maxAttempts: 1 } }),
          task,
        ])
        .build(),
      { logs },
    );
    try {
      await expect(
        runtime
          .getResourceValue(durable)
          .startAndWait(task, undefined, { waitTimeout: 1000 }),
      ).rejects.toThrow("Compensation failed externally");
    } finally {
      await runtime.dispose();
    }
  });
});
