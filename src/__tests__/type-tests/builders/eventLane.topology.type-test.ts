import { r } from "../../..";

{
  const laneA = r.eventLane("types-event-lane-topology-a").build();

  r.eventLane.topology({
    profiles: {
      worker: { consume: [{ lane: laneA }] },
    },
    bindings: [{ lane: laneA, queue: { id: "queue-a" } }],
  });

  r.eventLane.topology({
    profiles: {
      worker: {
        // @ts-expect-error consume expects object entries, not plain strings.
        consume: ["types-event-lane-topology-a"],
      },
    },
    bindings: [{ lane: laneA, queue: { id: "queue-a" } }],
  });

  r.eventLane.topology({
    profiles: {
      worker: { consume: [{ lane: laneA }] },
    },
    bindings: [
      {
        // @ts-expect-error each binding must include a lane reference.
        queue: { id: "queue-a" },
      },
    ],
  });

  r.eventLane.topology({
    profiles: {
      worker: {
        // @ts-expect-error consume entries require a lane field.
        consume: [{}],
      },
    },
    bindings: [{ lane: laneA, queue: { id: "queue-a" } }],
  });

  {
    const event = r.event("types-event-lane-topology-hook-event").build();
    const hook = r
      .hook("types-event-lane-topology-hook")
      .on(event)
      .run(async () => {})
      .build();

    r.eventLane.topology({
      profiles: {
        worker: {
          consume: [{ lane: laneA, hooks: { only: [hook] } }],
        },
      },
      bindings: [{ lane: laneA, queue: { id: "queue-a" } }],
    });
  }

  r.eventLane.topology({
    profiles: {
      worker: {
        consume: [
          {
            lane: laneA,
            hooks: {
              // @ts-expect-error hooks.only expects hook references.
              only: ["hook-id"],
            },
          },
        ],
      },
    },
    bindings: [{ lane: laneA, queue: { id: "queue-a" } }],
  });
}
