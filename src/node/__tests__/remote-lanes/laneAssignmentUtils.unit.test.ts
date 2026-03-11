import { collectCrossLaneApplyToEventIds } from "../../remote-lanes/laneAssignmentUtils";

describe("laneAssignmentUtils", () => {
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
});
