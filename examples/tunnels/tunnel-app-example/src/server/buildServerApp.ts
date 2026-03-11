import { r } from "@bluelibs/runner";
import { rpcLanesResource } from "@bluelibs/runner/node";

import { HttpConfig, ResourceId, RpcProfile } from "../ids.js";
import { appRpcLane } from "../rpcLane.js";
import { auditStore, listAudits, logAudit } from "./audit.js";
import { createNote, listNotes, notesStore } from "./notes.js";

enum ErrorMessage {
  UnexpectedRemoteTask = "Server communicator should not run remote tasks for served lanes.",
  UnexpectedRemoteEvent = "Server communicator should not run remote events for served lanes.",
}

export type BuildServerAppOptions = {
  authToken: string;
  port?: number;
};

export function buildServerApp(options: BuildServerAppOptions) {
  const communicator = r
    .resource<void>(ResourceId.ServerCommunicator)
    .init(async () => ({
      task: async (): Promise<never> => {
        throw new Error(ErrorMessage.UnexpectedRemoteTask);
      },
      event: async (): Promise<never> => {
        throw new Error(ErrorMessage.UnexpectedRemoteEvent);
      },
      eventWithResult: async (): Promise<never> => {
        throw new Error(ErrorMessage.UnexpectedRemoteEvent);
      },
    }))
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

  const rpcLanes = rpcLanesResource.fork(ResourceId.ServerRpcLanes).with({
    profile: RpcProfile.Server,
    mode: "network",
    topology,
    exposure: {
      http: {
        basePath: HttpConfig.BasePath,
        listen: { port: options.port ?? 0, host: HttpConfig.Host },
        auth: { token: options.authToken },
      },
    },
  });

  const app = r
    .resource(ResourceId.ServerApp)
    .register([
      notesStore,
      createNote,
      listNotes,
      auditStore,
      logAudit,
      listAudits,
      communicator,
      rpcLanes,
    ])
    .build();

  return { app, rpcLanes };
}
