import { r, run } from "../../../../index";
import { resources, tags } from "../../../node";
import { durableResource } from "../../../durable/core/resource";
import { MemoryStore } from "../../../durable/store/MemoryStore";

const logs = { printThreshold: null } as const;

describe("durable event bridge", () => {
  it("checkpoints ordered hooks through normal emission and generates fresh execution identities", async () => {
    const store = new MemoryStore();
    const durable = durableResource.fork("workflows");
    const event = r
      .event<{ value: number }>("created")
      .tags([tags.durableEvent])
      .build();
    const calls: string[] = [];
    const hook = r
      .hook("first")
      .on(event)
      .run(async (event) => {
        calls.push(event.durable!.stepKey);
        return event.data.value;
      })
      .build();
    const runtime = await run(
      r
        .resource("app")
        .register([
          resources.durable,
          durable.with({ store }),
          resources.durableEventBridge,
          event,
          hook,
        ])
        .build(),
      { logs },
    );
    try {
      await runtime.emitEvent(event, { value: 1 });
      await runtime.emitEvent(event, { value: 1 });
      expect(calls).toHaveLength(2);
      expect(calls[0]).not.toBe(calls[1]);
      const executions = await store.listExecutions();
      expect(executions).toHaveLength(2);
      expect(
        executions.every((execution) => execution.status === "completed"),
      ).toBe(true);
      expect(await store.listStepResults(executions[0].id)).toHaveLength(1);
    } finally {
      await runtime.dispose();
    }
  });

  it("links emissions to the current workflow and reuses the child on parent replay", async () => {
    const store = new MemoryStore();
    const durable = durableResource.fork("workflows");
    const event = r.event("created").tags([tags.durableEvent]).build();
    let calls = 0;
    const hook = r
      .hook("effect")
      .on(event)
      .run(async () => {
        calls++;
      })
      .build();
    const parent = r
      .task("parent")
      .dependencies({ durable, emit: event })
      .run(async (_, { durable, emit }) => {
        await emit();
        await durable.use().sleep(1, { stepId: "park" });
        return "done";
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
          hook,
          parent,
        ])
        .build(),
      { logs },
    );
    try {
      const result = await runtime
        .getResourceValue(durable)
        .startAndWait(parent, undefined, { waitTimeout: 3000 });
      const executions = await store.listExecutions();
      const children = executions.filter(
        (execution) =>
          execution.parentExecutionId === result.durable.executionId,
      );
      expect(children).toHaveLength(1);
      expect(calls).toBe(1);
    } finally {
      await runtime.dispose();
    }
  });

  it("compensates successful hooks in reverse order and preserves the business failure", async () => {
    const store = new MemoryStore();
    const durable = durableResource.fork("workflows");
    const event = r
      .event("created")
      .tags([tags.durableEvent.with({ compensation: "required" })])
      .build();
    const calls: string[] = [];
    const first = r
      .hook("first")
      .on(event)
      .order(1)
      .run(async () => {
        calls.push("up1");
        return 1;
      })
      .compensate(async (receipt) => {
        calls.push(`down${receipt}`);
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
      .compensate(async (receipt) => {
        calls.push(`down${receipt}`);
      })
      .build();
    const fail = r
      .hook("fail")
      .on(event)
      .order(3)
      .run(async () => {
        throw new Error("declined");
      })
      .compensate(async () => {})
      .build();
    const runtime = await run(
      r
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
        .build(),
      { logs },
    );
    try {
      await expect(runtime.emitEvent(event)).rejects.toThrow("declined");
      expect(calls).toEqual(["up1", "up2", "down2", "down1"]);
    } finally {
      await runtime.dispose();
    }
  });

  it("selects all application events and permits an explicit opt-out", async () => {
    const store = new MemoryStore();
    const durable = durableResource.fork("workflows");
    const selected = r.event("selected").build();
    const skipped = r
      .event("skipped")
      .tags([tags.durableEvent.with({ enabled: false })])
      .build();
    const runtime = await run(
      r
        .resource("app")
        .register([
          resources.durable,
          durable.with({ store }),
          resources.durableEventBridge.with({ applyTo: "all" }),
          selected,
          skipped,
        ])
        .build(),
      { logs },
    );
    try {
      await runtime.emitEvent(selected);
      await runtime.emitEvent(skipped);
      expect(await store.listExecutions()).toHaveLength(1);
    } finally {
      await runtime.dispose();
    }
  });

  it("rejects ambiguous resources before emitting any effects", async () => {
    const one = durableResource.fork("one");
    const two = durableResource.fork("two");
    const event = r.event("created").tags([tags.durableEvent]).build();
    await expect(
      run(
        r
          .resource("app")
          .register([
            resources.durable,
            one.with({ store: new MemoryStore() }),
            two.with({ store: new MemoryStore() }),
            resources.durableEventBridge,
            event,
          ])
          .build(),
        { logs },
      ),
    ).rejects.toThrow("one visible runtime");
  });
});
