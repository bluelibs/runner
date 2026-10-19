import { r, run } from "../../../../index";
import { resources, tags } from "../../../node";
import { durableResource } from "../../../durable/core/resource";
import { MemoryStore } from "../../../durable/store/MemoryStore";
import { EventManager } from "../../../../models/EventManager";
import { eventPolicy } from "../../../durable/bridge/plan";
import { globalEvents } from "../../../../globals/globalEvents";

const logs = { printThreshold: null } as const;

describe("durable event policy", () => {
  it.each(["array", "predicate"] as const)(
    "selects events with a definition %s",
    async (kind) => {
      const store = new MemoryStore();
      const durable = durableResource.fork("workflows");
      const event = r.event("created").build();
      const other = r.event("other").build();
      const runtime = await run(
        r
          .resource("app")
          .register([
            resources.durable,
            durable.with({ store }),
            resources.durableEventBridge.with({
              applyTo:
                kind === "array"
                  ? [event]
                  : (definition) => definition.id.endsWith(".created"),
            }),
            event,
            other,
          ])
          .build(),
        { logs },
      );
      try {
        await runtime.emitEvent(event);
        await runtime.emitEvent(other);
        expect(await store.listExecutions()).toHaveLength(1);
      } finally {
        await runtime.dispose();
      }
    },
  );

  it("routes event-level overrides ahead of the bridge default", async () => {
    const firstStore = new MemoryStore();
    const secondStore = new MemoryStore();
    const one = durableResource.fork("one");
    const two = durableResource.fork("two");
    const event = r
      .event("created")
      .tags([tags.durableEvent.with({ durable: two })])
      .build();
    const runtime = await run(
      r
        .resource("app")
        .register([
          resources.durable,
          one.with({ store: firstStore }),
          two.with({ store: secondStore }),
          resources.durableEventBridge.with({ defaultDurable: one }),
          event,
        ])
        .build(),
      { logs },
    );
    try {
      await runtime.emitEvent(event);
      expect(await firstStore.listExecutions()).toHaveLength(0);
      expect(await secondStore.listExecutions()).toHaveLength(1);
    } finally {
      await runtime.dispose();
    }
  });

  it.each([
    "global",
    "selector",
    "compensation",
    "parallel",
    "transactional",
  ] as const)(
    "rejects incompatible %s declarations before effects",
    async (kind) => {
      const durable = durableResource.fork("workflows");
      const event = r
        .event("created")
        .tags([
          tags.durableEvent.with({
            compensation: kind === "compensation" ? "required" : undefined,
          }),
        ])
        .build();
      const definition = {
        ...event,
        parallel: kind === "parallel",
        transactional: kind === "transactional",
      };
      const hook = r
        .hook("effect")
        .on(
          kind === "global"
            ? "*"
            : kind === "selector"
              ? () => true
              : definition,
        )
        .run(async () => {})
        .build();
      await expect(
        run(
          r
            .resource("app")
            .register([
              resources.durable,
              durable.with({ store: new MemoryStore() }),
              resources.durableEventBridge,
              definition,
              hook,
            ])
            .build(),
          { logs },
        ),
      ).rejects.toThrow();
    },
  );

  it("requires the bridge when an event is tagged", async () => {
    const event = r.event("created").tags([tags.durableEvent]).build();
    await expect(
      run(r.resource("app").register([resources.durable, event]).build(), {
        logs,
      }),
    ).rejects.toThrow("require resources.durableEventBridge");
  });

  it("requires a visible durable runtime", async () => {
    const event = r.event("created").tags([tags.durableEvent]).build();
    await expect(
      run(
        r
          .resource("app")
          .register([resources.durable, resources.durableEventBridge, event])
          .build(),
        { logs },
      ),
    ).rejects.toThrow("one visible runtime");
  });

  it("rejects infrastructure selection even with an explicit tag", () => {
    expect(() =>
      eventPolicy({ ...globalEvents.ready, tags: [tags.durableEvent] }, {}),
    ).toThrow("Infrastructure event");
  });

  it("rejects duplicate dispatch owners and respects registration locking", () => {
    const manager = new EventManager();
    manager.setDispatchAdapter(() => undefined);
    expect(() => manager.setDispatchAdapter(() => undefined)).toThrow(
      "Only one",
    );
    manager.lock();
    expect(() => manager.setDispatchAdapter(() => undefined)).toThrow();
  });

  it("rejects propagation control inside a durable hook", async () => {
    const durable = durableResource.fork("workflows");
    const event = r.event("created").tags([tags.durableEvent]).build();
    const hook = r
      .hook("effect")
      .on(event)
      .run(async (event) => {
        event.stopPropagation();
      })
      .build();
    const runtime = await run(
      r
        .resource("app")
        .register([
          resources.durable,
          durable.with({
            store: new MemoryStore(),
            execution: { maxAttempts: 1 },
          }),
          resources.durableEventBridge,
          event,
          hook,
        ])
        .build(),
      { logs },
    );
    try {
      await expect(runtime.emitEvent(event)).rejects.toThrow(
        "cannot stop propagation",
      );
    } finally {
      await runtime.dispose();
    }
  });
});
