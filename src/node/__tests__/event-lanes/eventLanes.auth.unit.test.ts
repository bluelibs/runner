import {
  hashRemoteLanePayload,
  issueRemoteLaneToken,
} from "../../remote-lanes/laneAuth";
import {
  collectBindingAuthByLaneId,
  enforceEventLaneAuthReadiness,
  resolveEventLaneBindingAuth,
  verifyEventLaneMessageToken,
} from "../../event-lanes/eventLanes.auth";

function expectRunnerErrorId(fn: () => unknown, errorId: string): void {
  try {
    fn();
    throw new Error(`Expected RunnerError "${errorId}"`);
  } catch (error) {
    const candidate = error as { id?: string; name?: string };
    expect(candidate.id ?? candidate.name).toBe(errorId);
  }
}

describe("eventLanes auth helpers", () => {
  it("resolves binding auth map and fallback lookup", () => {
    const lane = { id: "lane-auth" } as any;
    const resolvedAuth = { secret: "resolved-secret" };
    const config = {
      profile: "p",
      topology: {
        profiles: { p: { consume: [{ lane: lane }] } },
        bindings: [{ lane, queue: {}, auth: { secret: "s1" } }],
      },
    } as any;
    const context = {
      bindingsByLaneId: new Map([[lane.id, { lane, auth: resolvedAuth }]]),
      eventRouteByEventId: new Map(),
    } as any;

    const map = collectBindingAuthByLaneId(config);
    expect(map.get(lane.id)).toEqual({ secret: "s1" });
    expect(
      resolveEventLaneBindingAuth({ laneId: lane.id, context, config }),
    ).toEqual(resolvedAuth);
    expect(
      resolveEventLaneBindingAuth({
        laneId: lane.id,
        context: { ...context, bindingsByLaneId: new Map() },
        config,
      }),
    ).toEqual({ secret: "s1" });
  });

  it("enforces readiness for network/local-simulated and no-ops transparent", () => {
    const lane = { id: "lane-ready" } as any;
    const context = {
      eventRouteByEventId: new Map([["e", { lane }]]),
      activeBindingsByQueue: new Map([[{}, new Set([lane.id])]]),
      bindingsByLaneId: new Map([
        [lane.id, { lane, auth: { secret: "ready-secret" } }],
      ]),
    } as any;
    const config = {
      profile: "p",
      topology: {
        profiles: { p: { consume: [{ lane: lane }] } },
        bindings: [{ lane, queue: {}, auth: { secret: "ready-secret" } }],
      },
    } as any;

    expect(() =>
      enforceEventLaneAuthReadiness({ mode: "transparent", context, config }),
    ).not.toThrow();
    expect(() =>
      enforceEventLaneAuthReadiness({ mode: "network", context, config }),
    ).not.toThrow();
    expect(() =>
      enforceEventLaneAuthReadiness({
        mode: "local-simulated",
        context,
        config,
      }),
    ).not.toThrow();
  });

  it("enforces verifier readiness for consume-only lanes without applyTo routes", () => {
    const lane = { id: "lane-consume-only" } as any;
    const context = {
      eventRouteByEventId: new Map(),
      activeBindingsByQueue: new Map([[{}, new Set([lane.id])]]),
      bindingsByLaneId: new Map([
        [
          lane.id,
          {
            lane,
            auth: {
              mode: "jwt_asymmetric",
              privateKey: "private-only",
            },
          },
        ],
      ]),
    } as any;
    const config = {
      profile: "p",
      topology: {
        profiles: { p: { consume: [{ lane: lane }] } },
        bindings: [
          {
            lane,
            queue: {},
            auth: {
              mode: "jwt_asymmetric",
              privateKey: "private-only",
            },
          },
        ],
      },
    } as any;

    expectRunnerErrorId(
      () =>
        enforceEventLaneAuthReadiness({
          mode: "network",
          context,
          config,
        }),
      "remoteLanes-auth-verifierMissing",
    );
  });

  it("ignores malformed active lane entries that cannot resolve to a binding lane", () => {
    const context = {
      eventRouteByEventId: new Map(),
      activeBindingsByQueue: new Map([[{}, new Set(["missing-lane"])]]),
      bindingsByLaneId: new Map(),
    } as any;
    const config = {
      profile: "p",
      topology: {
        profiles: { p: { consume: [] } },
        bindings: [],
      },
    } as any;

    expect(() =>
      enforceEventLaneAuthReadiness({
        mode: "network",
        context,
        config,
      }),
    ).not.toThrow();
  });

  it("verifies message token and handles none/missing-token branches", () => {
    const laneId = "lane.verify";
    const bindingAuth = { secret: "verify-secret" };
    const message = {
      eventId: "event.verify",
      payload: JSON.stringify({ value: 1 }),
      authToken: undefined,
    };
    const token = issueRemoteLaneToken({
      laneId,
      bindingAuth,
      capability: "produce",
      target: {
        kind: "event-lane",
        targetId: message.eventId,
        payloadHash: hashRemoteLanePayload(message.payload),
      },
    })!;

    expect(() =>
      verifyEventLaneMessageToken({
        message: { authToken: undefined } as any,
        laneId,
        bindingAuth: undefined,
      }),
    ).not.toThrow();

    expectRunnerErrorId(
      () =>
        verifyEventLaneMessageToken({
          message: { ...message, authToken: undefined } as any,
          laneId,
          bindingAuth,
        }),
      "remoteLanes-auth-unauthorized",
    );

    expect(() =>
      verifyEventLaneMessageToken({
        message: { ...message, authToken: token } as any,
        laneId,
        bindingAuth,
      }),
    ).not.toThrow();
  });
});
