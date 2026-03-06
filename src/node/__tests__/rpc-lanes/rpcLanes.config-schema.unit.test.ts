import { MatchError } from "../../../tools/check";
import { rpcLanesResourceConfigSchema } from "../../rpc-lanes/configSchema";

describe("rpcLanes resource config schema", () => {
  it("accepts valid rpc-lanes config shape", () => {
    const lane = { id: "lane-valid" };
    const config = {
      profile: "client",
      topology: {
        profiles: {
          client: { serve: [lane] },
        },
        bindings: [
          {
            lane,
            communicator: { id: "communicator-resource" },
          },
        ],
      },
      mode: "network" as const,
      exposure: {
        http: {
          basePath: "/runner",
        },
      },
    };

    expect(rpcLanesResourceConfigSchema.parse(config)).toEqual(config);
  });

  it("rejects invalid mode values", () => {
    const lane = { id: "lane-invalid-mode" };

    expect(() =>
      rpcLanesResourceConfigSchema.parse({
        profile: "client",
        topology: {
          profiles: {
            client: { serve: [lane] },
          },
          bindings: [{ lane, communicator: { id: "communicator-resource" } }],
        },
        mode: "unsupported-mode",
      } as never),
    ).toThrow(MatchError);
  });

  it("rejects invalid binding lane shapes", () => {
    expect(() =>
      rpcLanesResourceConfigSchema.parse({
        profile: "client",
        topology: {
          profiles: {
            client: { serve: [] },
          },
          bindings: [
            {
              lane: { id: 123 },
              communicator: { id: "communicator-resource" },
            },
          ],
        },
      } as never),
    ).toThrow(MatchError);
  });

  it("rejects invalid profiles shape", () => {
    const lane = { id: "lane-invalid-profile" };

    expect(() =>
      rpcLanesResourceConfigSchema.parse({
        profile: "client",
        topology: {
          profiles: ["client"],
          bindings: [{ lane, communicator: { id: "communicator-resource" } }],
        },
      } as never),
    ).toThrow(MatchError);
  });

  it("rejects invalid profile entries", () => {
    const lane = { id: "lane-invalid-profile-entry" };

    expect(() =>
      rpcLanesResourceConfigSchema.parse({
        profile: "client",
        topology: {
          profiles: {
            client: { serve: "lane-invalid-profile-entry" },
          },
          bindings: [{ lane, communicator: { id: "communicator-resource" } }],
        },
      } as never),
    ).toThrow(MatchError);
  });
});
