import type {
  IEventLaneDefinition,
  IEventDefinition,
  IRpcLaneDefinition,
} from "../../../defs";
import { globalTags } from "../../../globals/globalTags";
import type { Store } from "../../../models/store/Store";
import { resolveRpcLaneAssignments } from "../../rpc-lanes/RpcLaneAssignments";
import { EVENT_LANES_RESOURCE_ID } from "../../event-lanes/eventLanes.resource";

type EventShape = {
  id: string;
  tags?: unknown[];
};

type TaskShape = {
  id: string;
  tags?: unknown[];
};

function createStore(
  options: {
    events?: EventShape[];
    tasks?: TaskShape[];
    eventTopology?: unknown;
  } = {},
): Store {
  const resources = new Map<string, { config?: unknown }>();
  if (options.eventTopology) {
    resources.set(EVENT_LANES_RESOURCE_ID, {
      config: { topology: options.eventTopology },
    });
  }

  return {
    events: new Map(
      (options.events ?? []).map((event) => [event.id, { event }]),
    ),
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

function rpcLane(
  id: string,
  applyTo?: IRpcLaneDefinition["applyTo"],
): IRpcLaneDefinition {
  return { id, applyTo };
}

function eventLane(
  id: string,
  applyTo?: IEventLaneDefinition["applyTo"],
): IEventLaneDefinition {
  return { id, applyTo };
}

describe("RpcLaneAssignments", () => {
  it("fails when two rpc lanes assign the same task id", () => {
    const task = { id: "tests-rpc-lane-assignments-task" };
    const store = createStore({ tasks: [task] });
    const lanes = [rpcLane("rpc.a", [task.id]), rpcLane("rpc.b", [task.id])];

    expect(() => resolveRpcLaneAssignments(store, lanes)).toThrow(
      'Task "tests-rpc-lane-assignments-task" is already assigned to rpcLane "rpc.a". Cannot also assign rpcLane "rpc.b" via applyTo().',
    );
  });

  it("fails fast when rpc applyTo is not a function or array", () => {
    const store = createStore();
    const lanes = [rpcLane("rpc.invalid", 42 as unknown as string[])];

    expect(() => resolveRpcLaneAssignments(store, lanes)).toThrow(
      'rpcLane "rpc.invalid" applyTo() received an invalid target. Expected a task, event, or non-empty id string.',
    );
  });

  it("skips rpc event-tag routing when event-lane applyTo explicitly owns the event", () => {
    const rpcTagLane = rpcLane("rpc.tagged");
    const event = {
      id: "tests-rpc-lane-tag-skip-event",
      tags: [globalTags.rpcLane.with({ lane: rpcTagLane })],
    };
    const eventFunctionLane = eventLane(
      "event.func",
      (target: IEventDefinition<any>) => target.id === event.id,
    );
    const eventInvalidLane = eventLane("event.invalid-shape", {
      bad: true,
    } as unknown as string[]);
    const store = createStore({
      events: [event],
      eventTopology: {
        profiles: {
          worker: {
            consume: [{ lane: eventFunctionLane }, { lane: eventInvalidLane }],
          },
        },
        bindings: [],
      },
    });

    const assignments = resolveRpcLaneAssignments(store, []);
    expect(assignments.eventLaneByEventId.has(event.id)).toBe(false);
  });

  it("ignores deprecated event-lane tags when resolving rpc tag assignments", () => {
    const rpcTagLane = rpcLane("rpc.tagged");
    const eventTagLane = eventLane("event.tagged");
    const event = {
      id: "tests-rpc-lane-tag-conflict-event",
      tags: [
        globalTags.rpcLane.with({ lane: rpcTagLane }),
        globalTags.eventLane.with({ lane: eventTagLane }),
      ],
    };
    const store = createStore({ events: [event] });

    const assignments = resolveRpcLaneAssignments(store, []);
    expect(assignments.eventLaneByEventId.get(event.id)?.id).toBe("rpc.tagged");
  });

  it("allows duplicate task applyTo declarations when they use the same lane id", () => {
    const task = { id: "tests-rpc-lane-same-id-task", tags: [] };
    const store = createStore({ tasks: [task] });
    const lanes = [
      rpcLane("rpc.same", [task.id]),
      rpcLane("rpc.same", [task.id]),
    ];

    const assignments = resolveRpcLaneAssignments(store, lanes);
    expect(assignments.taskLaneByTaskId.get(task.id)?.id).toBe("rpc.same");
  });

  it("allows duplicate event applyTo declarations when they use the same lane id", () => {
    const event = { id: "tests-rpc-lane-same-id-event", tags: [] };
    const store = createStore({ events: [event] });
    const lanes = [
      rpcLane("rpc.same", [event.id]),
      rpcLane("rpc.same", [event.id]),
    ];

    const assignments = resolveRpcLaneAssignments(store, lanes);
    expect(assignments.eventLaneByEventId.get(event.id)?.id).toBe("rpc.same");
  });

  it("collects event-lane applyTo function targets selectively", () => {
    const rpcLaneDefinition = rpcLane("rpc.tagged");
    const selected = {
      id: "tests-rpc-lane-event-selective-selected",
      tags: [globalTags.rpcLane.with({ lane: rpcLaneDefinition })],
    };
    const ignored = {
      id: "tests-rpc-lane-event-selective-ignored",
      tags: [globalTags.rpcLane.with({ lane: rpcLaneDefinition })],
    };
    const eventFunctionLane = eventLane(
      "event.selective",
      (target: IEventDefinition<any>) => target.id === selected.id,
    );

    const store = createStore({
      events: [selected, ignored],
      eventTopology: {
        profiles: {
          worker: { consume: [{ lane: eventFunctionLane }] },
        },
        bindings: [],
      },
    });

    const assignments = resolveRpcLaneAssignments(store, []);
    expect(assignments.eventLaneByEventId.has(selected.id)).toBe(false);
    expect(assignments.eventLaneByEventId.get(ignored.id)?.id).toBe(
      "rpc.tagged",
    );
  });
});
