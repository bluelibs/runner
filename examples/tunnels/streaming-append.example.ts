/**
 * Streaming append over HTTP using Runner exposure + Runner serializer.
 *
 * - Server: nodeExposure HTTP
 * - Client: Node smart client that auto-detects File sentinels and streams via multipart
 */

import { globals, resource, run, task } from "../../src";
import { Readable, Transform } from "stream";
import type { InputFile } from "../../src/types/inputFile";
import {
  nodeExposure,
  createNodeFile,
  createHttpSmartClient,
} from "../../src/node";
// @ts-ignore
import { createSlowReadable, getExposureBaseUrl } from "./utils";

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
      // Required demo log: "send" / "receive"

      console.log(label, text);
      cb(null, chunk);
    },
  });
}

// Task; receives a file and streams it via InputFile.resolve()
const appendTask = task({
  id: "examples.streaming.appendTask",
  meta: {
    title: "Append magic",
    description: "Appends 'a' to every character (file stream)",
  },
  run: async (input: { file: InputFile<Readable> }) => {
    const { stream } = await input.file.resolve();
    const xform = createAppendTransform();
    const rxTap = tap("receive");
    return await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream
        .pipe(rxTap)
        .pipe(xform)
        .on("data", (c: any) =>
          chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))),
        )
        .on("end", () =>
          resolve(
            Buffer.concat(chunks as readonly Uint8Array[]).toString("utf8"),
          ),
        )
        .on("error", reject);
    });
  },
});

const exposure = nodeExposure.with({
  http: {
    dangerouslyAllowOpenExposure: true,
    basePath: "/__runner",
    listen: { port: 0 },
  },
});
const app = resource({
  id: "examples.streaming.append.app",
  register: [appendTask, exposure],
});

export async function runStreamingAppendExample(): Promise<void> {
  const rr = await run(app);
  try {
    const payload = "Runner streaming demo";
    const expected = appendMagic(payload);

    // Discover exposure base URL and create a smart client
    const handlers = await rr.getResourceValue(exposure.resource as any);
    const baseUrl = await getExposureBaseUrl(handlers);
    const serializer = rr.getResourceValue(globals.resources.serializer);
    const client = createHttpSmartClient({ baseUrl, serializer });

    // Client builds a File sentinel with a local Node stream; the client uploads via multipart
    const sendTap = tap("send");
    const result = (await client.task<{ file: any }, string>(appendTask.id, {
      file: createNodeFile(
        { name: "payload.txt", type: "text/plain" },
        { stream: createSlowReadable(payload, 25).pipe(sendTap) },
        "F1",
      ),
    } as any)) as string;
    console.log(`[result] ${result}`);
    if (result !== expected) {
      throw new Error(
        "HTTP client result did not match expected transform output",
      );
    }
  } finally {
    await rr.dispose();
  }
}

if (require.main === module) {
  runStreamingAppendExample().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export { app as appendStreamingServer, appendTask };
