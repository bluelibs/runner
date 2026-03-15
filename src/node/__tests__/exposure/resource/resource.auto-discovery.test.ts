import { defineResource, defineTask, defineEvent } from "../../../../define";
import { run } from "../../../../run";
import { r } from "../../../../public";
import { rpcLanesResource } from "../../../rpc-lanes";
import { createMockReqRes } from "./resource.http.testkit";

describe("nodeExposure auto-discovery (rpc lanes)", () => {
  function makeJsonReqRes(body: string, url: string) {
    const rrMock = createMockReqRes({
      method: "POST",
      url,
      headers: {
        "x-runner-token": "T",
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(body)),
      },
      manualPush: true,
      body: null,
    });
    setImmediate(() => {
      rrMock.req.push(Buffer.from(body));
      rrMock.req.push(null);
    });
    return rrMock;
  }

  it("allows only rpc-lane-allowlisted ids from served lanes", async () => {
    const allowed = defineTask<{ v: number }, Promise<number>>({
      id: "auto-disc-allowed",
      run: async ({ v }) => v,
    });
    const notAllowed = defineTask<{ v: number }, Promise<number>>({
      id: "auto-disc-notAllowed",
      run: async ({ v }) => v,
    });
    const allowedEvent = defineEvent<{ n: number }>({
      id: "auto-disc-allowed-ev",
    });
    const servedLane = r
      .rpcLane("tests-auto-discovery-served")
      .applyTo([allowed, allowedEvent])
      .build();
    const unservedLane = r
      .rpcLane("tests-auto-discovery-unserved")
      .applyTo([notAllowed])
      .build();
    const communicator = defineResource({
      id: "tests-auto-discovery-communicator",
      init: async () => ({
        task: async () => 1,
        event: async () => undefined,
      }),
    });
    const lanes = rpcLanesResource.with({
      profile: "server",
      mode: "network",
      topology: r.rpcLane.topology({
        profiles: {
          server: { serve: [servedLane] },
        },
        bindings: [
          {
            lane: servedLane,
            communicator,
          },
          {
            lane: unservedLane,
            communicator,
          },
        ],
      }),
      exposure: {
        http: {
          basePath: "/__runner",
          auth: { token: "T", allowAnonymous: true },
        },
      },
    });

    const app = defineResource({
      id: "auto-disc-app",
      register: [allowed, notAllowed, allowedEvent, communicator, lanes],
    });
    const rr = await run(app);
    const allowedTaskId = rr.store.findIdByDefinition(allowed);
    const notAllowedTaskId = rr.store.findIdByDefinition(notAllowed);
    const allowedEventId = rr.store.findIdByDefinition(allowedEvent);
    const lanesValue = await rr.getResourceValue(lanes.resource as any);
    const handlers = lanesValue.exposure?.getHandlers?.();
    expect(handlers).toBeTruthy();
    if (!handlers) {
      return;
    }

    // Allowed task -> 200
    {
      const body = JSON.stringify({ input: { v: 1 } });
      const rrMock = makeJsonReqRes(
        body,
        `/__runner/task/${encodeURIComponent(allowedTaskId)}`,
      );
      await handlers.handleTask(rrMock.req, rrMock.res);
      expect(rrMock.resStatus).toBe(200);
    }

    // Not allowed task -> 403 (forbidden when not allowlisted)
    {
      const body = JSON.stringify({ input: { v: 1 } });
      const rrMock = makeJsonReqRes(
        body,
        `/__runner/task/${encodeURIComponent(notAllowedTaskId)}`,
      );
      await handlers.handleTask(rrMock.req, rrMock.res);
      expect(rrMock.resStatus).toBe(403);
    }

    // Allowed event -> 200
    {
      const body = JSON.stringify({ payload: { n: 1 } });
      const rrMock = makeJsonReqRes(
        body,
        `/__runner/event/${encodeURIComponent(allowedEventId)}`,
      );
      await handlers.handleEvent(rrMock.req, rrMock.res);
      expect(rrMock.resStatus).toBe(200);
    }

    await rr.dispose();
  });
});
