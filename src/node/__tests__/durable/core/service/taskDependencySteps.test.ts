import { r, resources, tags } from "../../../..";
import { createDurableTestRuntime } from "../../../../durable/test-runtime";

describe("injected tasks inside durable callback steps", () => {
  it("forwards step controls, reuses the checkpoint after restart, and keeps the task independently callable", async () => {
    const test = createDurableTestRuntime();
    const durable = test.durable;
    const multiplier = r
      .resource("multiplier")
      .init(async () => 3)
      .build();
    const calls: Array<{ key: string; signal: AbortSignal | undefined }> = [];
    const charge = r
      .task("charge")
      .dependencies({ multiplier })
      .run(
        async (
          input: { amount: number; idempotencyKey: string },
          { multiplier },
          context,
        ) => {
          calls.push({ key: input.idempotencyKey, signal: context?.signal });
          return input.amount * multiplier;
        },
      )
      .build();
    const checkout = r
      .task("checkout")
      .dependencies({ durable, charge })
      .tags([tags.durableWorkflow])
      .run(async (input: { amount: number }, { durable, charge }) => {
        const d = durable.use();
        const result = await d.step(
          "charge",
          { retries: 3, timeout: 1000 },
          async (step) => {
            await step.heartbeat({ phase: "charging" });
            return charge(
              { amount: input.amount, idempotencyKey: step.idempotencyKey },
              { signal: step.signal },
            );
          },
        );
        await d.sleep(1000, { stepId: "settlement" });
        return result;
      })
      .build();
    const app = r
      .resource("app")
      .register([
        resources.durable,
        test.durableRegistration,
        multiplier,
        charge,
        checkout,
      ])
      .build();
    await test.run(app, { logs: { printThreshold: null } });
    try {
      const id = await test.backend.start(checkout, { amount: 4 });
      expect(calls).toHaveLength(1);
      expect(calls[0].key).toContain(id);
      expect(calls[0].signal).toBeInstanceOf(AbortSignal);
      const runtime = await test.restartWorker();
      await test.advanceTimeBy(1000);
      expect(await test.backend.wait(id)).toBe(12);
      expect(calls).toHaveLength(1);
      expect(
        (await test.store.listExecutionHistory(id)).find(
          (entry) => entry.stepId === "charge",
        ),
      ).toMatchObject({ kind: "step", taskKey: undefined });
      expect(
        await runtime.runTask(charge, {
          amount: 2,
          idempotencyKey: "api-request",
        }),
      ).toBe(6);
      expect(calls).toHaveLength(2);
      expect(calls[1].key).toBe("api-request");
    } finally {
      await test.dispose();
    }
  });
});
