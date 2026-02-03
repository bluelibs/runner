import type {
  IncomingHttpHeaders,
  IncomingMessage,
  ServerResponse,
} from "http";
import { EventEmitter } from "events";
import { Readable } from "stream";

export enum HttpMethod {
  Get = "GET",
  Post = "POST",
  Options = "OPTIONS",
}

export enum NodeHttpEventName {
  Data = "data",
  End = "end",
  Error = "error",
  Aborted = "aborted",
  Close = "close",
}

export enum HeaderName {
  ContentType = "content-type",
  Origin = "origin",
  XRunnerContext = "x-runner-context",
}

export enum MimeType {
  ApplicationJson = "application/json",
  ApplicationOctetStream = "application/octet-stream",
  MultipartFormData = "multipart/form-data",
}

export type MockReq = Readable & IncomingMessage;

export type NodeLikeHeaders = Record<
  string,
  string | ReadonlyArray<string> | undefined
>;

export interface CreateMockReqInit {
  method?: HttpMethod | string;
  url?: string;
  headers?: NodeLikeHeaders;
  /**
   * When provided, it will be emitted as request body and then the stream ends.
   * When `null`, the stream ends without emitting data.
   * When omitted, nothing is emitted (useful for tests that abort/cancel).
   */
  body?: string | Buffer | null;
  /**
   * Ends the request stream (push null). Defaults to `true` when `body` is provided.
   */
  autoEnd?: boolean;
}

function toBuffer(value: string | Buffer): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
}

export function createMockReq(init: CreateMockReqInit): MockReq {
  const req = new Readable({ read() {} }) as unknown as MockReq;
  req.method = init.method ?? HttpMethod.Post;
  req.url = init.url ?? "/";
  req.headers = (init.headers ?? {}) as unknown as IncomingHttpHeaders;

  const shouldAutoEnd = init.autoEnd ?? init.body !== undefined;
  if (shouldAutoEnd) {
    setImmediate(() => {
      if (init.body != null) {
        req.push(toBuffer(init.body));
      }
      req.push(null);
    });
  }

  return req;
}

export type MockRes = ServerResponse & {
  _status?: number;
  _buf?: Buffer;
  headers: Record<string, string>;
  headersSent: boolean;
  writableEnded: boolean;
};

export interface CreateMockResInit {
  /**
   * When true, registering a `once("close")` handler schedules a `close` emit.
   * Useful to simulate clients disconnecting early.
   */
  autoCloseOnOnce?: boolean;
}

export function createMockRes(init: CreateMockResInit = {}): MockRes {
  const emitter = new EventEmitter();
  const chunks: Buffer[] = [];

  const headers: Record<string, string> = {};
  const res: any = {
    statusCode: 0,
    headers,
    headersSent: false,
    writableEnded: false,
    setHeader(name: string, value: number | string | ReadonlyArray<string>) {
      headers[String(name).toLowerCase()] = Array.isArray(value)
        ? value.join(",")
        : String(value);
      this.headersSent = true;
    },
    getHeader(name: string) {
      return headers[String(name).toLowerCase()];
    },
    write(payload?: unknown) {
      if (payload != null) {
        const buf = Buffer.isBuffer(payload)
          ? payload
          : Buffer.from(String(payload), "utf8");
        chunks.push(buf);
      }
      this.headersSent = true;
    },
    end(payload?: unknown) {
      this._status = this.statusCode;
      if (payload != null) this.write(payload);
      this._buf = chunks.length
        ? Buffer.concat(chunks as readonly Uint8Array[])
        : undefined;
      this.headersSent = true;
      this.writableEnded = true;
    },
    on(event: string, cb: (...args: any[]) => void) {
      emitter.on(event, cb);
      return this;
    },
    once(event: string, cb: (...args: any[]) => void) {
      emitter.once(event, cb);
      if (event === NodeHttpEventName.Close && init.autoCloseOnOnce) {
        setImmediate(() => emitter.emit(NodeHttpEventName.Close));
      }
      return this;
    },
    off(event: string, cb: (...args: any[]) => void) {
      emitter.off(event, cb);
      return this;
    },
    removeListener(event: string, cb: (...args: any[]) => void) {
      emitter.removeListener(event, cb);
      return this;
    },
    emit(event: string, ...args: any[]) {
      emitter.emit(event, ...args);
      return this;
    },
  };

  return res as MockRes;
}

export function createReqRes(init: CreateMockReqInit & CreateMockResInit = {}) {
  const { autoCloseOnOnce, ...reqInit } = init;
  const req = createMockReq(reqInit);
  const res = createMockRes({ autoCloseOnOnce });

  return {
    req,
    res,
    get text() {
      return res._buf?.toString("utf8") ?? "";
    },
    get json() {
      return this.text ? JSON.parse(this.text) : undefined;
    },
  };
}
