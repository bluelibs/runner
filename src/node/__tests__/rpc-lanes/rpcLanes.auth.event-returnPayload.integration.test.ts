import * as http from "http";
import { defineEvent, defineResource } from "../../../define";
import { globalTags } from "../../../globals/globalTags";
import { genericError } from "../../../errors";
import { r } from "../../../public";
import { buildEventRequestBody } from "../../../remote-lanes/http/protocol";
import { run } from "../../../run";
import { Serializer } from "../../../serializer";
import { buildRpcLaneAuthHeaders } from "../../rpc-lanes/rpcLanes.auth";
import { rpcLanesResource } from "../../rpc-lanes";
import { hashRemoteLanePayload } from "../../remote-lanes/laneAuth";
import {
  createMockRpcLaneCommunicator,
  createServerRpcLaneTopology,
} from "./test.utils";

async function allocatePort(): Promise<number> {
  const probe = http.createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const listeningAddress = probe.address();
  if (!listeningAddress || typeof listeningAddress === "string") {
    throw genericError.new({ message: "Could not allocate test port." });
  }
  await new Promise<void>((resolve, reject) => {
    probe.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  return listeningAddress.port;
}

describe("rpcLanes auth event returnPayload binding", () => {
  it("rejects replaying a fire-and-forget token as a result-bearing event call", async () => {
    const lane = r.rpcLane("tests-rpc-lanes-auth-return-payload-lane").build();
    const event = defineEvent<{ value: number }>({
      id: "tests-rpc-lanes-auth-return-payload-event",
      tags: [globalTags.rpcLane.with({ lane })],
    });
    let eventRuns = 0;
    const hook = r
      .hook("tests-rpc-lanes-auth-return-payload-hook")
      .on(event)
      .run(async (emission) => {
        eventRuns += 1;
        emission.data.value += 1;
      })
      .build();
    const communicator = createMockRpcLaneCommunicator(
      "tests-rpc-lanes-auth-return-payload-communicator",
    );
    const topology = createServerRpcLaneTopology(
      [lane],
      [{ lane, communicator, auth: { secret: "return-payload-secret" } }],
    );
    const exposurePort = await allocatePort();
    const app = defineResource({
      id: "tests-rpc-lanes-auth-return-payload-app",
      register: [
        event,
        hook,
        communicator,
        rpcLanesResource.with({
          profile: "server",
          topology,
          mode: "network",
          exposure: {
            http: {
              listen: { port: exposurePort, host: "127.0.0.1" },
              basePath: "/__runner",
              auth: { allowAnonymous: true },
            },
          },
        }),
      ],
    });

    const runtime = await run(app);
    try {
      const serializer = new Serializer();
      const discovery = await fetch(
        `http://127.0.0.1:${exposurePort}/__runner/discovery`,
      );
      const discoveryJson = await discovery.json();
      const servedEventId = discoveryJson.result.allowList.events[0] as string;
      const eventUrl = `http://127.0.0.1:${exposurePort}/__runner/event/${encodeURIComponent(servedEventId)}`;
      const fireAndForgetBody = serializer.stringify(
        buildEventRequestBody({ value: 1 }),
      );
      const resultBody = serializer.stringify(
        buildEventRequestBody({ value: 1 }, { returnPayload: true }),
      );
      const fireAndForgetHeaders = buildRpcLaneAuthHeaders({
        lane,
        bindingAuth: topology.bindings[0]?.auth,
        target: {
          kind: "rpc-event",
          targetId: servedEventId,
          payloadHash: hashRemoteLanePayload(fireAndForgetBody),
        },
      })!;

      const fireAndForgetResponse = await fetch(eventUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...fireAndForgetHeaders,
        },
        body: fireAndForgetBody,
      });
      expect(fireAndForgetResponse.status).toBe(200);
      expect(eventRuns).toBe(1);

      const replayedResultResponse = await fetch(eventUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...fireAndForgetHeaders,
        },
        body: resultBody,
      });
      expect(replayedResultResponse.status).toBe(401);
      expect(eventRuns).toBe(1);

      const resultHeaders = buildRpcLaneAuthHeaders({
        lane,
        bindingAuth: topology.bindings[0]?.auth,
        target: {
          kind: "rpc-event",
          targetId: servedEventId,
          payloadHash: hashRemoteLanePayload(resultBody),
        },
      })!;

      const authorizedResultResponse = await fetch(eventUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...resultHeaders,
        },
        body: resultBody,
      });
      const authorizedResultJson = await authorizedResultResponse.json();
      expect(authorizedResultResponse.status).toBe(200);
      expect(authorizedResultJson.result).toEqual({ value: 2 });
      expect(eventRuns).toBe(2);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        return;
      }
      throw error;
    } finally {
      await runtime.dispose();
    }
  });
});
