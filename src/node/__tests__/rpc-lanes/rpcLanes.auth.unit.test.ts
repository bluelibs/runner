import { issueRemoteLaneToken } from "../../remote-lanes/laneAuth";
import {
  authorizeRpcLaneRequest,
  buildRpcLaneAuthHeaders,
  enforceRpcLaneAuthReadiness,
  getBindingAuthForRpcLane,
} from "../../rpc-lanes/rpcLanes.auth";

describe("rpcLanes auth helpers", () => {
  it("resolves binding auth and enforces readiness across modes", () => {
    const lane = { id: "lane.rpc.auth" } as any;
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
    const lane = { id: "lane.rpc.authz" } as any;
    const bindingAuth = { secret: "authz-secret" };
    const headers = buildRpcLaneAuthHeaders(lane, bindingAuth);
    expect(headers).toBeTruthy();
    expect(headers?.authorization).toContain("Bearer ");

    expect(
      buildRpcLaneAuthHeaders({ id: "lane.none" } as any, { mode: "none" }),
    ).toBeUndefined();

    const validToken = issueRemoteLaneToken({
      laneId: lane.id,
      bindingAuth,
      capability: "produce",
    })!;
    const reqWithValidToken = {
      headers: { authorization: `Bearer ${validToken}` },
    } as any;
    expect(
      authorizeRpcLaneRequest(reqWithValidToken, lane, bindingAuth),
    ).toBeNull();

    const reqWithInvalidToken = {
      headers: { authorization: "Bearer wrong" },
    } as any;
    expect(
      authorizeRpcLaneRequest(reqWithInvalidToken, lane, bindingAuth),
    ).toMatchObject({ status: 401 });

    const reqWithoutToken = { headers: {} } as any;
    expect(
      authorizeRpcLaneRequest(reqWithoutToken, lane, bindingAuth),
    ).toMatchObject({
      status: 401,
    });

    expect(
      authorizeRpcLaneRequest(reqWithoutToken, { id: "lane.none" } as any, {
        mode: "none",
      }),
    ).toBeNull();
  });
});
