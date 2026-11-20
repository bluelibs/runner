import { r, resources, tags } from "../../../..";
import { createDurableTestRuntime } from "../../../../durable/test-runtime";
import { waitUntil } from "../../../../durable/test-utils";

describe("workflow replay, virtual timers and checkpoint branches", () => {
  it("preserves both parallel waits for the same signal in replay and reset", async () => {
    const test = createDurableTestRuntime();
    const durable = test.durable;
    const go = r.event<void>("go").build();
    const item = r.event<string>("item").build();
    const workflow = r
      .task("parallel")
      .dependencies({ durable })
      .tags([tags.durableWorkflow.with({ signals: [go, item] })])
      .run(async (_: undefined, { durable }) => {
        const d = durable.use();
        await d.waitForSignal(go, { stepId: "go" });
        const items = await Promise.all([
          d.waitForSignal(item),
          d.waitForSignal(item),
        ]);
        return d.step("finish", async () =>
          items
            .flatMap((result) =>
              result.kind === "signal" ? [result.payload] : [],
            )
            .sort(),
        );
      })
      .build();
    await test.run(
      r
        .resource("app")
        .register([
          resources.durable,
          test.durableRegistration,
          go,
          item,
          workflow,
        ])
        .build(),
      { logs: { printThreshold: null } },
    );
    try {
      const id = await test.backend.start(workflow);
      const signal = async (value: string) => {
        await test.backend.signal(id, item, value);
        await waitUntil(
          () => test.store.hasExecutionLease(id).then((leased) => !leased),
          { timeoutMs: 1000, intervalMs: 1 },
        );
      };
      await signal("one");
      await signal("two");
      await test.backend.signal(id, go, undefined);
      expect(await test.backend.wait(id)).toEqual(["one", "two"]);
      await waitUntil(
        () => test.store.hasExecutionLease(id).then((leased) => !leased),
        { timeoutMs: 1000, intervalMs: 1 },
      );
      const fixture = await test.backend.operator.exportReplay(id);
      expect(fixture.history.map(({ stepId }) => stepId)).toEqual([
        "__origin",
        "__signal:go",
        "__signal:item",
        "__signal:item:1",
        "finish",
      ]);
      expect(await test.replay(workflow, fixture)).toMatchObject({
        compatible: true,
      });
      const branch = await test.backend.operator.reset(id, {
        beforeStep: "finish",
        reason: "Rerun the final step",
      });
      expect(await test.backend.wait(branch, { timeout: 1000 })).toEqual([
        "one",
        "two",
      ]);
    } finally {
      await test.dispose();
    }
  });

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

  it("checks the pinned version on child starts and waits during replay", async () => {
    const test = createDurableTestRuntime();
    const durable = test.durable;
    const child = (id: string, version: number) =>
      r
        .task(id)
        .tags([tags.durableWorkflow.with({ key: "child", version })])
        .run(async (_: undefined) => version)
        .build();
    const v1 = child("child-one", 1);
    const v2 = child("child-two", 2);
    const parent = (id: string, start: typeof v1, wait: typeof v1) =>
      r
        .task(id)
        .dependencies({ durable })
        .tags([tags.durableWorkflow])
        .run(async (_: undefined, { durable }) => {
          const d = durable.use();
          const childId = await d.workflow("start-child", start);
          return d.waitForExecution(wait, childId, { stepId: "wait-child" });
        })
        .build();
    const source = parent("source", v1, v1);
    const changedStart = parent("changed-start", v2, v1);
    const changedWait = parent("changed-wait", v1, v2);
    await test.run(
      r
        .resource("app")
        .register([
          resources.durable,
          test.durableRegistration,
          v1,
          v2,
          source,
          changedStart,
          changedWait,
        ])
        .build(),
      { logs: { printThreshold: null } },
    );
    try {
      const id = await test.backend.start(source);
      expect(await test.backend.wait(id)).toBe(1);
      await waitUntil(
        () => test.store.hasExecutionLease(id).then((leased) => !leased),
        { timeoutMs: 1000, intervalMs: 1 },
      );
      const fixture = await test.backend.operator.exportReplay(id);
      expect(
        fixture.history.filter(({ taskKey }) => taskKey === "child"),
      ).toEqual([
        expect.objectContaining({ stepId: "start-child", workflowVersion: 1 }),
        expect.objectContaining({
          stepId: "__execution:wait-child",
          workflowVersion: 1,
        }),
      ]);
      expect(await test.replay(source, fixture)).toMatchObject({
        compatible: true,
      });
      for (const [candidate, stepId] of [
        [changedStart, "start-child"],
        [changedWait, "__execution:wait-child"],
      ] as const) {
        expect(await test.replay(candidate, fixture)).toMatchObject({
          compatible: false,
          issues: expect.arrayContaining([
            `Workflow version for '${stepId}' changed from 1 to 2.`,
          ]),
        });
      }
    } finally {
      await test.dispose();
    }
  });
});
