import { r, resources, tags } from "../../../..";
import { createDurableTestRuntime } from "../../../../durable/test-runtime";

describe("tracked workflow commands", () => {
  it("serializes normal tasks, commits state and result, and deduplicates requests", async () => {
    const test = createDurableTestRuntime();
    const durable = test.durable;
    const signal = r.event<void>("finish").build();
    let calls = 0;
    const increment = r
      .task("increment")
      .dependencies({ durable })
      .run(async (amount: number, { durable }) => {
        calls++;
        const d = durable.use();
        const state = await d.getState<{ count: number }>();
        await d.step("effect", async (step) => {
          await step.heartbeat({ accepted: true });
          return true;
        });
        await d.setState({ count: state!.count + amount });
        return state!.count + amount;
      })
      .build();
    const fail = r
      .task("fail")
      .dependencies({ durable })
      .run(async (_: undefined, { durable }) => {
        await durable.use().setState({ count: -1 });
        throw new Error("Rejected change");
      })
      .build();
    const workflow = r
      .task("counter")
      .dependencies({ durable })
      .tags([
        tags.durableWorkflow.with({
          commands: [increment, fail],
          signals: [signal],
        }),
      ])
      .run(async (_: undefined, { durable }) => {
        const d = durable.use();
        await d.replaceState({ count: 0 });
        await d.waitForSignal(signal);
        return (await d.getState<{ count: number }>({ stepId: "final" }))!
          .count;
      })
      .build();
    const app = r
      .resource("app")
      .register([
        resources.durable,
        signal,
        increment,
        fail,
        workflow,
        test.durableRegistration,
      ])
      .build();
    await test.run(app, { logs: { printThreshold: null } });
    try {
      const id = await test.backend.start(workflow);
      expect(
        await test.backend.command(id, increment, 2, { idempotencyKey: "one" }),
      ).toBe(2);
      expect(
        await test.backend.command(id, increment, 99, {
          idempotencyKey: "one",
        }),
      ).toBe(2);
      const results = await Promise.all([
        test.backend.command(id, increment, 3),
        test.backend.command(id, increment, 4),
      ]);
      expect(results).toEqual([5, 9]);
      expect(calls).toBe(3);
      await expect(test.backend.command(id, fail, undefined)).rejects.toThrow(
        "Rejected change",
      );
      expect(await test.backend.getState(id)).toEqual({ count: 9 });
      await test.backend.signal(id, signal, undefined);
      expect(await test.backend.wait(id)).toBe(9);
      expect(
        await test.backend.command(id, increment, 2, { idempotencyKey: "one" }),
      ).toBe(2);
      await expect(test.backend.command(id, increment, 1)).rejects.toThrow(
        "live execution",
      );
    } finally {
      await test.dispose();
    }
  });

  it("rejects undeclared tasks and suspension without changing workflow state", async () => {
    const test = createDurableTestRuntime();
    const durable = test.durable;
    const forbidden = r
      .task("undeclared")
      .run(async () => 1)
      .build();
    const sleep = r
      .task("sleep-command")
      .dependencies({ durable })
      .run(async (_: undefined, { durable }) => {
        await durable.use().sleep(10);
        return true;
      })
      .build();
    const workflow = r
      .task("waiting")
      .dependencies({ durable })
      .tags([tags.durableWorkflow.with({ commands: [sleep] })])
      .run(async (_: undefined, { durable }) => {
        await durable.use().sleep(100);
        return true;
      })
      .build();
    await test.run(
      r
        .resource("app")
        .register([
          resources.durable,
          workflow,
          forbidden,
          sleep,
          test.durableRegistration,
        ])
        .build(),
      { logs: { printThreshold: null } },
    );
    try {
      const id = await test.backend.start(workflow);
      await expect(
        test.backend.command(id, forbidden, undefined),
      ).rejects.toThrow("not declared");
      await expect(test.backend.command(id, sleep, undefined)).rejects.toThrow(
        "cannot suspend",
      );
      expect(
        (await test.store.getExecutionTimers(id)).filter(
          (t) => t.type === "sleep",
        ),
      ).toHaveLength(1);
    } finally {
      await test.dispose();
    }
  });
});
