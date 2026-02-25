import { r } from "../../..";

{
  const laneA = r.eventLane("types.event-lane.topology.a").build();

  r.eventLane.topology({
    profiles: {
      worker: { consume: [laneA] },
    },
    bindings: [{ lane: laneA, queue: { id: "queue-a" } }],
  });

  r.eventLane.topology({
    profiles: {
      worker: {
        // @ts-expect-error consume expects lane references, not plain strings.
        consume: ["types.event-lane.topology.a"],
      },
    },
    bindings: [{ lane: laneA, queue: { id: "queue-a" } }],
  });

  r.eventLane.topology({
    profiles: {
      worker: { consume: [laneA] },
    },
    bindings: [
      {
        // @ts-expect-error each binding must include a lane reference.
        queue: { id: "queue-a" },
      },
    ],
  });
}
