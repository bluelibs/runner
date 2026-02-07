/**
 * Duplex streaming (raw-body in, streamed response out).
 *
 * - nodeExposure serves an ephemeral HTTP server
 * - Task uses useExposureContext() to read req and write to res
 * - Client uploads slowly; server responds per chunk
 */

import { globals, resource, run, task } from "@bluelibs/runner";
import {
  nodeExposure,
  useExposureContext,
  createHttpSmartClient,
} from "@bluelibs/runner/node";
import { Readable, Transform } from "stream";
import { createSlowReadable } from "./utils";

const BASE_PATH = "/__runner" as const;

function transformChunk(s: string): string {
  // Uppercase + add '!'
  return s.toUpperCase() + "!";
}

const createSlowStream = createSlowReadable;

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
      .on("data", (c: any) => {
        const buf = Buffer.isBuffer(c) ? c : Buffer.from(String(c));
        // Required demo logs

        console.log("receive", buf.toString("utf8"));
        const out = transform(buf);

        console.log("sent-back", out);
        res.write(out);
      })
      .on("end", () => {
        res.end();
        resolve();
      })
      .on("error", reject);
  });
}

const duplexTask = task({
  id: "examples.streaming.duplexTask",
  meta: {
    title: "Duplex demo",
    description: "Streams request -> transforms -> streams response",
  },
  run: async () => {
    await respondDuplex({ contentType: "text/plain; charset=utf-8" }, (buf) =>
      transformChunk(buf.toString("utf8")),
    );
    return "IGNORED_BY_EXPOSURE";
  },
});

const exposure = nodeExposure.with({
  http: {
    dangerouslyAllowOpenExposure: true,
    auth: { allowAnonymous: true },
    listen: { port: 0 },
    basePath: BASE_PATH,
  },
});
const app = resource({
  id: "examples.streaming.duplex.app",
  register: [duplexTask, exposure],
});

export async function runStreamingDuplexExample(): Promise<void> {
  const rr = await run(app);
  try {
    const handlers = await rr.getResourceValue(exposure.resource as any);
    const addr = handlers.server?.address();
    if (!addr || typeof addr === "string") throw new Error("No server address");
    const origin = `http://127.0.0.1:${addr.port}`;
    const baseUrl = `${origin}${BASE_PATH}`;
    console.log(`Exposure listening at ${baseUrl}`);

    const payload = "Runner streaming demo";
    const slow = createSlowStream(payload, 20).pipe(
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
      .map((c) => transformChunk(c))
      .join("");

    const serializer = rr.getResourceValue(globals.resources.serializer);
    const client = createHttpSmartClient({ baseUrl, serializer });
    const res = (await client.task(duplexTask.id, slow)) as Readable;
    await new Promise<void>((resolve, reject) => {
      const chunks: Buffer[] = [];
      res
        .on("data", (c: any) => {
          const buf = Buffer.isBuffer(c) ? c : Buffer.from(String(c));

          console.log("received-back", buf.toString("utf8"));
          chunks.push(buf);
        })
        .on("end", () => {
          const out = Buffer.concat(chunks as readonly Uint8Array[]).toString(
            "utf8",
          );
          if (out !== expected)
            return reject(new Error(`Unexpected response: ${out}`));
          resolve();
        })
        .on("error", reject);
    });
  } finally {
    await rr.dispose();
  }
}

if (require.main === module) {
  runStreamingDuplexExample().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

export { app as duplexStreamingServer, duplexTask };
