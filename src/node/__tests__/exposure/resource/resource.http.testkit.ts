import type { IncomingMessage, ServerResponse } from "http";
import { Socket } from "net";
import { Readable } from "stream";
import { getDefaultSerializer } from "../../../../serializer";

export type MockReq = Readable & IncomingMessage;
export type MockRes = ServerResponse;

export type CreateMockReqResInit = {
  method?: string;
  url?: string;
  headers?: Record<string, string | ReadonlyArray<string>>;
  body?: string | Buffer | null;
  manualPush?: boolean;
};

function applyIncomingMessageDefaults(req: MockReq) {
  Object.assign(req, {
    aborted: false,
    httpVersion: "1.1",
    httpVersionMajor: 1,
    httpVersionMinor: 1,
    complete: true,
    rawHeaders: [] as string[],
    trailers: {} as Record<string, string>,
    rawTrailers: [] as string[],
    setTimeout(_msecs: number, _callback?: () => void) {
      return req;
    },
    socket: new Socket(),
  } satisfies Partial<IncomingMessage>);
}

export function createMockReqRes(init: CreateMockReqResInit = {}) {
  const {
    method = "POST",
    url = "/",
    headers = {},
    body = "",
    manualPush = false,
  } = init;

  const req = new Readable({
    read() {
      if (manualPush) return;
      if (body != null) {
        this.push(Buffer.isBuffer(body) ? body : Buffer.from(String(body)));
      }
      this.push(null);
    },
  }) as MockReq;

  applyIncomingMessageDefaults(req);
  req.method = method;
  req.url = url;
  req.headers = headers as unknown as IncomingMessage["headers"];

  let endedStatus = 0;
  const chunks: Buffer[] = [];
  const responseHeaders: Record<string, string | ReadonlyArray<string>> = {};

  const res = {
    statusCode: 0,
    headersSent: false,
    writableEnded: false,
    setHeader(name: string, value: number | string | ReadonlyArray<string>) {
      responseHeaders[name.toLowerCase()] = Array.isArray(value)
        ? value.map(String)
        : String(value);
      return res as unknown as ServerResponse;
    },
    getHeader(name: string) {
      return responseHeaders[name.toLowerCase()];
    },
    writeHead(code: number, extra?: Record<string, string>) {
      (res as unknown as ServerResponse).statusCode = code;
      if (extra) {
        for (const [k, v] of Object.entries(extra)) {
          (res as unknown as ServerResponse).setHeader(k, v);
        }
      }
      (res as any).headersSent = true;
      return res as unknown as ServerResponse;
    },
    write(payload?: unknown) {
      (res as any).headersSent = true;
      if (payload == null) return true;
      chunks.push(
        Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload)),
      );
      return true;
    },
    end(payload?: unknown) {
      if (payload != null) {
        (res as any).write(payload);
      }
      (res as any).writableEnded = true;
      endedStatus = (res as unknown as ServerResponse).statusCode;
      return res as unknown as ServerResponse;
    },
  } as unknown as MockRes;

  const getBodyBuffer = () =>
    chunks.length === 0
      ? Buffer.alloc(0)
      : Buffer.concat(chunks as readonly Uint8Array[]);

  type JsonResponse = {
    ok?: boolean;
    result?: unknown;
    error?: { code?: string; message?: string; id?: string; data?: unknown };
  };

  return {
    req,
    res,
    get status() {
      return endedStatus || (res as unknown as ServerResponse).statusCode || 0;
    },
    get resStatus() {
      return (res as unknown as ServerResponse).statusCode as number;
    },
    get headers() {
      return responseHeaders;
    },
    get body() {
      return getBodyBuffer();
    },
    get text() {
      return getBodyBuffer().toString("utf8");
    },
    get json(): JsonResponse | undefined {
      const buf = getBodyBuffer();
      if (buf.length === 0) return undefined;
      try {
        return getDefaultSerializer().parse(buf.toString("utf8")) as JsonResponse;
      } catch {
        return undefined;
      }
    },
  };
}
