import type {
  IEventLaneDefinition,
  IEventDefinition,
  IRpcLaneDefinition,
} from "../../../defs";
import { globalTags } from "../../../globals/globalTags";
import type { Store } from "../../../models/Store";
import { resolveRpcLaneAssignments } from "../../rpc-lanes/RpcLaneAssignments";

type EventShape = {
  id: string;
  tags?: unknown[];
};

type TaskShape = {
  id: string;
  tags?: unknown[];
};

function createStore(options: {
  events?: EventShape[];
  tasks?: TaskShape[];
  eventTopology?: unknown;
} = {}): Store {
  const resources = new Map<string, { config?: unknown }>();
  if (options.eventTopology) {
    resources.set("globals.resources.node.eventLanes", {
      config: { topology: options.eventTopology },
    });
  }

  return {
    events: new Map(
      (options.events ?? []).map((event) => [event.id, { event }]),
    ),
    tasks: new Map(
      (options.tasks ?? []).map((task) => [task.id, { task }]),
    ),
    resources,
    hooks: new Map(),
    taskMiddlewares: new Map(),
    resourceMiddlewares: new Map(),
    errors: new Map(),
    tags: new Map(),
    asyncContexts: new Map(),
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
    const task = { id: "tests.rpc-lane.assignments.task" };
    const store = createStore({ tasks: [task] });
    const lanes = [
      rpcLane("rpc.a", [task.id]),
      rpcLane("rpc.b", [task.id]),
    ];

    expect(() => resolveRpcLaneAssignments(store, lanes)).toThrow(
      'Task "tests.rpc-lane.assignments.task" is already assigned to rpcLane "rpc.a". Cannot also assign rpcLane "rpc.b" via applyTo().',
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
      id: "tests.rpc-lane.tag-skip.event",
      tags: [globalTags.rpcLane.with({ lane: rpcTagLane })],
    };
    const eventFunctionLane = eventLane(
      "event.func",
      (target: IEventDefinition<any>) => target.id === event.id,
    );
    const eventInvalidLane = eventLane(
      "event.invalid-shape",
      { bad: true } as unknown as string[],
    );
    const store = createStore({
      events: [event],
      eventTopology: {
        profiles: { worker: { consume: [eventFunctionLane, eventInvalidLane] } },
        bindings: [],
      },
    });

    const assignments = resolveRpcLaneAssignments(store, []);
    expect(assignments.eventLaneByEventId.has(event.id)).toBe(false);
  });

  it("throws when event has both rpc-lane and event-lane tags without explicit applyTo ownership", () => {
    const rpcTagLane = rpcLane("rpc.tagged");
    const eventTagLane = eventLane("event.tagged");
    const event = {
      id: "tests.rpc-lane.tag-conflict.event",
      tags: [
        globalTags.rpcLane.with({ lane: rpcTagLane }),
        globalTags.eventLane.with({ lane: eventTagLane }),
      ],
    };
    const store = createStore({ events: [event] });

    expect(() => resolveRpcLaneAssignments(store, [])).toThrow(
      'Event "tests.rpc-lane.tag-conflict.event" cannot be assigned to rpcLane "rpc.tagged" because it is already assigned to an event lane.',
    );
  });
});
