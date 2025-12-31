import { r, run } from "../../..";
import { createDurableResource } from "../core/resource";
import { durableEvents } from "../events";
import { MemoryEventBus } from "../bus/MemoryEventBus";
import { MemoryStore } from "../store/MemoryStore";

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  options: { timeoutMs: number; intervalMs: number },
): Promise<void> {
  const startedAt = Date.now();
  while (!(await predicate())) {
    if (Date.now() - startedAt > options.timeoutMs) {
      throw new Error("waitUntil timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  }
}

describe("durable: audit runner events (integration)", () => {
  it("auto-wires an emitter when audit.emitRunnerEvents is enabled", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();

    const durable = createDurableResource("durable.tests.events.durable", {
      store,
      eventBus: bus,
      audit: { enabled: true, emitRunnerEvents: true },
      polling: { interval: 5 },
    });

    const received: Array<{ executionId: string; kind: string }> = [];
    const notes: string[] = [];

    const onAudit = r
      .hook("durable.tests.hooks.audit.appended")
      .on(durableEvents.audit.appended)
      .run(async (event) => {
        received.push({
          executionId: event.data.entry.executionId,
          kind: event.data.entry.kind,
        });
      })
      .build();

    const onNote = r
      .hook("durable.tests.hooks.note.created")
      .on(durableEvents.note.created)
      .run(async (event) => {
        notes.push(event.data.message);
      })
      .build();

    const task = r
      .task("durable.test.events.basic")
      .dependencies({ durable })
      .run(async (_input: undefined, { durable }) => {
        const ctx = durable.use();
        await ctx.note("starting");
        const a = await ctx.step("a", async () => "a");
        await ctx.sleep(1);
        return a;
      })
      .build();

    const app = r.resource("app").register([durable, task, onAudit, onNote]).build();

    const runtime = await run(app, { logs: { printThreshold: null } });
    const service = runtime.getResourceValue(durable);

    const executionId = await service.startExecution(task, undefined, {
      timeout: 5_000,
      waitPollIntervalMs: 5,
    });

    await expect(
      service.wait(executionId, { timeout: 5_000, waitPollIntervalMs: 5 }),
    ).resolves.toBe("a");

    await waitUntil(
      () =>
        received.some(
          (e) => e.executionId === executionId && e.kind === "note",
        ),
      { timeoutMs: 2_000, intervalMs: 5 },
    );

    const audit = await store.listAuditEntries(executionId);
    const receivedForExecution = received.filter((e) => e.executionId === executionId);
    expect(receivedForExecution).toHaveLength(audit.length);
    expect(notes).toEqual(expect.arrayContaining(["starting"]));

    await runtime.dispose();
  });

  it("does not break execution if the audit emitter throws", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();

    const durable = createDurableResource(
      "durable.tests.events.emitterFailure.durable",
      {
        store,
        eventBus: bus,
        audit: {
          enabled: true,
          emitter: {
            emit: async () => {
              throw new Error("boom");
            },
          },
        },
        polling: { interval: 5 },
      },
    );

    const task = r
      .task("durable.test.events.emitterFailure")
      .dependencies({ durable })
      .run(async (_input: undefined, { durable }) => {
        const ctx = durable.use();
        await ctx.note("hello");
        return "ok";
      })
      .build();

    const app = r.resource("app").register([durable, task]).build();

    const runtime = await run(app, { logs: { printThreshold: null } });
    const service = runtime.getResourceValue(durable);

    const executionId = await service.startExecution(task, undefined, {
      timeout: 5_000,
      waitPollIntervalMs: 5,
    });

    await expect(
      service.wait(executionId, { timeout: 5_000, waitPollIntervalMs: 5 }),
    ).resolves.toBe("ok");

    const audit = await store.listAuditEntries(executionId);
    expect(audit.some((e) => e.kind === "note" && e.message === "hello")).toBe(
      true,
    );

    await runtime.dispose();
  });
});
