import { r, run } from "../../../../index";
import { resources, tags } from "../../../node";
import { durableResource } from "../../../durable/core/resource";
import { MemoryStore } from "../../../durable/store/MemoryStore";
import type { DurableEventInput } from "../../../durable/bridge/types";
import { eventLanesResource } from "../../../event-lanes/eventLanes.resource";
import { rpcLanesResource } from "../../../rpc-lanes/rpcLanes.resource";

const logs = { printThreshold: null } as const;

describe("durable bridge validation", () => {
  it("rejects startup emissions before resources are ready", async () => {
    const durable = durableResource.fork("workflows");
    const event = r.event("created").tags([tags.durableEvent]).build();
    const startup = r
      .resource("startup")
      .dependencies({ bridge: resources.durableEventBridge, emit: event })
      .init(async (_, { emit }) => {
        await emit();
      })
      .build();
    await expect(
      run(
        r
          .resource("app")
          .register([
            resources.durable,
            durable.with({ store: new MemoryStore() }),
            resources.durableEventBridge,
            event,
            startup,
          ])
          .build(),
        { logs },
      ),
    ).rejects.toThrow("after resource initialization");
  });

  it.each([{ failureMode: "aggregate" as const }, { throwOnError: false }])(
    "rejects conflicting emission error options: %s",
    async (options) => {
      const durable = durableResource.fork("workflows");
      const event = r.event("created").tags([tags.durableEvent]).build();
      const runtime = await run(
        r
          .resource("app")
          .register([
            resources.durable,
            durable.with({ store: new MemoryStore() }),
            resources.durableEventBridge,
            event,
          ])
          .build(),
        { logs },
      );
      try {
        await expect(
          runtime.emitEvent(event, undefined, options),
        ).rejects.toThrow("require fail-fast");
      } finally {
        await runtime.dispose();
      }
    },
  );

  it("rejects nested durable emissions from a hook body", async () => {
    const store = new MemoryStore();
    const durable = durableResource.fork("workflows");
    const first = r.event("first").tags([tags.durableEvent]).build();
    const second = r.event("second").tags([tags.durableEvent]).build();
    const hook = r
      .hook("effect")
      .on(first)
      .dependencies({ second })
      .run(async (_, { second }) => {
        await second();
      })
      .build();
    const runtime = await run(
      r
        .resource("app")
        .register([
          resources.durable,
          durable.with({ store, execution: { maxAttempts: 1 } }),
          resources.durableEventBridge,
          first,
          second,
          hook,
        ])
        .build(),
      { logs },
    );
    try {
      await expect(runtime.emitEvent(first)).rejects.toThrow(
        "Nested durable event",
      );
      expect(await store.listExecutions()).toHaveLength(1);
    } finally {
      await runtime.dispose();
    }
  });

  it("rejects persisted route and compatibility mismatches", async () => {
    const durable = durableResource.fork("workflows");
    const event = r.event("created").tags([tags.durableEvent]).build();
    const runtime = await run(
      r
        .resource("app")
        .register([
          resources.durable,
          durable.with({ store: new MemoryStore() }),
          resources.durableEventBridge,
          event,
        ])
        .build(),
      { logs },
    );
    try {
      const store = runtime.getResourceValue(resources.store);
      const input: DurableEventInput = {
        eventId: store.findIdByDefinition(event),
        resourceId: store.findIdByDefinition(durable),
        hookIds: [],
        data: undefined,
        timestamp: new Date(),
        source: { kind: "runtime", id: "test" },
        version: "1",
        compensation: false,
      };
      const bridge = runtime.getResourceValue(resources.durableEventBridge);
      for (const override of [
        { eventId: "missing" },
        { resourceId: "missing" },
        { version: "2" },
        { compensation: true },
      ]) {
        await expect(bridge.execute({ ...input, ...override })).rejects.toThrow(
          "route changed",
        );
      }
    } finally {
      await runtime.dispose();
    }
  });

  it("fails if its backend disappears rather than dispatching ordinary hooks", async () => {
    const durable = durableResource.fork("workflows");
    const event = r.event("created").tags([tags.durableEvent]).build();
    const runtime = await run(
      r
        .resource("app")
        .register([
          resources.durable,
          durable.with({ store: new MemoryStore() }),
          resources.durableEventBridge,
          event,
        ])
        .build(),
      { logs },
    );
    const entry = runtime.store.resources.get(
      runtime.store.findIdByDefinition(durable),
    )!;
    const value = entry.value;
    try {
      entry.value = undefined;
      await expect(runtime.emitEvent(event)).rejects.toThrow("not initialized");
    } finally {
      entry.value = value;
      await runtime.dispose();
    }
  });

  it("fails safely if disposal removes the captured hook registrations", async () => {
    const durable = durableResource.fork("workflows");
    const event = r.event("created").tags([tags.durableEvent]).build();
    const effect = jest.fn(async () => {});
    const hook = r.hook("effect").on(event).run(effect).build();
    const interceptor = r
      .resource("interceptor")
      .dependencies({
        bridge: resources.durableEventBridge,
        manager: resources.eventManager,
      })
      .init(async (_, { manager }) => {
        manager.intercept(async (next, emission) => {
          if (emission.id.endsWith(".created")) manager.dispose();
          await next(emission);
        });
      })
      .build();
    const runtime = await run(
      r
        .resource("app")
        .register([
          resources.durable,
          durable.with({ store: new MemoryStore() }),
          resources.durableEventBridge,
          event,
          hook,
          interceptor,
        ])
        .build(),
      { logs },
    );
    try {
      await expect(runtime.emitEvent(event)).rejects.toThrow(
        "registrations changed",
      );
      expect(effect).not.toHaveBeenCalled();
    } finally {
      await runtime.dispose();
    }
  });

  it("rejects a competing event-lane route", async () => {
    const durable = durableResource.fork("workflows");
    const event = r.event("created").tags([tags.durableEvent]).build();
    const lane = r.eventLane("transport").applyTo([event]).build();
    const queue = {
      enqueue: async () => "message",
      consume: async () => {},
      ack: async () => {},
      nack: async () => {},
    };
    await expect(
      run(
        r
          .resource("app")
          .register([
            resources.durable,
            durable.with({ store: new MemoryStore() }),
            resources.durableEventBridge,
            event,
            eventLanesResource.with({
              profile: "producer",
              topology: {
                profiles: { producer: { consume: [] } },
                bindings: [{ lane, queue }],
              },
            }),
          ])
          .build(),
        { logs },
      ),
    ).rejects.toThrow("remote lane");
  });

  it("rejects a competing RPC route", async () => {
    const durable = durableResource.fork("workflows");
    const event = r.event("created").tags([tags.durableEvent]).build();
    const lane = r.rpcLane("transport").applyTo([event]).build();
    const communicator = r
      .resource("communicator")
      .init(async () => ({ emit: async () => {}, task: async () => undefined }))
      .build();
    await expect(
      run(
        r
          .resource("app")
          .register([
            resources.durable,
            durable.with({ store: new MemoryStore() }),
            resources.durableEventBridge,
            event,
            communicator,
            rpcLanesResource.with({
              profile: "client",
              topology: {
                profiles: { client: { serve: [] } },
                bindings: [{ lane, communicator }],
              },
            }),
          ])
          .build(),
        { logs },
      ),
    ).rejects.toThrow("remote lane");
  });
});
