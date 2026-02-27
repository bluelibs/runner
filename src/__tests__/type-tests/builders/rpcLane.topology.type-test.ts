import { r } from "../../..";

{
  const laneA = r.rpcLane("types.rpc-lane.topology.a").build();
  const laneB = r.rpcLane("types.rpc-lane.topology.b").build();

  const communicator = r
    .resource("types.rpc-lane.communicator")
    .init(async () => ({
      task: async () => 1,
    }))
    .build();

  r.rpcLane.topology({
    profiles: {
      api: { serve: [laneB] },
    },
    bindings: [{ lane: laneA, communicator }],
  });

  r.rpcLane.topology({
    profiles: {
      api: {
        // @ts-expect-error serve expects rpc lane references, not plain strings.
        serve: ["types.rpc-lane.topology.a"],
      },
    },
    bindings: [{ lane: laneA, communicator }],
  });

  r.rpcLane.topology({
    profiles: {
      api: {
        serve: [laneA],
      },
    },
    bindings: [{ lane: laneA, communicator }],
  });

  r.rpcLane.topology({
    profiles: {
      api: {
        serve: [laneA],
      },
    },
    bindings: [{ lane: laneA, communicator }],
  });

  r.rpcLane.topology({
    profiles: {
      api: {
        serve: [laneA],
      },
    },
    bindings: [{ lane: laneA, communicator }],
  });

  r.task("types.rpc-lane.tag-task")
    .tags([r.tag("types.rpc-lane.custom-tag").for("tasks").build()])
    .run(async () => 1)
    .build();

  const rpcTag = r
    .tag<{ lane: typeof laneA }, void, void, "tasks">("types.rpc-lane.tag")
    .for("tasks")
    .build();

  r.task("types.rpc-lane.allowed-tag")
    .tags([rpcTag.with({ lane: laneA })])
    .run(async () => 1)
    .build();

  r.resource("types.rpc-lane.forbidden-tag")
    // @ts-expect-error task-only rpc tags cannot be attached to resources.
    .tags([rpcTag.with({ lane: laneA })])
    .build();
}
