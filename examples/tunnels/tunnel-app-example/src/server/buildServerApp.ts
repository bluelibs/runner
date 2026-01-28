import { globals, r, nodeExposure } from "@bluelibs/runner/node";

import {
  HttpConfig,
  ResourceId,
  TaskId,
  TunnelMode,
  TunnelTransport,
} from "../ids.js";
import { auditStore, listAudits, logAudit } from "./audit.js";
import { createNote, listNotes, notesStore } from "./notes.js";

export type BuildServerAppOptions = {
  authToken: string;
};

type HttpTunnelExposurePolicyValue = {
  transport: TunnelTransport;
  mode: TunnelMode;
  tasks: TaskId[];
};

export function buildServerApp(options: BuildServerAppOptions) {
  const serverExposure = nodeExposure.fork(ResourceId.ServerExposure).with({
    http: {
      basePath: HttpConfig.BasePath,
      listen: { port: 0, host: HttpConfig.Host },
      auth: { token: options.authToken },
    },
  });

  const httpExposurePolicy = r
    .resource(ResourceId.HttpExposurePolicy)
    .tags([globals.tags.tunnel])
    .init(async (): Promise<HttpTunnelExposurePolicyValue> => ({
      transport: TunnelTransport.Http,
      mode: TunnelMode.Server,
      tasks: [
        TaskId.CreateNote,
        TaskId.ListNotes,
        TaskId.LogAudit,
        TaskId.ListAudits,
      ],
    }))
    .build();

  const app = r
    .resource(ResourceId.ServerApp)
    .register([
      notesStore,
      createNote,
      listNotes,
      auditStore,
      logAudit,
      listAudits,
      httpExposurePolicy,
      serverExposure,
    ])
    .build();

  return { app, serverExposure };
}
