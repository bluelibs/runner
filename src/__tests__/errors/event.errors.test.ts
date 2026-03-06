import { eventCycleError } from "../../errors";

describe("event errors", () => {
  it("formats event cycles with source ids when source paths are absent", () => {
    const error = eventCycleError.create({
      path: [
        {
          id: "event.alpha",
          source: {
            kind: "runtime",
            id: "relay.raw-source",
          },
        },
      ],
    });

    expect(error.message).toContain("event.alpha<-runtime:relay.raw-source");
  });
});
