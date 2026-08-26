import {
  hashRemoteLanePayload,
  issueRemoteLaneToken,
} from "../../remote-lanes/laneAuth";
import { RUNNER_ASYNC_CONTEXT_HEADER } from "../../../remote-lanes/http/constants";
import { buildEventRequestBody } from "../../../remote-lanes/http/protocol";
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
        { bodyText: payloadText },
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
          bodyText: JSON.stringify({ input: { value: 2 } }),
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
        { bodyText: payloadText },
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
        { bodyText: payloadText },
      ),
    ).toMatchObject({
      status: 401,
    });

    const eventBodyText = JSON.stringify(buildEventRequestBody({ value: 1 }));
    const eventBodyWithResultText = JSON.stringify(
      buildEventRequestBody({ value: 1 }, { returnPayload: true }),
    );
    const eventToken = issueRemoteLaneToken({
      laneId: lane.id,
      bindingAuth,
      capability: "produce",
      target: {
        kind: "rpc-event",
        targetId: "event.id",
        payloadHash: hashRemoteLanePayload(eventBodyText),
      },
    })!;
    const reqWithEventToken = {
      headers: { authorization: `Bearer ${eventToken}` },
    } as any;

    expect(
      authorizeRpcLaneRequest(
        reqWithEventToken,
        lane,
        bindingAuth,
        {
          kind: "rpc-event",
          targetId: "event.id",
        },
        { bodyText: eventBodyText },
      ),
    ).toBeNull();

    expect(
      authorizeRpcLaneRequest(
        reqWithEventToken,
        lane,
        bindingAuth,
        {
          kind: "rpc-event",
          targetId: "event.id",
        },
        { bodyText: eventBodyWithResultText },
      ),
    ).toMatchObject({ status: 401 });

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

  it("binds the serialized async context header into the token hash", () => {
    const lane = { id: "lane-rpc-context-bind" } as any;
    const bindingAuth = { secret: "context-secret" };
    const bodyText = JSON.stringify({ input: { value: 1 } });
    const contextBlob = JSON.stringify({ tenant: "acme" });

    const token = issueRemoteLaneToken({
      laneId: lane.id,
      bindingAuth,
      capability: "produce",
      target: {
        kind: "rpc-task",
        targetId: "task.context-bind",
        payloadHash: hashRemoteLanePayload(bodyText + contextBlob),
      },
    })!;

    const reqWithContext = {
      headers: {
        authorization: `Bearer ${token}`,
        [RUNNER_ASYNC_CONTEXT_HEADER]: contextBlob,
      },
    } as any;

    // Matching context header verifies...
    expect(
      authorizeRpcLaneRequest(
        reqWithContext,
        lane,
        bindingAuth,
        { kind: "rpc-task", targetId: "task.context-bind" },
        { bodyText },
      ),
    ).toBeNull();

    // ...but a rewritten context header must invalidate the token.
    const reqWithTamperedContext = {
      headers: {
        authorization: `Bearer ${token}`,
        [RUNNER_ASYNC_CONTEXT_HEADER]: JSON.stringify({ tenant: "evil" }),
      },
    } as any;
    expect(
      authorizeRpcLaneRequest(
        reqWithTamperedContext,
        lane,
        bindingAuth,
        { kind: "rpc-task", targetId: "task.context-bind" },
        { bodyText },
      ),
    ).toMatchObject({ status: 401 });
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

  it("hashes an empty bodyText over the context header only (streaming endpoints)", () => {
    const lane = { id: "lane-rpc-empty-body" } as any;
    const bindingAuth = { secret: "empty-body-secret" };
    const contextBlob = JSON.stringify({ tenant: "acme" });

    // A client streaming a body cannot hash it byte-for-byte, so it signs the
    // async context header only (empty bodyText).
    const streamingToken = issueRemoteLaneToken({
      laneId: lane.id,
      bindingAuth,
      capability: "produce",
      target: {
        kind: "rpc-task",
        targetId: "task.streaming",
        payloadHash: hashRemoteLanePayload("" + contextBlob),
      },
    })!;

    const streamingReq = {
      headers: {
        authorization: `Bearer ${streamingToken}`,
        [RUNNER_ASYNC_CONTEXT_HEADER]: contextBlob,
      },
    } as any;

    expect(
      authorizeRpcLaneRequest(
        streamingReq,
        lane,
        bindingAuth,
        { kind: "rpc-task", targetId: "task.streaming" },
        { bodyText: "" },
      ),
    ).toBeNull();

    // A JSON-body token (hash over real body bytes) must NOT verify against an
    // empty-bodyText request — replaying a JSON token at a streaming endpoint
    // fails closed.
    const bodyText = JSON.stringify({ input: { value: 1 } });
    const jsonToken = issueRemoteLaneToken({
      laneId: lane.id,
      bindingAuth,
      capability: "produce",
      target: {
        kind: "rpc-task",
        targetId: "task.streaming",
        payloadHash: hashRemoteLanePayload(bodyText + contextBlob),
      },
    })!;

    const jsonReplayReq = {
      headers: {
        authorization: `Bearer ${jsonToken}`,
        [RUNNER_ASYNC_CONTEXT_HEADER]: contextBlob,
      },
    } as any;

    expect(
      authorizeRpcLaneRequest(
        jsonReplayReq,
        lane,
        bindingAuth,
        { kind: "rpc-task", targetId: "task.streaming" },
        { bodyText: "" },
      ),
    ).toMatchObject({ status: 401 });
  });
});
