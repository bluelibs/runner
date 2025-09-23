import * as http from "http";
import * as https from "https";
import { Readable, pipeline } from "stream";
import type { Serializer } from "../globals/resources/tunnel/serializer";
import type { ProtocolEnvelope } from "../globals/resources/tunnel/protocol";
import { assertOkEnvelope } from "../globals/resources/tunnel/protocol";
import type { InputFileMeta } from "../types/inputFile";
// Avoid `.node` bare import which triggers tsup native addon resolver
import { buildNodeManifest } from "./upload/manifest";

export interface HttpSmartClientAuthConfig {
  header?: string; // default: x-runner-token
  token: string;
}

export interface HttpSmartClientConfig {
  baseUrl: string; // ex: http://localhost:7070/__runner
  auth?: HttpSmartClientAuthConfig;
  timeoutMs?: number; // optional request timeout for JSON/multipart
  serializer: Serializer;
  onRequest?: (ctx: {
    url: string;
    headers: Record<string, string>;
  }) => void | Promise<void>;
}

export interface HttpSmartClient {
  task<I = unknown, O = unknown>(id: string, input?: I): Promise<O | Readable>;
  event<P = unknown>(id: string, payload?: P): Promise<void>;
}

function isReadable(value: unknown): value is Readable {
  return !!value && typeof (value as any).pipe === "function";
}

function hasNodeFile(value: unknown): boolean {
  const visit = (v: unknown): boolean => {
    if (!v || typeof v !== "object") return false;
    if ((v as any).$ejson === "File" && typeof (v as any).id === "string") {
      const node = (v as any)._node;
      if (node && (node.stream || node.buffer)) return true;
    }
    if (Array.isArray(v)) return v.some(visit);
    for (const k of Object.keys(v as Record<string, unknown>)) {
      if (visit((v as Record<string, unknown>)[k])) return true;
    }
    return false;
  };
  return visit(value);
}

function toHeaders(auth?: HttpSmartClientAuthConfig): Record<string, string> {
  const headers: Record<string, string> = {};
  if (auth?.token)
    headers[(auth.header ?? "x-runner-token").toLowerCase()] = auth.token;
  return headers;
}

function requestLib(url: URL): typeof http {
  return url.protocol === "https:" ? (https as unknown as typeof http) : http;
}

async function postJson<T = any>(
  cfg: HttpSmartClientConfig,
  url: string,
  body: unknown,
): Promise<T> {
  const serializer = cfg.serializer;
  const parsed = new URL(url);
  const lib = requestLib(parsed);
  const headers = {
    "content-type": "application/json; charset=utf-8",
    ...toHeaders(cfg.auth),
  } as Record<string, string>;
  if (cfg.onRequest) await cfg.onRequest({ url, headers });
  return await new Promise<T>((resolve, reject) => {
    const req = lib.request(
      {
        method: "POST",
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        headers,
        timeout: cfg.timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(Buffer.from(c as any)));
        res.on("end", () => {
          const text = Buffer.concat(chunks as readonly Uint8Array[]).toString(
            "utf8",
          );
          const json = text
            ? (serializer.parse(text) as T)
            : (undefined as unknown as T);
          resolve(json);
        });
      },
    );
    req.on("error", reject);
    req.write(serializer.stringify(body));
    req.end();
  });
}

function escapeHeaderValue(value: string): string {
  return value.replace(/"/g, '\\"');
}

function encodeMultipart(
  manifestText: string,
  files: ReturnType<typeof buildNodeManifest>["files"],
  boundary: string,
): Readable {
  async function* gen(): AsyncGenerator<Buffer> {
    const CRLF = "\r\n";
    const boundaryLine = `--${boundary}`;

    const partHeader = (
      name: string,
      options?: { headers?: Record<string, string>; filename?: string },
    ) => {
      const h: string[] = [boundaryLine + CRLF];
      const cd: string[] = [
        `Content-Disposition: form-data; name="${escapeHeaderValue(name)}"`,
      ];
      if (options?.filename) {
        cd.push(`; filename="${escapeHeaderValue(options.filename)}"`);
      }
      h.push(cd.join("") + CRLF);
      if (options?.headers) {
        for (const k of Object.keys(options.headers)) {
          h.push(`${k}: ${options.headers[k]}` + CRLF);
        }
      }
      h.push(CRLF);
      return Buffer.from(h.join(""), "utf8");
    };

    // __manifest field
    yield partHeader("__manifest");
    yield Buffer.from(manifestText, "utf8");
    yield Buffer.from(CRLF, "utf8");

    for (const entry of files) {
      const filename = entry.meta?.name ?? "upload";
      const contentType = entry.meta?.type ?? "application/octet-stream";
      const headers: Record<string, string> = {
        "Content-Type": contentType,
      };
      yield partHeader(`file:${entry.id}`, { headers, filename });
      if (entry.source.type === "buffer") {
        yield entry.source.buffer;
      } else {
        for await (const chunk of entry.source.stream) {
          yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        }
      }
      yield Buffer.from(CRLF, "utf8");
    }
    // Closing boundary
    yield Buffer.from(boundaryLine + "--" + CRLF, "utf8");
  }
  return Readable.from(gen());
}

async function postMultipart(
  cfg: HttpSmartClientConfig,
  url: string,
  manifestText: string,
  files: ReturnType<typeof buildNodeManifest>["files"],
): Promise<{ stream: Readable; res: http.IncomingMessage }> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const parsed = new URL(url);
  const lib = requestLib(parsed);
  const boundary = `runner-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}`;
  const body = encodeMultipart(manifestText, files, boundary);
  const headers: Record<string, string> = {
    "content-type": `multipart/form-data; boundary=${boundary}`,
    ...toHeaders(cfg.auth),
  };
  if (cfg.onRequest) await cfg.onRequest({ url, headers });

  return await new Promise<{ stream: Readable; res: http.IncomingMessage }>(
    (resolve, reject) => {
      const req = lib.request(
        {
          method: "POST",
          protocol: parsed.protocol,
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname + parsed.search,
          headers,
          timeout: cfg.timeoutMs,
        },
        (res) => resolve({ stream: res as unknown as Readable, res }),
      );
      req.on("error", reject);
      body.on("error", (e) => req.destroy(e as Error));
      body.pipe(req);
    },
  );
}

