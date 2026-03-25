import { r, resources, run } from "../../node";
import { DurableExecutionError } from "../../durable/core/DurableService";
import { durableResource } from "../../durable/core/resource";
import { durableEvents } from "../../durable/events";
import { MemoryEventBus } from "../../durable/bus/MemoryEventBus";
import { MemoryQueue } from "../../durable/queue/MemoryQueue";
import { MemoryStore } from "../../durable/store/MemoryStore";
import { waitUntil } from "../../durable/test-utils";

describe("durable: durableResource + fork + with (integration)", () => {
  it("awaits nested taskRunner promises (normal path)", async () => {
    const store = new MemoryStore();
    const durable = durableResource.fork("durable-tests-unified-ok");
    const durableRegistration = durable.with({ store });
    const task = r
      .task("durable-tests-unified-task-ok")
      .run(async () => "ok")
      .build();

    const app = r
      .resource("app")
      .register([resources.durable, durableRegistration, task])
      .build();
    const runtime = await run(app, { logs: { printThreshold: null } });

    const taskRunner = runtime.getResourceValue(resources.taskRunner);
    const spy = jest
      .spyOn(taskRunner, "run")
      .mockResolvedValue(Promise.resolve("ok"));

    const d = runtime.getResourceValue(durable);
    await expect(d.startAndWait(task)).resolves.toEqual({
      durable: { executionId: expect.any(String) },
      data: "ok",
    });

    spy.mockRestore();
    await runtime.dispose();
  });

  it("handles undefined taskRunner results (edge branch)", async () => {
    const store = new MemoryStore();
    const durable = durableResource.fork("durable-tests-unified-undefined");
    const durableRegistration = durable.with({ store });
    const task = r
      .task("durable-tests-unified-task-undefined")
      .run(async () => "ok")
      .build();

    const app = r
      .resource("app")
      .register([resources.durable, durableRegistration, task])
      .build();
    const runtime = await run(app, { logs: { printThreshold: null } });

    const taskRunner = runtime.getResourceValue(resources.taskRunner);
    const spy = jest.spyOn(taskRunner, "run").mockResolvedValue(undefined);

    const d = runtime.getResourceValue(durable);
    await expect(d.startAndWait(task)).rejects.toBeInstanceOf(
      DurableExecutionError,
    );

    spy.mockRestore();
    await runtime.dispose();
  });

  it("executes via queue + embedded queue consumer and resolves tasks via runner store", async () => {
    const queue = new MemoryQueue();
    const consumeSpy = jest.spyOn(queue, "consume");
    const durable = durableResource.fork("durable-tests-unified-queue");
    const durableRegistration = durable.with({
      store: new MemoryStore(),
      eventBus: new MemoryEventBus(),
      queue,
      roles: {
        queueConsumer: true,
      },
      polling: { interval: 5 },
    });

    const task = r
      .task("durable-tests-unified-queue-task")
      .dependencies({ durable })
      .run(async (input: { v: number }, { durable }) => {
        const ctx = durable.use();
        const v = await ctx.step("double", async () => input.v * 2);
        return { v };
      })
      .build();

    const app = r
      .resource("app")
      .register([resources.durable, durableRegistration, task])
      .build();
    const runtime = await run(app, { logs: { printThreshold: null } });
    expect(consumeSpy).toHaveBeenCalledTimes(1);
    const d = runtime.getResourceValue(durable);

    await expect(
      d.startAndWait(
        task,
        { v: 2 },
        {
          timeout: 5_000,
          waitPollIntervalMs: 5,
        },
      ),
    ).resolves.toEqual({
      durable: { executionId: expect.any(String) },
      data: { v: 4 },
    });

    await runtime.dispose();
    consumeSpy.mockRestore();
  });

  it("emits durable runner events by default (without audit persistence)", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();

    const received: Array<{ executionId: string; kind: string }> = [];
    const notes: string[] = [];

    const onAudit = r
      .hook("durable-tests-unified-hooks-audit-appended")
      .on(durableEvents.audit.appended)
      .run(async (event) => {
        received.push({
          executionId: event.data.entry.executionId,
          kind: event.data.entry.kind,
        });
      })
      .build();

    const onNote = r
      .hook("durable-tests-unified-hooks-note-created")
      .on(durableEvents.note.created)
      .run(async (event) => {
        notes.push(event.data.message);
      })
      .build();

    const durable = durableResource.fork("durable-tests-unified-audit");
    const durableRegistration = durable.with({
      store,
      eventBus: bus,
      polling: { interval: 5 },
    });

    const task = r
      .task("durable-tests-unified-audit-task")
      .dependencies({ durable })
      .run(async (_input: undefined, { durable }) => {
        const ctx = durable.use();
        await ctx.note("starting");
        const a = await ctx.step("a", async () => "a");
        await ctx.sleep(1);
        return a;
      })
      .build();

    const app = r
      .resource("app")
      .register([resources.durable, durableRegistration, task, onAudit, onNote])
      .build();
    const runtime = await run(app, { logs: { printThreshold: null } });
    const d = runtime.getResourceValue(durable);

    const executionId = await d.start(task, undefined, {
      timeout: 5_000,
    });

    await expect(
      d.wait(executionId, { timeout: 5_000, waitPollIntervalMs: 5 }),
    ).resolves.toBe("a");

    await waitUntil(
      () =>
        received.some(
          (e) => e.executionId === executionId && e.kind === "note",
        ),
      { timeoutMs: 2_000, intervalMs: 5 },
    );

    const receivedForExecution = received.filter(
      (e) => e.executionId === executionId,
    );
    expect(receivedForExecution.length).toBeGreaterThan(0);
    expect(notes).toEqual(expect.arrayContaining(["starting"]));
    await expect(store.listAuditEntries(executionId)).resolves.toEqual([]);

    await runtime.dispose();
  }, 20_000);

  it("persists audit entries when audit.enabled is true (and still emits events)", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();

    const received: Array<{ executionId: string; kind: string }> = [];

    const onAudit = r
      .hook("durable-tests-unified-hooks-audit-appended-persist")
      .on(durableEvents.audit.appended)
      .run(async (event) => {
        received.push({
          executionId: event.data.entry.executionId,
          kind: event.data.entry.kind,
        });
      })
      .build();

    const durable = durableResource.fork("durable-tests-unified-audit-persist");
    const durableRegistration = durable.with({
      store,
      eventBus: bus,
      audit: { enabled: true },
      polling: { interval: 5 },
    });

    const task = r
      .task("durable-tests-unified-audit-persist-task")
      .dependencies({ durable })
      .run(async (_input: undefined, { durable }) => {
        const ctx = durable.use();
        await ctx.note("starting");
        const a = await ctx.step("a", async () => "a");
        await ctx.sleep(1);
        return a;
      })
      .build();

    const app = r
      .resource("app")
      .register([resources.durable, durableRegistration, task, onAudit])
      .build();
    const runtime = await run(app, { logs: { printThreshold: null } });
    const d = runtime.getResourceValue(durable);

    const executionId = await d.start(task, undefined, {
      timeout: 5_000,
    });

    await expect(
      d.wait(executionId, { timeout: 5_000, waitPollIntervalMs: 5 }),
    ).resolves.toBe("a");

    await waitUntil(
      () =>
        received.some(
          (e) => e.executionId === executionId && e.kind === "note",
        ),
      { timeoutMs: 2_000, intervalMs: 5 },
    );

    const audit = await store.listAuditEntries(executionId);
    const receivedForExecution = received.filter(
      (e) => e.executionId === executionId,
    );
    expect(receivedForExecution).toHaveLength(audit.length);

    await runtime.dispose();
  });
});
