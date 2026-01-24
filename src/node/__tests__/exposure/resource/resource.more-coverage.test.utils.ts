import type { ServerResponse } from "http";
import { createMockReqRes, type MockReq, type MockRes } from "./resource.http.testkit";

export type { MockReq, MockRes };

export function createBaseReq(): MockReq {
  return createMockReqRes({ manualPush: true, body: null }).req;
}

export function makeReqRes(body: Buffer | string, headers: Record<string, string>) {
  const ref = createMockReqRes({
    manualPush: true,
    body: null,
    headers,
  });

  ref.req.method = "POST";
  ref.req.url = "/"; // will be set by caller

  setImmediate(() => {
    ref.req.push(Buffer.isBuffer(body) ? body : Buffer.from(String(body)));
    ref.req.push(null);
  });

  return {
    req: ref.req,
    res: ref.res as unknown as MockRes & ServerResponse,
    get status() {
      return ref.status;
    },
    get body() {
      return ref.body.length === 0 ? null : ref.body;
    },
  };
}
