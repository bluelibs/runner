import {
  hashRemoteLanePayload,
  issueRemoteLaneToken,
} from "../../remote-lanes/laneAuth";
import {
  authorizeRpcLaneRequest,
  buildRpcLaneAuthHeaders,
  enforceRpcLaneAuthReadiness,
  getBindingAuthForRpcLane,
} from "../../rpc-lanes/rpcLanes.auth";

function expectRunnerErrorId(fn: () => unknown, errorId: string): void {
  try {
    fn();
    throw new Error(`Expected RunnerError "${errorId}"`);
  } catch (error) {
    const candidate = error as { id?: string; name?: string };
    expect(candidate.id ?? candidate.name).toBe(errorId);
  }
}

describe("rpcLanes auth helpers", () => {
  it("resolves binding auth and enforces readiness across modes", () => {
    const lane = { id: "lane-rpc-auth" } as any;
    const config = {
      profile: "p",
      topology: {
        profiles: { p: { serve: [lane] } },
        bindings: [{ lane, communicator: {}, auth: { secret: "rpc-secret" } }],
      },
    } as any;
    const resolved = {
      mode: "network",
      serveLaneIds: new Set([lane.id]),
      taskLaneByTaskId: new Map([["task.id", lane]]),
      eventLaneByEventId: new Map([["event.id", lane]]),
      bindingsByLaneId: new Map([
        [lane.id, { lane, auth: { secret: "rpc-secret" } }],
      ]),
    } as any;

    expect(getBindingAuthForRpcLane(config, lane.id)).toEqual({
      secret: "rpc-secret",
    });
    expect(() => enforceRpcLaneAuthReadiness(config, resolved)).not.toThrow();
    expect(() =>
      enforceRpcLaneAuthReadiness(config, { ...resolved, mode: "transparent" }),
    ).not.toThrow();
    expect(() =>
      enforceRpcLaneAuthReadiness(config, {
        ...resolved,
        mode: "local-simulated",
      }),
    ).not.toThrow();
  });

  it("builds auth headers and authorizes request variants", () => {
    const lane = { id: "lane-rpc-authz" } as any;
    const bindingAuth = { secret: "authz-secret" };
    const payloadText = JSON.stringify({ input: { value: 1 } });
    const target = {
      kind: "rpc-task" as const,
      targetId: "task.id",
      payloadHash: hashRemoteLanePayload(payloadText),
    };
    const headers = buildRpcLaneAuthHeaders({ lane, bindingAuth, target });
    expect(headers).toBeTruthy();
    expect(headers?.authorization).toContain("Bearer ");

    expect(
      buildRpcLaneAuthHeaders({
        lane: { id: "lane-none" } as any,
        bindingAuth: { mode: "none" },
        target,
      }),
    ).toBeUndefined();

    const validToken = issueRemoteLaneToken({
      laneId: lane.id,
      bindingAuth,
      capability: "produce",
      target,
    })!;
    const reqWithValidToken = {
      headers: { authorization: `Bearer ${validToken}` },
    } as any;
    expect(
      authorizeRpcLaneRequest(
        reqWithValidToken,
        lane,
        bindingAuth,
        {
          kind: "rpc-task",
          targetId: "task.id",
        },
        { payloadText },
      ),
    ).toBeNull();

    expect(
      authorizeRpcLaneRequest(
        reqWithValidToken,
        lane,
        bindingAuth,
        {
          kind: "rpc-task",
          targetId: "task.id",
        },
        {
          payloadText: JSON.stringify({ input: { value: 2 } }),
        },
      ),
    ).toMatchObject({ status: 401 });

    const reqWithInvalidToken = {
      headers: { authorization: "Bearer wrong" },
    } as any;
    expect(
      authorizeRpcLaneRequest(
        reqWithInvalidToken,
        lane,
        bindingAuth,
        {
          kind: "rpc-task",
          targetId: "task.id",
        },
        { payloadText },
      ),
    ).toMatchObject({ status: 401 });

    const reqWithoutToken = { headers: {} } as any;
    expect(
      authorizeRpcLaneRequest(
        reqWithoutToken,
        lane,
        bindingAuth,
        {
          kind: "rpc-task",
          targetId: "task.id",
        },
        { payloadText },
      ),
    ).toMatchObject({
      status: 401,
    });

    expect(
      authorizeRpcLaneRequest(
        reqWithoutToken,
        { id: "lane-none" } as any,
        { mode: "none" },
        {
          kind: "rpc-task",
          targetId: "task.id",
        },
      ),
    ).toBeNull();
  });

  it("requires verifier material for local-simulated lanes", () => {
    const lane = { id: "lane-rpc-auth-simulated" } as any;
    const config = {
      profile: "p",
      topology: {
        profiles: { p: { serve: [lane] } },
        bindings: [
          {
            lane,
            communicator: {},
            auth: { produceSecret: "produce-only" },
          },
        ],
      },
    } as any;
    const resolved = {
      mode: "local-simulated",
      serveLaneIds: new Set<string>(),
      taskLaneByTaskId: new Map([["task.id", lane]]),
      eventLaneByEventId: new Map(),
      bindingsByLaneId: new Map([
        [lane.id, { lane, auth: { produceSecret: "produce-only" } }],
      ]),
    } as any;

    expectRunnerErrorId(
      () => enforceRpcLaneAuthReadiness(config, resolved),
      "remoteLanes-auth-verifierMissing",
    );
  });
});
