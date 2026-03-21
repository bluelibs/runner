import {
  assignLaneTargetOrThrow,
  collectCrossLaneApplyToEventIds,
} from "../../remote-lanes/laneAssignmentUtils";
import { rpcLanesResource } from "../../rpc-lanes/rpcLanes.resource";

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

  it("requires exact event ids when collecting cross-lane event ids", () => {
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
      "app.resources.rpc",
      (topology) =>
        (
          topology as {
            bindings: Array<{ lane: { applyTo?: unknown } }>;
          }
        ).bindings.map((binding) => binding.lane),
    );

    expect(eventIds.size).toBe(0);
  });

  it("resolves configured resource definitions through the store lookup", () => {
    const eventIds = collectCrossLaneApplyToEventIds(
      {
        resources: new Map([
          [
            "app.rpcLanes",
            {
              resource: { id: "app.rpcLanes" },
              config: {
                topology: {
                  bindings: [
                    {
                      lane: {
                        applyTo: ["app.events.user.created"],
                      },
                    },
                  ],
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
        ]),
        hasDefinition: (reference: unknown) => reference === rpcLanesResource,
        findIdByDefinition: (reference: unknown) =>
          reference === rpcLanesResource ? "app.rpcLanes" : String(reference),
      } as any,
      rpcLanesResource,
      (topology) =>
        (
          topology as {
            bindings: Array<{ lane: { applyTo?: unknown } }>;
          }
        ).bindings.map((binding) => binding.lane),
    );

    expect(Array.from(eventIds)).toEqual(["app.events.user.created"]);
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

  it("ignores unresolved non-string resource references", () => {
    const eventIds = collectCrossLaneApplyToEventIds(
      {
        resources: new Map(),
        events: new Map(),
      } as any,
      { resource: "rpcLanes" },
      () => [],
    );

    expect(eventIds.size).toBe(0);
  });
});
