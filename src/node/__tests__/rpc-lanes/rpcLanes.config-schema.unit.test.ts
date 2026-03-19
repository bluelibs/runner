import { defineResource } from "../../../define";
import { matchError } from "../../../errors/foundation/match.errors";
import { rpcLanesResourceConfigSchema } from "../../rpc-lanes/configSchema";

function expectMatchFailure(run: () => unknown): void {
  try {
    run();
    throw new Error("Expected matchError");
  } catch (error) {
    expect(matchError.is(error)).toBe(true);
  }
}

describe("rpcLanes resource config schema", () => {
  it("accepts valid rpc-lanes config shape", () => {
    const lane = { id: "lane-valid" };
    const serializer = defineResource({
      id: "tests-rpc-lanes-schema-serializer",
      init: async () => ({
        stringify: JSON.stringify,
        parse: JSON.parse,
      }),
    });
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
      serializer,
      mode: "network" as const,
      exposure: {
        http: {
          basePath: "/runner",
        },
      },
    };

    expect(rpcLanesResourceConfigSchema.parse(config)).toEqual(config);
  });

  it("rejects invalid serializer resource shapes", () => {
    const lane = { id: "lane-invalid-serializer" };

    expectMatchFailure(() =>
      rpcLanesResourceConfigSchema.parse({
        profile: "client",
        topology: {
          profiles: {
            client: { serve: [lane] },
          },
          bindings: [{ lane, communicator: { id: "communicator-resource" } }],
        },
        serializer: { nope: true },
      } as never),
    );
  });

  it("rejects serializer resources configured via .with(...)", () => {
    const lane = { id: "lane-configured-serializer" };
    const serializer = defineResource({
      id: "tests-rpc-lanes-schema-configured-serializer",
      init: async (config: { pretty: boolean }) => ({
        stringify: (value: unknown) =>
          JSON.stringify(value, null, config.pretty ? 2 : 0),
        parse: JSON.parse,
      }),
    });
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
      serializer: serializer.with({ pretty: true }),
    };

    expectMatchFailure(() =>
      rpcLanesResourceConfigSchema.parse(config as never),
    );
  });

  it("rejects invalid mode values", () => {
    const lane = { id: "lane-invalid-mode" };

    expectMatchFailure(() =>
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
    );
  });

  it("rejects invalid binding lane shapes", () => {
    expectMatchFailure(() =>
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
    );
  });

  it("rejects invalid profiles shape", () => {
    const lane = { id: "lane-invalid-profile" };

    expectMatchFailure(() =>
      rpcLanesResourceConfigSchema.parse({
        profile: "client",
        topology: {
          profiles: ["client"],
          bindings: [{ lane, communicator: { id: "communicator-resource" } }],
        },
      } as never),
    );
  });

  it("rejects invalid profile entries", () => {
    const lane = { id: "lane-invalid-profile-entry" };

    expectMatchFailure(() =>
      rpcLanesResourceConfigSchema.parse({
        profile: "client",
        topology: {
          profiles: {
            client: { serve: "lane-invalid-profile-entry" },
          },
          bindings: [{ lane, communicator: { id: "communicator-resource" } }],
        },
      } as never),
    );
  });
});
