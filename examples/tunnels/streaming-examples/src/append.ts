/**
 * Streaming append over RPC Lanes + smart HTTP transport.
 *
 * - Server: rpcLanes HTTP exposure
 * - Client: rpcLane smart communicator uploads Node File sentinels via multipart
 */

import { InputFile, r, run, tags } from "@bluelibs/runner";
import { createNodeFile, rpcLanesResource } from "@bluelibs/runner/node";
import { Readable, Transform } from "stream";

import { createSlowReadable, getExposureBaseUrl } from "./utils";

const RPC_PROFILE = {
  client: "client",
  server: "server",
} as const;

const IDS = {
  // Shared app id keeps fully-qualified task ids aligned across client/server.
  app: "appendApp",
  task: "appendTask",
  communicator: {
    server: "appendServerCommunicator",
    client: "appendClientCommunicator",
  },
  rpcLanes: {
    server: "appendServerRpcLanes",
    client: "appendClientRpcLanes",
  },
} as const;
const RPC_BASE_PATH = "/__runner";

const appendLane = r.rpcLane("appendLane").build();

function appendMagic(value: string): string {
  return value
    .split("")
    .map((char) => `${char}a`)
    .join("");
}

function createAppendTransform(): Transform {
  return new Transform({
    transform(chunk, _enc, cb) {
      try {
        const text = Buffer.isBuffer(chunk)
          ? chunk.toString("utf8")
          : String(chunk);
        cb(null, Buffer.from(appendMagic(text), "utf8"));
      } catch (error) {
        cb(error as Error);
      }
    },
  });
}

function tap(label: string): Transform {
  return new Transform({
    transform(chunk, _enc, cb) {
      const text = Buffer.isBuffer(chunk)
        ? chunk.toString("utf8")
        : String(chunk);

      console.log(label, text);
      cb(null, chunk);
    },
  });
}

const appendTask = r
  .task<{ file: InputFile<Readable> }>(IDS.task)
  .tags([tags.rpcLane.with({ lane: appendLane })])
  .meta({
    title: "Append magic",
    description: "Appends 'a' to every character (file stream)",
  })
  .run(async (input): Promise<string> => {
    const { stream } = await input.file.resolve();
    const xform = createAppendTransform();
    const rxTap = tap("receive");

    return await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream
        .pipe(rxTap)
        .pipe(xform)
        .on("data", (chunk: Buffer | string) => {
          chunks.push(
            Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8"),
          );
        })
        .on("end", () => {
          resolve(Buffer.concat(chunks).toString("utf8"));
        })
        .on("error", reject);
    });
  })
  .build();

const appendRemoteTask = r
  .task<{ file: InputFile<Readable> }>(IDS.task)
  .tags([tags.rpcLane.with({ lane: appendLane })])
  .run(async (): Promise<string> => {
    throw new Error("This task must be routed through rpcLanes.");
  })
  .build();

function createTopology(communicator: ReturnType<typeof r.resource<void>>) {
  return r.rpcLane.topology({
    profiles: {
      [RPC_PROFILE.client]: { serve: [] },
      [RPC_PROFILE.server]: { serve: [appendLane] },
    },
    bindings: [{ lane: appendLane, communicator }],
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
    app: r
      .resource(IDS.app)
      .register([appendTask, communicator, rpcLanes])
      .build(),
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
    .register([appendRemoteTask, communicator, rpcLanes])
    .build();
}

export async function runStreamingAppendExample(): Promise<void> {
  const { app: serverApp, rpcLanes: serverRpcLanes } = buildServerApp();
  const serverRuntime = await run(serverApp);

  let clientRuntime: Awaited<ReturnType<typeof run>> | null = null;

  try {
    const payload = "Runner streaming demo";
    const expected = appendMagic(payload);

    const serverRpcLanesValue =
      await serverRuntime.getResourceValue(serverRpcLanes);
    const baseUrl = getExposureBaseUrl(serverRpcLanesValue);

    const clientApp = buildClientApp(baseUrl);
    clientRuntime = await run(clientApp);

    const result = await clientRuntime.runTask(appendRemoteTask, {
      file: createNodeFile(
        { name: "payload.txt", type: "text/plain" },
        { stream: createSlowReadable(payload, 25).pipe(tap("send")) },
        "F1",
      ),
    });

    console.log(`[result] ${result}`);

    if (result !== expected) {
      throw new Error(
        "RPC lane result did not match expected transform output",
      );
    }
  } finally {
    if (clientRuntime) {
      await clientRuntime.dispose();
    }
    await serverRuntime.dispose();
  }
}

if (require.main === module) {
  runStreamingAppendExample().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export { appendTask };
