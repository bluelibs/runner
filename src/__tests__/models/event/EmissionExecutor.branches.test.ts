import { EventEmissionFailureMode } from "../../../defs";
import { executeSequentially } from "../../../models/event/EmissionExecutor";

describe("EmissionExecutor branches", () => {
  it("preserves listener metadata when thrown error already includes it", async () => {
    const error = Object.assign(new Error("boom"), {
      listenerId: "pre-set-listener",
      listenerOrder: 99,
    });

    const report = await executeSequentially({
      listeners: [
        {
          id: "listener.actual",
          order: 1,
          isGlobal: false,
          handler: async () => {
            throw error;
          },
        },
      ],
      event: {
        id: "event.id",
        data: undefined,
        timestamp: new Date(),
        source: "test.source",
        meta: {},
        isPropagationStopped: () => false,
        stopPropagation: () => undefined,
        tags: [],
      },
      failureMode: EventEmissionFailureMode.Aggregate,
    });

    expect(report.failedListeners).toBe(1);
    expect(report.errors[0]?.listenerId).toBe("pre-set-listener");
    expect(report.errors[0]?.listenerOrder).toBe(99);
  });
});
