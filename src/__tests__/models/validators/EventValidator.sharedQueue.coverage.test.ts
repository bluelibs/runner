import { eventLaneSharedQueuePartialConsumeError } from "../../../errors";
import { defineResource } from "../../../define";
import { validateEventConstraints } from "../../../models/validators";
import type { ValidatorContext } from "../../../models/validators/ValidatorContext";
import { r } from "../../..";

function createContext(input?: {
  resources?: Array<{ resource: { id: string }; config: unknown }>;
}): ValidatorContext {
  const registry = {
    events: new Map(),
    hooks: new Map(),
    resources: new Map(
      (input?.resources ?? []).map((entry) => [entry.resource.id, entry]),
    ),
  } as unknown as ValidatorContext["registry"];

  return {
    registry,
    resolveReferenceId(reference: unknown) {
      return typeof reference === "string"
        ? reference
        : ((reference as { id?: string }).id ?? null);
    },
    findIdByDefinition(reference: unknown) {
      return typeof reference === "string"
        ? reference
        : (reference as { id: string }).id;
    },
  } as ValidatorContext;
}

describe("EventValidator shared queue coverage", () => {
  it("fails fast when a profile consumes only part of a shared queue lane set", () => {
    const laneA = r
      .eventLane("tests-event-validator-shared-queue-lane-a")
      .build();
    const laneB = r
      .eventLane("tests-event-validator-shared-queue-lane-b")
      .build();
    const sharedQueue = { kind: "queue" };

    expect(() =>
      validateEventConstraints(
        createContext({
          resources: [
            {
              resource: { id: "eventLanes" },
              config: {
                topology: {
                  profiles: {
                    worker: {
                      consume: [{ lane: laneA }],
                    },
                  },
                  bindings: [
                    { lane: laneA, queue: sharedQueue },
                    { lane: laneB, queue: sharedQueue },
                  ],
                },
              },
            },
          ],
        }),
      ),
    ).toThrow(
      eventLaneSharedQueuePartialConsumeError.new({
        resourceId: "app.eventLanes",
        profile: "worker",
        queueSource: "binding.queue",
        consumedLaneIds: [laneA.id],
        queueLaneIds: [laneA.id, laneB.id],
      }).message,
    );
  });

  it("ignores incomplete bindings and unbound consumes", () => {
    const laneA = r
      .eventLane("tests-event-validator-shared-queue-incomplete-lane-a")
      .build();
    const sharedQueue = { kind: "queue" };

    expect(() =>
      validateEventConstraints(
        createContext({
          resources: [
            {
              resource: { id: "eventLanes" },
              config: {
                topology: {
                  profiles: {
                    worker: {
                      consume: [
                        { lane: laneA },
                        { lane: {} as { id?: string } },
                      ],
                    },
                  },
                  bindings: [
                    { lane: laneA },
                    { lane: {} as { id?: string }, queue: sharedQueue },
                  ],
                },
              },
            },
          ],
        }),
      ),
    ).not.toThrow();
  });

  it("allows a profile to consume every lane bound to a shared queue", () => {
    const laneA = r
      .eventLane("tests-event-validator-shared-queue-allowed-lane-a")
      .build();
    const laneB = r
      .eventLane("tests-event-validator-shared-queue-allowed-lane-b")
      .build();
    const sharedQueue = { kind: "queue" };

    expect(() =>
      validateEventConstraints(
        createContext({
          resources: [
            {
              resource: { id: "app.eventLanes" },
              config: {
                topology: {
                  profiles: {
                    worker: {
                      consume: [{ lane: laneA }, { lane: laneB }],
                    },
                  },
                  bindings: [
                    { lane: laneA, queue: sharedQueue },
                    { lane: laneB, queue: sharedQueue },
                  ],
                },
              },
            },
          ],
        }),
      ),
    ).not.toThrow();
  });

  it("uses the resource id when a shared queue is provided by a queue resource", () => {
    const laneA = r
      .eventLane("tests-event-validator-resource-queue-lane-a")
      .build();
    const laneB = r
      .eventLane("tests-event-validator-resource-queue-lane-b")
      .build();
    const queueResource = defineResource({
      id: "sharedQueueResource",
      init: async () => null,
    });

    expect(() =>
      validateEventConstraints(
        createContext({
          resources: [
            {
              resource: { id: "app.eventLanes" },
              config: {
                topology: {
                  profiles: {
                    worker: {
                      consume: [{ lane: laneA }],
                    },
                  },
                  bindings: [
                    { lane: laneA, queue: queueResource },
                    { lane: laneB, queue: queueResource },
                  ],
                },
              },
            },
          ],
        }),
      ),
    ).toThrow(
      eventLaneSharedQueuePartialConsumeError.new({
        resourceId: "app.eventLanes",
        profile: "worker",
        queueSource: queueResource.id,
        consumedLaneIds: [laneA.id],
        queueLaneIds: [laneA.id, laneB.id],
      }).message,
    );
  });

  it("uses the queue constructor name when a shared queue instance is class-backed", () => {
    const laneA = r
      .eventLane("tests-event-validator-class-queue-lane-a")
      .build();
    const laneB = r
      .eventLane("tests-event-validator-class-queue-lane-b")
      .build();

    class NamedQueue {}

    const sharedQueue = new NamedQueue();

    expect(() =>
      validateEventConstraints(
        createContext({
          resources: [
            {
              resource: { id: "app.eventLanes" },
              config: {
                topology: {
                  profiles: {
                    worker: {
                      consume: [{ lane: laneA }],
                    },
                  },
                  bindings: [
                    { lane: laneA, queue: sharedQueue },
                    { lane: laneB, queue: sharedQueue },
                  ],
                },
              },
            },
          ],
        }),
      ),
    ).toThrow(
      eventLaneSharedQueuePartialConsumeError.new({
        resourceId: "app.eventLanes",
        profile: "worker",
        queueSource: "NamedQueue",
        consumedLaneIds: [laneA.id],
        queueLaneIds: [laneA.id, laneB.id],
      }).message,
    );
  });

  it("falls back to an unknown queue label when queue identity cannot be re-matched", () => {
    const laneA = r
      .eventLane("tests-event-validator-unknown-queue-lane-a")
      .build();
    const laneB = r
      .eventLane("tests-event-validator-unknown-queue-lane-b")
      .build();
    const queueResource = defineResource({
      id: "unstableSharedQueueResource",
      init: async () => null,
    });

    const registry = {
      events: new Map(),
      hooks: new Map(),
      resources: new Map([
        [
          "app.eventLanes",
          {
            resource: { id: "app.eventLanes" },
            config: {
              topology: {
                profiles: {
                  worker: {
                    consume: [{ lane: laneA }],
                  },
                },
                bindings: [
                  { lane: laneA, queue: queueResource },
                  { lane: laneB, queue: queueResource },
                ],
              },
            },
          },
        ],
      ]),
    } as unknown as ValidatorContext["registry"];

    let queueIdentityCalls = 0;
    const ctx = {
      registry,
      resolveReferenceId: () => null,
      findIdByDefinition(reference: unknown) {
        if (reference === queueResource) {
          queueIdentityCalls += 1;
          return queueIdentityCalls <= 2 ? "queue-A" : "queue-B";
        }
        return (reference as { id: string }).id;
      },
    } as unknown as ValidatorContext;

    expect(() => validateEventConstraints(ctx)).toThrow(
      eventLaneSharedQueuePartialConsumeError.new({
        resourceId: "app.eventLanes",
        profile: "worker",
        queueSource: "unknown queue",
        consumedLaneIds: [laneA.id],
        queueLaneIds: [laneA.id, laneB.id],
      }).message,
    );
  });
});
