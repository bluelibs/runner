import type { IEventLaneDefinition, IRpcLaneDefinition } from "../../../defs";
import { globalTags } from "../../../globals/globalTags";
import type { Store } from "../../../models/store/Store";
import { resolveEventLaneAssignments } from "../../event-lanes/EventLaneAssignments";
import { RPC_LANES_RESOURCE_ID } from "../../rpc-lanes/rpcLanes.resource";

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
    resources.set(RPC_LANES_RESOURCE_ID, {
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
    findIdByDefinition: (reference: unknown) =>
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
    const event = { id: "assign-event" };
    const store = createStore({ events: [event] });
    const lanes = [
      eventLane("lane.a", () => true),
      eventLane("lane.b", () => true),
    ];

    expect(() => resolveEventLaneAssignments(store, lanes)).toThrow(
      'Event "assign-event" is already assigned to eventLane "lane.a". Cannot also assign eventLane "lane.b" via applyTo().',
    );
  });

  it("fails when two id-list lanes target the same event", () => {
    const event = { id: "assign-by-id-event" };
    const store = createStore({ events: [event] });
    const lanes = [
      eventLane("lane.a", [event.id]),
      eventLane("lane.b", [event.id]),
    ];

    expect(() => resolveEventLaneAssignments(store, lanes)).toThrow(
      'Event "assign-by-id-event" is already assigned to eventLane "lane.a". Cannot also assign eventLane "lane.b" via applyTo().',
    );
  });

  it("fails fast when applyTo is not a function or array", () => {
    const store = createStore({ events: [{ id: "invalid-event" }] });
    const lanes = [eventLane("lane.invalid", 42 as unknown as string[])];

    expect(() => resolveEventLaneAssignments(store, lanes)).toThrow(
      'eventLane "lane.invalid" applyTo() received an invalid target. Expected an event or non-empty id string.',
    );
  });

  it("does not resolve deprecated eventLane tags as routes", () => {
    const eventLaneDefinition = eventLane("lane.tagged");
    const event = {
      id: "tests-event-lane-tag-skip-event",
      tags: [globalTags.eventLane.with({ lane: eventLaneDefinition })],
    };
    const store = createStore({ events: [event] });

    const routes = resolveEventLaneAssignments(store, []);
    expect(routes.has(event.id)).toBe(false);
  });

  it("throws when eventLane applyTo targets an event already assigned to rpcLane applyTo", () => {
    const event = {
      id: "applyto-conflict-event",
    };
    const store = createStore({
      events: [event],
      rpcTopology: {
        profiles: {
          client: {
            serve: [rpcLane("rpc.tagged", [event.id])],
          },
        },
        bindings: [],
      },
    });

    expect(() =>
      resolveEventLaneAssignments(store, [
        eventLane("lane.tagged", [event.id]),
      ]),
    ).toThrow(
      'Event "applyto-conflict-event" cannot be assigned to eventLane "lane.tagged" because it is already assigned to an rpcLane.',
    );
  });

  it("allows duplicate function applyTo declarations when they use the same lane id", () => {
    const event = { id: "tests-event-lane-same-id-function-event", tags: [] };
    const store = createStore({ events: [event] });
    const lanes = [
      eventLane("lane.same", () => true),
      eventLane("lane.same", () => true),
    ];

    const routes = resolveEventLaneAssignments(store, lanes);
    expect(routes.get(event.id)?.lane.id).toBe("lane.same");
  });

  it("allows duplicate id-list applyTo declarations when they use the same lane id", () => {
    const event = { id: "tests-event-lane-same-id-list-event", tags: [] };
    const store = createStore({ events: [event] });
    const lanes = [
      eventLane("lane.same", [event.id]),
      eventLane("lane.same", [event.id]),
    ];

    const routes = resolveEventLaneAssignments(store, lanes);
    expect(routes.get(event.id)?.lane.id).toBe("lane.same");
  });

  it("resolves selective applyTo routes without considering deprecated tags", () => {
    const selected = { id: "tests-event-lane-select-selected" };
    const ignored = { id: "tests-event-lane-select-ignored" };
    const store = createStore({
      events: [
        selected,
        {
          id: ignored.id,
          tags: [globalTags.eventLane.with({ lane: eventLane("lane.legacy") })],
        },
      ],
    });

    const routes = resolveEventLaneAssignments(store, [
      eventLane("lane.selective", (target) => target.id === selected.id),
    ]);
    expect(routes.get(selected.id)?.lane.id).toBe("lane.selective");
    expect(routes.has(ignored.id)).toBe(false);
  });
});
