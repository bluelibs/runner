import { createHttpClient, r, resources } from "@bluelibs/runner";
import { rpcLanesResource } from "@bluelibs/runner/node";
import type { RpcLaneRequestOptions } from "@bluelibs/runner";

import { ResourceId, RpcProfile } from "../ids.js";
import { appRpcLane } from "../rpcLane.js";
import { demoTask } from "./demoTask.js";
import {
  createNoteRemoteTask,
  listAuditsRemoteTask,
  listNotesRemoteTask,
  logAuditRemoteTask,
} from "./remoteTasks.js";

export type BuildHttpClientAppOptions = {
  baseUrl: string;
  authToken: string;
};

export function buildHttpClientApp(options: BuildHttpClientAppOptions) {
  const communicator = r
    .resource<void>(ResourceId.ClientCommunicator)
    .dependencies({ serializer: resources.serializer })
    .init(async (_cfg, deps) => {
      const client = createHttpClient({
        baseUrl: options.baseUrl,
        auth: { token: options.authToken },
        serializer: deps.serializer,
      });
      return {
        task: async (
          taskId: string,
          input?: unknown,
          options?: RpcLaneRequestOptions,
        ) => client.task(taskId, input, options),
      };
    })
    .build();

  const topology = r.rpcLane.topology({
    profiles: {
      [RpcProfile.Client]: { serve: [] },
      [RpcProfile.Server]: { serve: [appRpcLane] },
    },
    bindings: [
      {
        lane: appRpcLane,
        communicator,
        auth: { mode: "jwt_hmac", secret: options.authToken },
      },
    ],
  });

  const rpcLanes = rpcLanesResource.fork(ResourceId.ClientRpcLanes).with({
    profile: RpcProfile.Client,
    mode: "network",
    topology,
  });

  const app = r
    .resource(ResourceId.ClientApp)
    .register([
      communicator,
      rpcLanes,
      createNoteRemoteTask,
      listNotesRemoteTask,
      logAuditRemoteTask,
      listAuditsRemoteTask,
      demoTask,
    ])
    .build();

  return { app, demoTask };
}
