import {
  assignLaneTargetOrThrow,
  collectCrossLaneApplyToEventIds,
} from "../../remote-lanes/laneAssignmentUtils";

describe("laneAssignmentUtils", () => {
  it("uses the raw resource id fallback when canonical resolution returns null", () => {
    const eventIds = collectCrossLaneApplyToEventIds(
      {
        resources: new Map([
          [
            "",
            {
              resource: { id: "" },
              config: {
                topology: {
                  bindings: [],
                },
              },
            },
          ],
        ]),
        events: new Map(),
      } as any,
      "",
      (topology) =>
        (
          topology as {
            bindings: Array<{ lane: { applyTo?: unknown } }>;
          }
        ).bindings.map((binding) => binding.lane),
    );

    expect(eventIds.size).toBe(0);
  });

  it("ignores valid non-event applyTo targets when collecting cross-lane event ids", () => {
    const taskId = "lane-assignment.coverage.task";
    const eventIds = collectCrossLaneApplyToEventIds(
      {
        resources: new Map([
          [
            "platform.node.resources.other",
            {
              config: {
                topology: {
                  bindings: [
                    {
                      lane: {
                        applyTo: [{ id: taskId }],
                      },
                    },
                  ],
                },
              },
            },
          ],
        ]),
        events: new Map(),
      } as any,
      "platform.node.resources.other",
      (topology) =>
        (
          topology as {
            bindings: Array<{ lane: { applyTo?: unknown } }>;
          }
        ).bindings.map((binding) => binding.lane),
    );

    expect(eventIds.size).toBe(0);
  });

  it("resolves a uniquely suffix-matched event id from applyTo", () => {
    const canonicalEventId = "app.events.user.created";
    const eventIds = collectCrossLaneApplyToEventIds(
      {
        resources: new Map([
          [
            "app.resources.rpc",
            {
              resource: { id: "app.resources.rpc" },
              config: {
                topology: {
                  bindings: [{ lane: { applyTo: ["created"] } }],
                },
              },
            },
          ],
        ]),
        events: new Map([
          [canonicalEventId, { event: { id: canonicalEventId } }],
        ]),
      } as any,
      "rpc",
      (topology) =>
        (
          topology as {
            bindings: Array<{ lane: { applyTo?: unknown } }>;
          }
        ).bindings.map((binding) => binding.lane),
    );

    expect(Array.from(eventIds)).toEqual([canonicalEventId]);
  });

  it("skips ambiguous suffix-matches when more than one event could match", () => {
    const eventIds = collectCrossLaneApplyToEventIds(
      {
        resources: new Map([
          [
            "resource",
            {
              resource: { id: "resource" },
              config: {
                topology: {
                  bindings: [{ lane: { applyTo: ["created"] } }],
                },
              },
            },
          ],
        ]),
        events: new Map([
          [
            "app.events.user.created",
            { event: { id: "app.events.user.created" } },
          ],
          [
            "app.events.audit.created",
            { event: { id: "app.events.audit.created" } },
          ],
        ]),
      } as any,
      "resource",
      (topology) =>
        (
          topology as {
            bindings: Array<{ lane: { applyTo?: unknown } }>;
          }
        ).bindings.map((binding) => binding.lane),
    );

    expect(eventIds.size).toBe(0);
  });

  it("falls back to raw target ids when canonical resolution returns null", () => {
    const conflictError = {
      throw: jest.fn((_data: unknown) => {
        throw new Error("conflict");
      }),
    };

    expect(() =>
      assignLaneTargetOrThrow({
        assignments: new Map([["", { id: "lane-a" }]]),
        targetId: "",
        lane: { id: "lane-b" },
        store: {} as any,
        targetField: "eventId",
        conflictError: conflictError as any,
      }),
    ).toThrow("conflict");

    expect(conflictError.throw).toHaveBeenCalledWith({
      eventId: "",
      currentLaneId: "lane-a",
      attemptedLaneId: "lane-b",
    });
  });
});