async function postOctetStream(
  cfg: HttpSmartClientConfig,
  url: string,
  stream: Readable,
): Promise<{ stream: Readable; res: http.IncomingMessage }> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const parsed = new URL(url);
  const lib = requestLib(parsed);
  const headers: Record<string, string> = {
    "content-type": "application/octet-stream",
    ...toHeaders(cfg.auth),
  };
  if (cfg.onRequest) await cfg.onRequest({ url, headers });
  return await new Promise<{ stream: Readable; res: http.IncomingMessage }>(
    (resolve, reject) => {
      let settled = false;
      const cleanup: Array<() => void> = [];

      const resolveOnce = (value: {
        stream: Readable;
        res: http.IncomingMessage;
      }) => {
        settled = true;
        cleanup.forEach((fn) => fn());
        resolve(value);
      };
      const rejectOnce = (error: unknown) => {
        settled = true;
        cleanup.forEach((fn) => fn());
        reject(error as Error);
      };

      const req = lib.request(
        {
          method: "POST",
          protocol: parsed.protocol,
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname + parsed.search,
          headers,
          timeout: cfg.timeoutMs,
        },
        (res) => {
          // Defer resolution to the next check/timer turn to allow
          // any immediate source errors (propagated via req.destroy)
          // to reject the promise first.
          setImmediate(() => {
            if (!settled)
              resolveOnce({ stream: res as unknown as Readable, res });
          });
        },
      );

      const onReqError = (e: unknown) => rejectOnce(e);
      req.on("error", onReqError);
      cleanup.push(() => req.off("error", onReqError as any));

      // Use pipeline to safely wire errors between source and request,
      // preventing unhandled 'error' on the source stream.
      const onPipelineDone = (err?: NodeJS.ErrnoException | null) => {
        if (err) rejectOnce(err);
      };
      pipeline(stream, req, onPipelineDone);
      cleanup.push(() => {
        // Remove the callback from the request's 'close' event in case pipeline added one
        (req as any).off?.("error", onReqError as any);
      });
    },
  );
}

function parseMaybeJsonResponse<T = any>(
  res: http.IncomingMessage,
  serializer: Serializer,
): Promise<T | Readable> {
  const contentType = String(res.headers["content-type"]);
  if (/^application\/json/i.test(contentType)) {
    const chunks: Buffer[] = [];
    return new Promise<T>((resolve, reject) => {
      res.on("data", (c) => chunks.push(Buffer.from(c as any)));
      res.on("end", () => {
        try {
          const text = Buffer.concat(chunks as readonly Uint8Array[]).toString(
            "utf8",
          );
          const json = text
            ? (serializer.parse(text) as T)
            : (undefined as unknown as T);
          resolve(json);
        } catch (e) {
          reject(e);
        }
      });
      res.on("error", reject);
    });
  }
  return Promise.resolve(res as unknown as Readable);
}

export function createHttpSmartClient(
  cfg: HttpSmartClientConfig,
): HttpSmartClient {
  const baseUrl = cfg.baseUrl.replace(/\/$/, "");
  if (!baseUrl) throw new Error("createHttpSmartClient requires baseUrl");
  const serializer = cfg.serializer;

  return {
    async task<I, O>(id: string, input?: I): Promise<O | Readable> {
      const url = `${baseUrl}/task/${encodeURIComponent(id)}`;

      // A) Duplex raw-body: input itself is a Node Readable
      if (isReadable(input)) {
        const { res } = await postOctetStream(cfg, url, input);
        // For streaming duplex, we just return the response stream
        return res as unknown as Readable;
      }

      // B) Multipart: detect EJSON File sentinels with local Node sources
      if (hasNodeFile(input)) {
        const manifest = buildNodeManifest(input);
        const manifestText = serializer.stringify({
          input: manifest.input,
        });
        const { res } = await postMultipart(
          cfg,
          url,
          manifestText,
          manifest.files,
        );
        const maybe = await parseMaybeJsonResponse<ProtocolEnvelope<O>>(
          res,
          serializer,
        );
        if (isReadable(maybe)) return maybe; // server streamed back directly
        return assertOkEnvelope<O>(maybe as ProtocolEnvelope<O>, {
          fallbackMessage: "Tunnel task error",
        }) as O;
      }

      // C) JSON/EJSON fallback
      const r = await postJson<ProtocolEnvelope<O>>(cfg, url, { input });
      return assertOkEnvelope<O>(r, { fallbackMessage: "Tunnel task error" });
    },

    async event<P>(id: string, payload?: P): Promise<void> {
      const url = `${baseUrl}/event/${encodeURIComponent(id)}`;
      const r = await postJson<ProtocolEnvelope<void>>(cfg, url, { payload });
      assertOkEnvelope<void>(r, { fallbackMessage: "Tunnel event error" });
    },
  };
}

export type { Readable };
