import {
  eventLaneConsumeDuplicateLaneError,
  eventLaneHookPolicyConflictError,
  eventLaneHookPolicyHookReferenceInvalidError,
  eventLaneSharedQueuePartialConsumeError,
} from "../../../errors";
import { globalTags } from "../../../globals/globalTags";
import { defineResource } from "../../../define";
import { validateEventConstraints } from "../../../models/validators";
import type { ValidatorContext } from "../../../models/validators/ValidatorContext";
import { r } from "../../..";

function createContext(input?: {
  events?: Array<{
    event: {
      id: string;
      transactional?: boolean;
      parallel?: boolean;
      tags?: unknown[];
    };
  }>;
  hooks?: Array<{ hook: { id: string; tags?: unknown[] } }>;
  resources?: Array<{ resource: { id: string }; config: unknown }>;
  resolveReferenceId?: (reference: unknown) => string | null;
}): ValidatorContext {
  const registry = {
    events: new Map(
      (input?.events ?? []).map((entry) => [entry.event.id, entry]),
    ),
    hooks: new Map((input?.hooks ?? []).map((entry) => [entry.hook.id, entry])),
    resources: new Map(
      (input?.resources ?? []).map((entry) => [entry.resource.id, entry]),
    ),
  } as unknown as ValidatorContext["registry"];

  return {
    registry,
    resolveReferenceId(reference: unknown) {
      if (input?.resolveReferenceId) {
        return input.resolveReferenceId(reference);
      }

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

describe("EventValidator coverage", () => {
  it("falls back to the generic deprecated hook tag error when hooks.only is absent", () => {
    const event = r.event("tests-event-validator-generic-event").build();
    const lane = r.eventLane("tests-event-validator-generic-lane").build();
    const hook = r
      .hook("tests-event-validator-generic-hook")
      .on(event)
      .tags([globalTags.eventLaneHook.with({ lane })])
      .run(async () => {})
      .build();

    expect(() =>
      validateEventConstraints(
        createContext({
          events: [{ event }],
          hooks: [{ hook }],
          resources: [
            {
              resource: { id: "app.eventLanes" },
              config: {
                topology: {
                  profiles: {
                    worker: {
                      consume: [{ lane }],
                    },
                  },
                },
              },
            },
          ],
        }),
      ),
    ).toThrow(/uses deprecated tag "eventLaneHook"/i);
  });

  it("treats topology hooks.only as a conflict even when some profile data is partial", () => {
    const event = r.event("tests-event-validator-conflict-event").build();
    const lane = r.eventLane("tests-event-validator-conflict-lane").build();
    const hook = r
      .hook("tests-event-validator-conflict-hook")
      .on(event)
      .tags([globalTags.eventLaneHook.with({ lane })])
      .run(async () => {})
      .build();

    expect(() =>
      validateEventConstraints(
        createContext({
          events: [{ event }],
          hooks: [{ hook }],
          resources: [
            {
              resource: { id: "eventLanes" },
              config: {},
            },
            {
              resource: { id: "app.eventLanes" },
              config: {
                topology: {
                  profiles: {
                    worker: {},
                    shadow: {
                      consume: [{ hooks: { only: [] } }],
                    },
                  },
                },
              },
            },
          ],
        }),
      ),
    ).toThrow(
      eventLaneHookPolicyConflictError.new({
        hookId: hook.id,
        tagId: globalTags.eventLaneHook.id,
        profile: "shadow",
        laneId: "unknown",
      }).message,
    );
  });

  it("fails fast when hooks.only references a hook that is not registered", () => {
    const event = r.event("tests-event-validator-unregistered-event").build();
    const lane = r.eventLane("tests-event-validator-unregistered-lane").build();
    const strayHook = r
      .hook("tests-event-validator-unregistered-hook")
      .on(event)
      .run(async () => {})
      .build();

    expect(() =>
      validateEventConstraints(
        createContext({
          events: [{ event }],
          resources: [
            {
              resource: { id: "app.eventLanes" },
              config: {
                topology: {
                  profiles: {
                    worker: {
                      consume: [{ lane, hooks: { only: [strayHook] } }],
                    },
                  },
                },
              },
            },
          ],
        }),
      ),
    ).toThrow(
      eventLaneHookPolicyHookReferenceInvalidError.new({
        resourceId: "app.eventLanes",
        profile: "worker",
        laneId: lane.id,
        hookId: strayHook.id,
      }).message,
    );
  });

  it("allows hooks.only to reference any registered hook regardless of visibility", () => {
    const event = r.event("tests-event-validator-visibility-event").build();
    const lane = r.eventLane("tests-event-validator-visibility-lane").build();
    const hiddenHook = r
      .hook("tests-event-validator-visibility-hook")
      .on(event)
      .run(async () => {})
      .build();

    expect(() =>
      validateEventConstraints(
        createContext({
          events: [{ event }],
          hooks: [{ hook: hiddenHook }],
          resources: [
            {
              resource: { id: "app.eventLanes" },
              config: {
                topology: {
                  profiles: {
                    worker: {
                      consume: [{ lane, hooks: { only: [hiddenHook] } }],
                    },
                  },
                },
              },
            },
          ],
        }),
      ),
    ).not.toThrow();
  });

  it("fails fast when a profile consumes the same lane more than once", () => {
    const lane = r.eventLane("tests-event-validator-duplicate-lane").build();

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
                      consume: [{ lane }, { lane }],
                    },
                  },
                },
              },
            },
          ],
        }),
      ),
    ).toThrow(
      eventLaneConsumeDuplicateLaneError.new({
        resourceId: "app.eventLanes",
        profile: "worker",
        laneId: lane.id,
      }).message,
    );
  });

  it("tolerates partial hooks.only nullish config by normalizing to an empty allowlist", () => {
    const lane = r
      .eventLane("tests-event-validator-nullish-hooks-lane")
      .build();

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
                      consume: [{ lane, hooks: { only: null } }],
                    },
                  },
                },
              },
            },
          ],
        }),
      ),
    ).not.toThrow();
  });

  it("falls back to findIdByDefinition when resolveReferenceId cannot resolve a hook ref", () => {
    const event = r.event("tests-event-validator-fallback-event").build();
    const lane = r.eventLane("tests-event-validator-fallback-lane").build();
    const hook = r
      .hook("tests-event-validator-fallback-hook")
      .on(event)
      .run(async () => {})
      .build();

    expect(() =>
      validateEventConstraints(
        createContext({
          events: [{ event }],
          hooks: [{ hook }],
          resources: [
            {
              resource: { id: "app.eventLanes" },
              config: {
                topology: {
                  profiles: {
                    worker: {
                      consume: [{ lane, hooks: { only: [hook] } }],
                    },
                  },
                },
              },
            },
          ],
          resolveReferenceId: () => null,
        }),
      ),
    ).not.toThrow();
  });

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
        queueSource: "binding.queue",
        consumedLaneIds: [laneA.id],
        queueLaneIds: [laneA.id, laneB.id],
      }).message,
    );
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
});
