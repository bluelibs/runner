import { Readable } from "stream";
import { Socket } from "net";
import type { IncomingMessage, ServerResponse } from "http";

export type MockReq = Readable & IncomingMessage;
export type MockRes = (
  | ServerResponse
  | (ServerResponse & { body?: Buffer | null })
) & {
  body?: Buffer | null;
};

export function createBaseReq(): MockReq {
  const req = new Readable({ read() {} }) as MockReq;
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
  });
  return req;
}

export function makeReqRes(body: Buffer | string, headers: Record<string, string>) {
  const req = createBaseReq();
  req.method = "POST";
  req.url = "/"; // will be set by caller
  req.headers = headers;
  setImmediate(() => {
    req.push(Buffer.isBuffer(body) ? body : Buffer.from(String(body)));
    req.push(null);
  });

  let status = 0;
  let payload: Buffer | null = null;
  const res = {
    statusCode: 0,
    setHeader(
      _name: string,
      _value: number | string | ReadonlyArray<string>,
    ) {
      return res as unknown as ServerResponse;
    },
    end(buf?: unknown) {
      status = this.statusCode;
      if (buf != null) {
        payload = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf));
      }
      return res as unknown as ServerResponse;
    },
  } as unknown as MockRes;

  return {
    req,
    res,
    get status() {
      return status;
    },
    get body() {
      return payload;
    },
  };
}
