import { r, resources, tags } from "../../../..";
import { createDurableTestRuntime } from "../../../../durable/test-runtime";

describe("workflow replay, virtual timers and checkpoint branches", () => {
  it("restarts, advances time, validates replay, and branches without repeating the prefix", async () => {
    const test = createDurableTestRuntime();
    const durable = test.durable;
    let prepared = 0;
    let charged = 0;
    const workflow = r
      .task("checkout")
      .dependencies({ durable })
      .tags([tags.durableWorkflow])
      .run(async (_: undefined, { durable }) => {
        const d = durable.use();
        await d.step("prepare", async () => ++prepared);
        await d.replaceState({ count: 7 }, { stepId: "initial" });
        await d.sleep(3600000, { stepId: "wait" });
        return d.step("charge", async () => ++charged);
      })
      .build();
    const changed = r
      .task("changed")
      .dependencies({ durable })
      .run(async (_: undefined, { durable }) => {
        await durable.use().step("renamed", async () => ++prepared);
        return 1;
      })
      .build();
    const app = r
      .resource("app")
      .register([
        resources.durable,
        workflow,
        changed,
        test.durableRegistration,
      ])
      .build();
    await test.run(app, { logs: { printThreshold: null } });
    try {
      const id = await test.backend.start(workflow);
      await test.restartWorker();
      await test.advanceTimeBy(3600000);
      expect(await test.backend.wait(id)).toBe(1);
      const fixture = await test.backend.operator.exportReplay(id);
      expect(await test.replay(workflow, fixture)).toMatchObject({
        compatible: true,
        issues: [],
      });
      expect(await test.replay(changed, fixture)).toMatchObject({
        compatible: false,
      });
      expect(prepared).toBe(1);
      expect(charged).toBe(1);
      const branch = await test.backend.operator.reset(id, {
        beforeStep: "charge",
        reason: "Retry with corrected payment provider",
        idempotencyKey: "reset-one",
      });
      expect(await test.backend.wait(branch)).toBe(2);
      expect(await test.backend.getState(branch)).toEqual({ count: 7 });
      expect(
        await test.backend.operator.reset(id, {
          beforeStep: "charge",
          reason: "Same request",
          idempotencyKey: "reset-one",
        }),
      ).toBe(branch);
      expect(prepared).toBe(1);
      expect((await test.store.getExecution(id))?.result).toBe(1);
      expect(
        (await test.store.getExecution(branch))?.resetFromExecutionId,
      ).toBe(id);
    } finally {
      await test.dispose();
    }
  });

  it("advances signal timeouts without changing real process time", async () => {
    const test = createDurableTestRuntime();
    const durable = test.durable;
    const signal = r.event<void>("answer").build();
    const workflow = r
      .task("timeout")
      .dependencies({ durable })
      .tags([tags.durableWorkflow.with({ signals: [signal] })])
      .run(async (_: undefined, { durable }) =>
        durable.use().waitForSignal(signal, { timeoutMs: 60000 }),
      )
      .build();
    await test.run(
      r
        .resource("app")
        .register([
          resources.durable,
          signal,
          workflow,
          test.durableRegistration,
        ])
        .build(),
      { logs: { printThreshold: null } },
    );
    try {
      const before = Date.now();
      const id = await test.backend.start(workflow);
      await test.advanceTimeBy(59999);
      expect((await test.store.getExecution(id))?.status).toBe("sleeping");
      await test.advanceTimeBy(1);
      expect(await test.backend.wait(id)).toEqual({ kind: "timeout" });
      expect(Date.now() - before).toBeLessThan(5000);
      expect(test.now.getTime()).toBe(60000);
    } finally {
      await test.dispose();
    }
  });
});
