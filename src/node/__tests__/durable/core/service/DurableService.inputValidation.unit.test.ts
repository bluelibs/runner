import { r } from "../../../../..";
import { DurableService } from "../../../../durable/core/DurableService";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { SpyQueue } from "../../helpers/DurableService.unit.helpers";

function rejectingTask(id: string) {
  return r
    .task(id)
    .inputSchema<{ orderId: string }>({
      parse: () => {
        throw new Error("orderId is required");
      },
    })
    .run(async () => "ok")
    .build();
}

function normalizingTask(id: string) {
  return r
    .task(id)
    .inputSchema<{ orderId: string }>({
      parse: (value: any) => ({ ...value, normalized: true }),
    })
    .run(async () => "ok")
    .build();
}

describe("durable: input validated before persist", () => {
  it("start() rejects invalid input without persisting an execution", async () => {
    const store = new MemoryStore();
    const service = new DurableService({
      store,
      queue: new SpyQueue(),
      tasks: [],
    });

    await expect(
      service.start(
        rejectingTask("t-start-invalid"),
        // Invalid at runtime on purpose: untrusted input bypasses types.
        { orderId: 1 } as unknown as { orderId: string },
      ),
    ).rejects.toThrow();

    expect(await store.listExecutions()).toEqual([]);
  });

  it("start() validates before persist without storing a schema projection", async () => {
    const store = new MemoryStore();
    const service = new DurableService({
      store,
      queue: new SpyQueue(),
      tasks: [],
    });

    const executionId = await service.start(normalizingTask("t-start-valid"), {
      orderId: "o1",
    });

    const execution = await store.getExecution(executionId);
    expect(execution?.input).toEqual({ orderId: "o1" });
  });

  it("schedule() validates before persist without storing a schema projection", async () => {
    const store = new MemoryStore();
    const service = new DurableService({ store, tasks: [] });

    await service.schedule(
      normalizingTask("t-schedule-valid"),
      { orderId: "o1" },
      { id: "s1", cron: "*/5 * * * *" },
    );

    expect((await store.getSchedule("s1"))?.input).toEqual({ orderId: "o1" });
  });

  it("schedule() rejects invalid input without persisting a schedule", async () => {
    const store = new MemoryStore();
    const service = new DurableService({ store, tasks: [] });

    await expect(
      service.schedule(
        rejectingTask("t-schedule-invalid"),
        // Invalid at runtime on purpose: untrusted input bypasses types.
        { orderId: 1 } as unknown as { orderId: string },
        {
          id: "s1",
          cron: "*/5 * * * *",
        },
      ),
    ).rejects.toThrow();

    expect(await store.getSchedule("s1")).toBeNull();
  });

  it("ensureSchedule() rejects invalid input without persisting a schedule", async () => {
    const store = new MemoryStore();
    const service = new DurableService({ store, tasks: [] });

    await expect(
      service.ensureSchedule(
        rejectingTask("t-ensure-invalid"),
        // Invalid at runtime on purpose: untrusted input bypasses types.
        { orderId: 1 } as unknown as { orderId: string },
        { id: "s1", cron: "*/5 * * * *" },
      ),
    ).rejects.toThrow();

    expect(await store.getSchedule("s1")).toBeNull();
  });
});
