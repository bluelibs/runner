import { globals, r } from "@bluelibs/runner/node";

import { ResourceId, TaskId, TunnelMode, TunnelTransport } from "../ids.js";
import { demoTask } from "./demoTask.js";
import {
  createNotePhantom,
  listAuditsPhantom,
  listNotesPhantom,
  logAuditPhantom,
} from "./phantoms.js";

type HttpTunnelClientValue = {
  transport: TunnelTransport;
  mode: TunnelMode;
  tasks: TaskId[];
  run: (task: { id: string }, input: unknown) => Promise<unknown>;
};

export type BuildHttpClientAppOptions = {
  baseUrl: string;
  authToken: string;
};

export function buildHttpClientApp(options: BuildHttpClientAppOptions) {
  const tunnelClient = r
    .resource(ResourceId.TunnelClient)
    .tags([globals.tags.tunnel])
    .dependencies({ clientFactory: globals.resources.httpClientFactory })
    .init(async (_cfg, deps): Promise<HttpTunnelClientValue> => {
      const client = deps.clientFactory({
        baseUrl: options.baseUrl,
        auth: { token: options.authToken },
      });
      console.log(`[client/tunnel] Connected to: ${options.baseUrl}`);

      return {
        transport: TunnelTransport.Http,
        mode: TunnelMode.Client,
        tasks: [
          TaskId.CreateNote,
          TaskId.ListNotes,
          TaskId.LogAudit,
          TaskId.ListAudits,
        ],
        run: async (task, input) => client.task(task.id, input),
      };
    })
    .build();

  const app = r
    .resource(ResourceId.ClientApp)
    .register([
      tunnelClient,
      createNotePhantom,
      listNotesPhantom,
      logAuditPhantom,
      listAuditsPhantom,
      demoTask,
    ])
    .build();

  return { app, demoTask };
}
