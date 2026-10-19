import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { r, run } from "../../../../index";
import { resources, tags } from "../../../node";
import { durableResource } from "../../../durable/core/resource";
import { PersistentMemoryStore } from "../../../durable/store/PersistentMemoryStore";

const logs = { printThreshold: null } as const;

describe("durable event process recovery", () => {
  it("recovers an interrupted persisted event at startup without repeating completed hooks", async () => {
    const directory = await mkdtemp(join(tmpdir(), "runner-event-recovery-"));
    const filePath = join(directory, "state.json");
    const durable = durableResource.fork("workflows");
    const event = r.event("created").tags([tags.durableEvent]).build();
    let firstCalls = 0;
    let failing = true;
    const first = r
      .hook("first")
      .on(event)
      .order(1)
      .run(async () => {
        firstCalls++;
        return "receipt";
      })
      .build();
    const second = r
      .hook("second")
      .on(event)
      .order(2)
      .run(async () => {
        if (failing) throw new Error("offline");
        return "done";
      })
      .build();
    const app = (store: PersistentMemoryStore, recover: boolean) =>
      r
        .resource("app")
        .register([
          resources.durable,
          durable.with({
            store,
            execution: { maxAttempts: 1 },
            recovery: { onStartup: recover },
            polling: { interval: 5 },
          }),
          resources.durableEventBridge,
          event,
          first,
          second,
        ])
        .build();
    try {
      const store = new PersistentMemoryStore({ filePath });
      const firstRuntime = await run(app(store, false), { logs });
      let executionId: string;
      try {
        await expect(firstRuntime.emitEvent(event)).rejects.toThrow("offline");
        const execution = (await store.listExecutions())[0];
        executionId = execution.id;
        // Model a process that persisted its first step but lost the attempt before completion.
        await store.saveExecution({
          ...execution,
          status: "pending",
          completedAt: undefined,
          error: undefined,
        });
      } finally {
        await firstRuntime.dispose();
      }
      failing = false;
      const recoveredStore = new PersistentMemoryStore({ filePath });
      const secondRuntime = await run(app(recoveredStore, true), { logs });
      try {
        await expect(
          secondRuntime
            .getResourceValue(durable)
            .wait(executionId!, { timeout: 3000, waitPollIntervalMs: 5 }),
        ).resolves.toMatchObject({ succeededListeners: 2 });
        expect(firstCalls).toBe(1);
      } finally {
        await secondRuntime.dispose();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
