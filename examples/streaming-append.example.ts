/**
 * End-to-end streaming example that shows how Runner can host a Node HTTP route
 * which starts streaming its response before the incoming upload finished.
 *
 * The server streams every request byte through a transform that appends an
 * "a" character, and the client writes the request body slowly so that you can
 * observe interleaved upload/download progress.
 */

import { resource, run } from "../src";
import type { IncomingMessage, ServerResponse } from "http";
import { createServer, request } from "http";
import type { Server } from "http";
import { Readable, Transform } from "stream";

interface StreamingServerValue {
  server: Server;
  url: string;
  port: number;
}

const appendStreamingServer = resource({
  id: "examples.streaming.appendServer",
  meta: {
    title: "Streaming append server",
    description:
      "Streams uploads through a transform that appends 'a' to every byte.",
  },
  async init(): Promise<StreamingServerValue> {
    const server = createServer((req, res) => {
      if (req.method === "POST" && normalizePath(req.url) === "/append") {
        handleAppendRoute(req, res);
        return;
      }

      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Not Found");
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Streaming server failed to provide an address");
    }

    const host = address.family === "IPv6" ? `[${address.address}]` : address.address;
    return {
      server,
      url: `http://${host}:${address.port}`,
      port: address.port,
    } satisfies StreamingServerValue;
  },
  async dispose(value) {
    await new Promise<void>((resolve, reject) => {
      value.server.close((error) => (error ? reject(error) : resolve()));
    });
  },
});

interface ChunkInfo {
  chunk: string;
  index: number;
  remaining: number;
}

type ChunkObserver = (info: ChunkInfo) => void;

function createSlowTextStream(
  text: string,
  delayMs: number,
  onChunk?: ChunkObserver,
): Readable {
  let index = 0;
  return new Readable({
    read() {
      if (index >= text.length) {
        this.push(null);
        return;
      }

      const nextIndex = index + 1;
      const chunk = text.slice(index, nextIndex);
      index = nextIndex;

      setTimeout(() => {
        onChunk?.({ chunk, index: nextIndex, remaining: text.length - nextIndex });
        this.push(chunk);
      }, delayMs);
    },
  });
}

function createAppendTransform(): Transform {
  return new Transform({
    transform(chunk: Buffer | string, _encoding, callback) {
      const source = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(typeof chunk === "string" ? chunk : String(chunk));
      const output = Buffer.allocUnsafe(source.length * 2);
      let offset = 0;
      for (const byte of source) {
        output[offset++] = byte;
        output[offset++] = 0x61; // ASCII "a"
      }
      callback(null, output);
    },
  });
}

function handleAppendRoute(req: IncomingMessage, res: ServerResponse): void {
  const appendTransform = createAppendTransform();

  const closeWithError = (error: unknown) => {
    const err = error instanceof Error ? error : new Error(String(error));
    appendTransform.destroy(err);
    if (!res.destroyed) {
      res.destroy(err);
    }
    if (!req.destroyed) {
      req.destroy(err);
    }
  };

  req.on("error", closeWithError);
  res.on("error", closeWithError);

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  req.pipe(appendTransform).pipe(res);
}

function normalizePath(url: string | undefined): string {
  if (!url) return "/";
  try {
    const parsed = new URL(url, "http://local" as const);
    return parsed.pathname;
  } catch {
    return url.split("?")[0] ?? "/";
  }
}

async function streamUploadAndCollect(
  baseUrl: string,
  payload: string,
): Promise<string> {
  const target = new URL("/append", baseUrl);
  let uploadFinished = false;

  return await new Promise<string>((resolve, reject) => {
    const bodyStream = createSlowTextStream(payload, 40, ({ chunk, index }) => {
      console.log(`[client] sent chunk #${index}: "${chunk}"`);
    });

    bodyStream.on("end", () => {
      uploadFinished = true;
      console.log("[client] upload stream completed");
    });
    bodyStream.on("error", reject);

    const req = request(
      {
        method: "POST",
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      },
      (res) => {
        res.setEncoding("utf8");
        const received: string[] = [];
        res.on("data", (chunk) => {
          console.log(
            `[client] received chunk while uploadFinished=${uploadFinished}: "${chunk}"`,
          );
          received.push(chunk);
        });
        res.on("end", () => {
          console.log("[client] response stream completed");
          resolve(received.join(""));
        });
        res.on("error", reject);
      },
    );

    req.on("error", reject);
    req.on("finish", () => {
      console.log("[client] request body fully written");
    });

    bodyStream.pipe(req);
  });
}

export async function runStreamingAppendExample(): Promise<void> {
  const runResult = await run(appendStreamingServer);
  const value = runResult.value;
  const target = new URL("/append", value.url);
  console.log(`Streaming append server listening at ${target.href}`);

  try {
    const payload = "Runner streaming demo";
    const response = await streamUploadAndCollect(value.url, payload);
    const expected = payload
      .split("")
      .map((char) => `${char}a`)
      .join("");

    console.log(`[client] expected response: "${expected}"`);
    console.log(`[client] actual response:   "${response}"`);

    if (response !== expected) {
      throw new Error("Server response did not match expected transform output");
    }
  } finally {
    await runResult.dispose();
  }
}

if (require.main === module) {
  runStreamingAppendExample().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export { appendStreamingServer };
