import { r, run } from "../../..";
import { durableResource } from "../../durable/core/resource";
import { MemoryStore } from "../../durable/store/MemoryStore";

describe("durable: compensation failure", () => {
  it("marks execution as compensation_failed when rollback compensation throws", async () => {
    const store = new MemoryStore();

    const durable = durableResource.fork("durable.tests.compensation.durable");
    const durableRegistration = durable.with({
      store,
      execution: { maxAttempts: 1 },
    });

    const task = r
      .task("durable.test.compensation_failed")
      .dependencies({ durable })
      .run(async (_input: undefined, { durable }) => {
        const ctx = durable.use();

        await ctx
          .step<string>("step-1")
          .up(async () => "ok")
          .down(async () => {
            throw new Error("I am a bad compensation logic");
          });

        try {
          throw new Error("Triggering rollback");
        } catch (error) {
          await ctx.rollback();
          throw error;
        }
      })
      .build();

    const app = r.resource("app").register([durableRegistration, task]).build();
    const runtime = await run(app, { logs: { printThreshold: null } });
    const service = runtime.getResourceValue(durable);

    const executionId = await service.startExecution(task);
    const execution = await store.getExecution(executionId);
    expect(execution?.status).toBe("compensation_failed");
    expect(execution?.error?.message).toContain(
      "I am a bad compensation logic",
    );

    await runtime.dispose();
  });
});
