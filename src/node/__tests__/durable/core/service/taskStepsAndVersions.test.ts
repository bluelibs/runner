import { DurableService } from "../../../../durable/core/DurableService";
import { r, resources, run, tags } from "../../../..";
import { durableResource } from "../../../../durable/core/resource";
import { MemoryStore } from "../../../../durable/store/MemoryStore";

describe("Runner task steps and explicit workflow versions", () => {
  it("runs typed task steps through DI and preserves their checkpoint", async () => {
    const durable = durableResource.fork("task-step");
    const store = new MemoryStore();
    const dependency = r
      .resource("multiplier")
      .init(async () => 3)
      .build();
    let calls = 0;
    let key = "";
    const charge = r
      .task("charge")
      .dependencies({ durable, dependency })
      .run(async (input: { amount: number }, { durable, dependency }) => {
        calls++;
        const step = durable.useStep();
        key = step.idempotencyKey;
        await step.heartbeat({ accepted: true });
        return input.amount * dependency;
      })
      .build();
    const workflow = r
      .task("checkout")
      .dependencies({ durable })
      .tags([tags.durableWorkflow])
      .run(async (_input: undefined, { durable }) => {
        const d = durable.use();
        const result = await d.step("charge", charge, { amount: 4 });
        await d.sleep(1, { stepId: "sleep" });
        return result;
      })
      .build();
    const app = r
      .resource("app")
      .register([
        resources.durable,
        dependency,
        charge,
        workflow,
        durable.with({ store, timers: { enabled: false } }),
      ])
      .build();
    const runtime = await run(app, { logs: { printThreshold: null } });
    try {
      const backend = runtime.getResourceValue(durable);
      const id = await backend.start(workflow);
      const [timer] = await store.getReadyTimers(new Date(Date.now() + 100));
      if (!(backend.service instanceof DurableService))
        throw new Error("Unexpected service");
      await backend.service.handleTimer(timer);
      expect(await backend.wait(id)).toBe(12);
      expect(calls).toBe(1);
      expect(key).toContain(id);
      expect(() => backend.useStep()).toThrow("active step");
      const history = await store.listExecutionHistory(id);
      expect(history.map((entry) => entry.kind)).toEqual([
        "origin",
        "step",
        "sleep",
      ]);
    } finally {
      await runtime.dispose();
    }
  });

  it("resolves two registered implementations by the version saved at admission", async () => {
    const durable = durableResource.fork("versioned");
    const store = new MemoryStore();
    const v1 = r
      .task("checkout-one")
      .tags([tags.durableWorkflow.with({ key: "checkout", version: 1 })])
      .dependencies({ durable })
      .run(async (_input: undefined, { durable }) => {
        await durable.use().sleep(1, { stepId: "sleep" });
        return "one";
      })
      .build();
    const v2 = r
      .task("checkout-two")
      .tags([tags.durableWorkflow.with({ key: "checkout", version: 2 })])
      .run(async () => "two")
      .build();
    const app = r
      .resource("app")
      .register([
        resources.durable,
        v1,
        v2,
        durable.with({ store, timers: { enabled: false } }),
      ])
      .build();
    const runtime = await run(app, { logs: { printThreshold: null } });
    try {
      const backend = runtime.getResourceValue(durable);
      const first = await backend.start(v1);
      const second = await backend.start(v2);
      expect(await backend.wait(second)).toBe("two");
      expect((await store.getExecution(first))?.workflowVersion).toBe(1);
      const [timer] = await store.getReadyTimers(new Date(Date.now() + 100));
      if (!(backend.service instanceof DurableService))
        throw new Error("Unexpected service");
      await backend.service.handleTimer(timer);
      expect(await backend.wait(first)).toBe("one");
    } finally {
      await runtime.dispose();
    }
  });
});
