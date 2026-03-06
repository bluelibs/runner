import type { IEventLaneDefinition, IRpcLaneDefinition } from "../../../defs";
import { globalTags } from "../../../globals/globalTags";
import type { Store } from "../../../models/Store";
import { resolveEventLaneAssignments } from "../../event-lanes/EventLaneAssignments";

type EventShape = {
  id: string;
  tags?: unknown[];
};

type TaskShape = {
  id: string;
  tags?: unknown[];
};

function createStore(options: {
  events: EventShape[];
  tasks?: TaskShape[];
  rpcTopology?: unknown;
}): Store {
  const resources = new Map<string, { config?: unknown }>();
  if (options.rpcTopology) {
    resources.set("platform.node.resources.rpcLanes", {
      config: { topology: options.rpcTopology },
    });
  }

  return {
    events: new Map(options.events.map((event) => [event.id, { event }])),
    tasks: new Map((options.tasks ?? []).map((task) => [task.id, { task }])),
    resources,
    hooks: new Map(),
    taskMiddlewares: new Map(),
    resourceMiddlewares: new Map(),
    errors: new Map(),
    tags: new Map(),
    asyncContexts: new Map(),
    toPublicId: (reference: unknown) =>
      typeof reference === "string"
        ? reference
        : (reference as { id: string }).id,
  } as unknown as Store;
}

function eventLane(
  id: string,
  applyTo?: IEventLaneDefinition["applyTo"],
): IEventLaneDefinition {
  return { id, applyTo };
}

function rpcLane(
  id: string,
  applyTo?: IRpcLaneDefinition["applyTo"],
): IRpcLaneDefinition {
  return { id, applyTo };
}

describe("EventLaneAssignments", () => {
  it("fails when two function-based lanes target the same event", () => {
    const event = { id: "tests.event-lane.assignments.event" };
    const store = createStore({ events: [event] });
    const lanes = [
      eventLane("lane.a", () => true),
      eventLane("lane.b", () => true),
    ];

    expect(() => resolveEventLaneAssignments(store, lanes)).toThrow(
      'Event "tests.event-lane.assignments.event" is already assigned to eventLane "lane.a". Cannot also assign eventLane "lane.b" via applyTo().',
    );
  });

  it("fails when two id-list lanes target the same event", () => {
    const event = { id: "tests.event-lane.assignments.by-id.event" };
    const store = createStore({ events: [event] });
    const lanes = [
      eventLane("lane.a", [event.id]),
      eventLane("lane.b", [event.id]),
    ];

    expect(() => resolveEventLaneAssignments(store, lanes)).toThrow(
      'Event "tests.event-lane.assignments.by-id.event" is already assigned to eventLane "lane.a". Cannot also assign eventLane "lane.b" via applyTo().',
    );
  });

  it("fails fast when applyTo is not a function or array", () => {
    const store = createStore({ events: [{ id: "tests.event-lane.invalid" }] });
    const lanes = [eventLane("lane.invalid", 42 as unknown as string[])];

    expect(() => resolveEventLaneAssignments(store, lanes)).toThrow(
      'eventLane "lane.invalid" applyTo() received an invalid target. Expected an event or non-empty id string.',
    );
  });

  it("skips tag-based event-lane routing when rpc applyTo explicitly targets the event", () => {
    const eventLaneDefinition = eventLane("lane.tagged");
    const event = {
      id: "tests.event-lane.tag-skip.event",
      tags: [globalTags.eventLane.with({ lane: eventLaneDefinition })],
    };
    const rpcFunctionLane = rpcLane(
      "rpc.func",
      (target) => target.id === event.id,
    );
    const rpcInvalidLane = rpcLane("rpc.invalid-shape", {
      bad: true,
    } as unknown as string[]);

    const store = createStore({
      events: [event],
      rpcTopology: {
        profiles: { client: { serve: [rpcFunctionLane, rpcInvalidLane] } },
        bindings: [],
      },
    });

    const routes = resolveEventLaneAssignments(store, []);
    expect(routes.has(event.id)).toBe(false);
  });

  it("throws when event has both event-lane and rpc-lane tags without explicit applyTo ownership", () => {
    const eventLaneDefinition = eventLane("lane.tagged");
    const rpcLaneDefinition = rpcLane("rpc.tagged");
    const event = {
      id: "tests.event-lane.tag-conflict.event",
      tags: [
        globalTags.eventLane.with({ lane: eventLaneDefinition }),
        globalTags.rpcLane.with({ lane: rpcLaneDefinition }),
      ],
    };
    const store = createStore({ events: [event] });

    expect(() => resolveEventLaneAssignments(store, [])).toThrow(
      'Event "tests.event-lane.tag-conflict.event" cannot be assigned to eventLane "lane.tagged" because it is already assigned to an rpcLane.',
    );
  });

  it("allows duplicate function applyTo declarations when they use the same lane id", () => {
    const event = { id: "tests.event-lane.same-id.function.event", tags: [] };
    const store = createStore({ events: [event] });
    const lanes = [
      eventLane("lane.same", () => true),
      eventLane("lane.same", () => true),
    ];

    const routes = resolveEventLaneAssignments(store, lanes);
    expect(routes.get(event.id)?.lane.id).toBe("lane.same");
  });

  it("allows duplicate id-list applyTo declarations when they use the same lane id", () => {
    const event = { id: "tests.event-lane.same-id.list.event", tags: [] };
    const store = createStore({ events: [event] });
    const lanes = [
      eventLane("lane.same", [event.id]),
      eventLane("lane.same", [event.id]),
    ];

    const routes = resolveEventLaneAssignments(store, lanes);
    expect(routes.get(event.id)?.lane.id).toBe("lane.same");
  });

  it("collects rpc applyTo function targets selectively", () => {
    const selected = { id: "tests.event-lane.rpc-select.selected" };
    const ignored = { id: "tests.event-lane.rpc-select.ignored" };
    const eventLaneDefinition = eventLane("lane.tagged");

    const store = createStore({
      events: [
        {
          id: selected.id,
          tags: [globalTags.eventLane.with({ lane: eventLaneDefinition })],
        },
        {
          id: ignored.id,
          tags: [globalTags.eventLane.with({ lane: eventLaneDefinition })],
        },
      ],
      rpcTopology: {
        profiles: {
          client: {
            serve: [
              rpcLane("rpc.selective", (target) => target.id === selected.id),
            ],
          },
        },
        bindings: [],
      },
    });

    const routes = resolveEventLaneAssignments(store, []);
    expect(routes.has(selected.id)).toBe(false);
    expect(routes.get(ignored.id)?.lane.id).toBe("lane.tagged");
  });
});
