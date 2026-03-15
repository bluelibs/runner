import { isRelayEmission } from "../../event-lanes/EventLanesInternals";

describe("EventLanesInternals", () => {
  it("detects relay emissions from source ids when paths are absent", () => {
    expect(
      isRelayEmission(
        {
          id: "event.alpha",
          data: {},
          timestamp: new Date(),
          signal: new AbortController().signal,
          source: {
            kind: "runtime",
            id: "relay:raw-source",
          },
          meta: {},
          transactional: false,
          stopPropagation() {},
          isPropagationStopped() {
            return false;
          },
          tags: [],
        },
        "relay:",
      ),
    ).toBe(true);
  });
});
