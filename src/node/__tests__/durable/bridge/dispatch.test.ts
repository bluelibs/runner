import { r, run, resources } from "../../../../index";
import {
  EmissionContext,
  EventEmissionImpl,
} from "../../../../models/event/EmissionContext";
import { EventManager } from "../../../../models/EventManager";
import { eventHooks } from "../../../durable/bridge/plan";
import { waitForEvent } from "../../../durable/bridge/wait";
import { runtimeSource } from "../../../../types/runtimeSource";
import { EventEmissionFailureMode } from "../../../../types/event";

describe("durable dispatch boundary", () => {
  it("keeps default emission context options valid outside an installed bridge", async () => {
    const event = r.event("created").build();
    const emission = new EventEmissionImpl(
      event.id,
      event.id,
      undefined,
      new Date(),
      undefined,
      runtimeSource.runtime("test"),
      {},
      false,
      [],
    );
    const context = new EmissionContext(
      event,
      [],
      EventEmissionFailureMode.FailFast,
      [],
      emission,
    );
    await context.runInterceptor(0, emission);
    expect(context.executionReport.totalListeners).toBe(0);
  });

  it("rejects filtered or anonymous registrations from a durable hook plan", async () => {
    const event = r.event("created").build();
    const hook = r
      .hook("effect")
      .on(event)
      .run(async () => {})
      .build();
    const runtime = await run(
      r.resource("app").register([event, hook]).build(),
      { logs: { printThreshold: null } },
    );
    try {
      const store = runtime.getResourceValue(resources.store);
      const definition = store.events.get(
        store.findIdByDefinition(event),
      )!.event;
      const manager = new EventManager();
      manager.addListener(definition, async () => {}, {
        id: store.findIdByDefinition(hook),
        filter: () => true,
      });
      expect(() => eventHooks(store, manager, definition, false)).toThrow(
        "named exact-event",
      );
      manager.dispose();
      manager.addListener(definition, async () => {});
      expect(() => eventHooks(store, manager, definition, false)).toThrow(
        "named exact-event",
      );
    } finally {
      await runtime.dispose();
    }
  });

  it("honors an already-aborted caller without losing the accepted execution promise", async () => {
    const controller = new AbortController();
    controller.abort("caller left");
    await expect(
      waitForEvent(Promise.resolve(1), controller.signal),
    ).rejects.toThrow("caller left");
    await expect(
      waitForEvent(
        Promise.reject(new Error("failed")),
        new AbortController().signal,
      ),
    ).rejects.toThrow("failed");
  });
});
