import { r } from "../../..";
import { durableContext } from "../context";
import { DurableService } from "../core/DurableService";
import { MemoryStore } from "../store/MemoryStore";

describe("durable: compensation failure", () => {
  it("marks execution as compensation_failed when rollback compensation throws", async () => {
    const store = new MemoryStore();

    const task = r
      .task("durable.test.compensation_failed")
      .run(async () => "unused")
      .build();

    const service = new DurableService({
      store,
      tasks: [task],
      execution: { maxAttempts: 1 },
      taskExecutor: {
        run: async () => {
          const ctx = durableContext.use();
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
        },
      },
    });

    await store.saveExecution({
      id: "e1",
      taskId: task.id,
      input: undefined,
      status: "pending",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await service.processExecution("e1");

    const execution = await store.getExecution("e1");
    expect(execution?.status).toBe("compensation_failed");
    expect(execution?.error?.message).toContain(
      "I am a bad compensation logic",
    );
  });
});
