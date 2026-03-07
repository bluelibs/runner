/**
 * Duplex streaming over RPC Lanes HTTP transport.
 *
 * - Server: rpcLanes HTTP exposure
 * - Task uses useExposureContext() to read request body and stream response
 * - Client: rpcLane smart communicator uploads a slow stream and reads streamed response
 */

import { r, run } from "@bluelibs/runner";
import { rpcLanesResource, useExposureContext } from "@bluelibs/runner/node";
import { Readable, Transform } from "stream";

import { createSlowReadable, getExposureBaseUrl } from "./utils";

const RPC_PROFILE = {
  client: "client",
  server: "server",
} as const;

const IDS = {
  // Shared app id keeps fully-qualified task ids aligned across client/server.
  app: "duplexApp",
  task: "duplexTask",
  communicator: {
    server: "duplexServerCommunicator",
    client: "duplexClientCommunicator",
  },
  rpcLanes: {
    server: "duplexServerRpcLanes",
    client: "duplexClientRpcLanes",
  },
} as const;
const RPC_BASE_PATH = "/__runner";

const duplexLane = r.rpcLane("duplexLane").build();

function transformChunk(value: string): string {
  return `${value.toUpperCase()}!`;
}

async function respondDuplex(
  opts: { contentType?: string } = {},
  transform: (chunk: Buffer) => string,
): Promise<void> {
  const { req, res } = useExposureContext();

  res.statusCode = 200;
  res.setHeader(
    "content-type",
    opts.contentType ?? "text/plain; charset=utf-8",
  );

  await new Promise<void>((resolve, reject) => {
    req
      .on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk, "utf8");

        console.log("receive", buffer.toString("utf8"));
        const output = transform(buffer);

        console.log("sent-back", output);
        res.write(output);
      })
      .on("end", () => {
        res.end();
        resolve();
      })
      .on("error", reject);
  });
}

const duplexTask = r
  .task<Readable>(IDS.task)
  .tags([r.runner.tags.rpcLane.with({ lane: duplexLane })])
  .meta({
    title: "Duplex demo",
    description: "Streams request -> transforms -> streams response",
  })
  .run(async (): Promise<string> => {
    await respondDuplex({ contentType: "text/plain; charset=utf-8" }, (chunk) =>
      transformChunk(chunk.toString("utf8")),
    );

    return "IGNORED_BY_EXPOSURE";
  })
  .build();

const duplexRemoteTask = r
  .task<Readable>(IDS.task)
  .tags([r.runner.tags.rpcLane.with({ lane: duplexLane })])
  .run(async (): Promise<string> => {
    throw new Error("This task must be routed through rpcLanes.");
  })
  .build();

function createTopology(communicator: ReturnType<typeof r.resource<void>>) {
  return r.rpcLane.topology({
    profiles: {
      [RPC_PROFILE.client]: { serve: [] },
      [RPC_PROFILE.server]: { serve: [duplexLane] },
    },
    bindings: [{ lane: duplexLane, communicator }],
  });
}

function buildServerApp() {
  const communicator = r
    .resource<void>(IDS.communicator.server)
    .init(async () => ({
      task: async (): Promise<never> => {
        throw new Error("Unexpected remote task call on server communicator.");
      },
      event: async (): Promise<never> => {
        throw new Error("Unexpected remote event call on server communicator.");
      },
      eventWithResult: async (): Promise<never> => {
        throw new Error("Unexpected remote event call on server communicator.");
      },
    }))
    .build();

  const rpcLanes = rpcLanesResource.fork(IDS.rpcLanes.server).with({
    profile: RPC_PROFILE.server,
    mode: "network",
    topology: createTopology(communicator),
    exposure: {
      http: {
        auth: { allowAnonymous: true },
        basePath: RPC_BASE_PATH,
        listen: { host: "127.0.0.1", port: 0 },
      },
    },
  });

  return {
    app: r.resource(IDS.app).register([duplexTask, communicator, rpcLanes]).build(),
    rpcLanes,
  };
}

function buildClientApp(baseUrl: string) {
  const communicator = r
    .resource<void>(IDS.communicator.client)
    .init(
      r.rpcLane.httpClient({
        client: "smart",
        baseUrl,
      }),
    )
    .build();

  const rpcLanes = rpcLanesResource.fork(IDS.rpcLanes.client).with({
    profile: RPC_PROFILE.client,
    mode: "network",
    topology: createTopology(communicator),
  });

  return r
    .resource(IDS.app)
    .register([duplexRemoteTask, communicator, rpcLanes])
    .build();
}

export async function runStreamingDuplexExample(): Promise<void> {
  const { app: serverApp, rpcLanes: serverRpcLanes } = buildServerApp();
  const serverRuntime = await run(serverApp);

  let clientRuntime: Awaited<ReturnType<typeof run>> | null = null;

  try {
    const serverRpcLanesValue = await serverRuntime.getResourceValue(serverRpcLanes);
    const baseUrl = getExposureBaseUrl(serverRpcLanesValue);
    console.log(`Exposure listening at ${baseUrl}`);

    const clientApp = buildClientApp(baseUrl);
    clientRuntime = await run(clientApp);

    const payload = "Runner streaming demo";
    const slowInput = createSlowReadable(payload, 20).pipe(
      new Transform({
        transform(chunk, _enc, cb) {
          const text = Buffer.isBuffer(chunk)
            ? chunk.toString("utf8")
            : String(chunk);

          console.log("send", text);
          cb(null, chunk);
        },
      }),
    );

    const expected = payload
      .split("")
      .map((char) => transformChunk(char))
      .join("");

    const response = (await clientRuntime.runTask(
      duplexRemoteTask,
      slowInput,
    )) as Readable;

    await new Promise<void>((resolve, reject) => {
      const chunks: Buffer[] = [];

      response
        .on("data", (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk)
            ? chunk
            : Buffer.from(chunk, "utf8");

          console.log("received-back", buffer.toString("utf8"));
          chunks.push(buffer);
        })
        .on("end", () => {
          const output = Buffer.concat(chunks).toString("utf8");
          if (output !== expected) {
            reject(new Error(`Unexpected response: ${output}`));
            return;
          }
          resolve();
        })
        .on("error", reject);
    });
  } finally {
    if (clientRuntime) {
      await clientRuntime.dispose();
    }
    await serverRuntime.dispose();
  }
}

if (require.main === module) {
  runStreamingDuplexExample().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export { duplexTask };
