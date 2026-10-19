import { r, run } from "../../../../index";
import { resources, tags } from "../../../node";
import { durableResource } from "../../../durable/core/resource";
import { MemoryStore } from "../../../durable/store/MemoryStore";

const logs = { printThreshold: null } as const;

describe("durable event cancellation", () => {
  it.each([true, false])(
    "compensates cancellation and recovers undo failures: %s",
    async (initialFailure) => {
      const store = new MemoryStore();
      const durable = durableResource.fork("workflows");
      const event = r
        .event("created")
        .tags([tags.durableEvent.with({ compensation: "required" })])
        .build();
      let started!: () => void;
      const ready = new Promise<void>((resolve) => {
        started = resolve;
      });
      let failUndo = initialFailure;
      let undos = 0;
      const first = r
        .hook("first")
        .on(event)
        .order(1)
        .run(async () => 1)
        .compensate(async () => {
          undos++;
          if (failUndo) throw new Error("undo offline");
        })
        .build();
      const waiting = r
        .hook("waiting")
        .on(event)
        .order(2)
        .run(async (event) => {
          started();
          await new Promise<void>((_, reject) =>
            event.signal!.addEventListener(
              "abort",
              () => reject(new Error("cancelled")),
              { once: true },
            ),
          );
        })
        .compensate(async () => {})
        .build();
      const runtime = await run(
        r
          .resource("app")
          .register([
            resources.durable,
            durable.with({ store, execution: { maxAttempts: 1 } }),
            resources.durableEventBridge,
            event,
            first,
            waiting,
          ])
          .build(),
        { logs },
      );
      try {
        const result = runtime.emitEvent(event).then(
          () => undefined,
          (error: unknown) => error,
        );
        await ready;
        const execution = (await store.listExecutions())[0];
        const d = runtime.getResourceValue(durable);
        await d.cancelExecution(execution.id);
        expect(await result).toBeInstanceOf(Error);
        if (!initialFailure) {
          expect((await store.getExecution(execution.id))!.status).toBe(
            "cancelled",
          );
          expect(undos).toBe(1);
          return;
        }
        expect((await store.getExecution(execution.id))!.status).toBe(
          "compensation_failed",
        );
        expect(
          (await store.getExecution(execution.id))!.error!.message,
        ).toContain("undo offline");
        failUndo = false;
        await d.operator.retryRollback(execution.id);
        await d.recover();
        expect((await store.getExecution(execution.id))!.status).toBe(
          "cancelled",
        );
        expect(undos).toBe(2);
      } finally {
        await runtime.dispose();
      }
    },
  );

  it("aborts a caller's wait without cancelling its accepted execution", async () => {
    const store = new MemoryStore();
    const durable = durableResource.fork("workflows");
    const event = r.event("created").tags([tags.durableEvent]).build();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    let finish!: () => void;
    const hook = r
      .hook("effect")
      .on(event)
      .run(async () => {
        started();
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      })
      .build();
    const runtime = await run(
      r
        .resource("app")
        .register([
          resources.durable,
          durable.with({ store }),
          resources.durableEventBridge,
          event,
          hook,
        ])
        .build(),
      { logs },
    );
    try {
      const controller = new AbortController();
      const result = runtime
        .emitEvent(event, undefined, { signal: controller.signal })
        .then(
          () => undefined,
          (error: unknown) => error,
        );
      await ready;
      controller.abort("caller left");
      expect(await result).toBeInstanceOf(Error);
      const execution = (await store.listExecutions())[0];
      expect(execution.status).toBe("running");
      finish();
      await runtime.getResourceValue(durable).wait(execution.id);
      expect((await store.getExecution(execution.id))!.status).toBe(
        "completed",
      );
    } finally {
      await runtime.dispose();
    }
  });
});
