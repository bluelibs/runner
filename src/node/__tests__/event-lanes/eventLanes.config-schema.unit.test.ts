import { MatchError } from "../../../tools/check";
import { eventLanesResourceConfigSchema } from "../../event-lanes/configSchema";

describe("eventLanes resource config schema", () => {
  it("accepts valid event-lanes config shape", () => {
    const lane = { id: "lane.valid" };
    const config = {
      profile: "worker",
      topology: {
        profiles: {
          worker: { consume: [lane] },
        },
        bindings: [
          {
            lane,
            queue: {
              enqueue: async () => "id",
              consume: async () => {},
              ack: async () => {},
              nack: async () => {},
            },
          },
        ],
        relaySourcePrefix: "runner.event-lanes.relay:",
      },
      mode: "network" as const,
    };

    expect(eventLanesResourceConfigSchema.parse(config)).toEqual(config);
  });

  it("rejects non-object profiles shape", () => {
    const lane = { id: "lane.invalid.profiles" };

    expect(() =>
      eventLanesResourceConfigSchema.parse({
        profile: "worker",
        topology: {
          profiles: ["worker"],
          bindings: [
            {
              lane,
              queue: {
                enqueue: async () => "id",
                consume: async () => {},
                ack: async () => {},
                nack: async () => {},
              },
            },
          ],
        },
      } as never),
    ).toThrow(MatchError);
  });

  it("rejects profiles entries without consume lane array", () => {
    const lane = { id: "lane.invalid.consume" };

    expect(() =>
      eventLanesResourceConfigSchema.parse({
        profile: "worker",
        topology: {
          profiles: {
            worker: { consume: ["lane-id"] },
          },
          bindings: [
            {
              lane,
              queue: {
                enqueue: async () => "id",
                consume: async () => {},
                ack: async () => {},
                nack: async () => {},
              },
            },
          ],
        },
      } as never),
    ).toThrow(MatchError);
  });
});
