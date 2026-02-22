import type { IncomingMessage, ServerResponse } from "http";

import {
  ensureRequestId,
  getRequestId,
} from "../../../exposure/requestIdentity";

function makeReq(headers: Record<string, any>): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

function makeRes() {
  const headers: Record<string, string> = {};
  const res = {
    headersSent: false,
    writableEnded: false,
    setHeader(k: string, v: string) {
      headers[k.toLowerCase()] = v;
    },
  } as unknown as ServerResponse & { headersSent: boolean };
  return { res, headers };
}

describe("requestIdentity", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  it("reads request id from header array", () => {
    const req = makeReq({ "x-runner-request-id": ["abc-1"] });
    expect(getRequestId(req)).toBe("abc-1");
  });

  it("rejects empty and overlong request ids", () => {
    const emptyReq = makeReq({ "x-runner-request-id": "   " });
    expect(getRequestId(emptyReq)).toBeUndefined();

    const longReq = makeReq({ "x-runner-request-id": "a".repeat(129) });
    expect(getRequestId(longReq)).toBeUndefined();
  });

  it("ensures request id and preserves pre-send headersSent state", () => {
    const req = makeReq({});
    const { res, headers } = makeRes();

    const requestId = ensureRequestId(req, res);
    expect(requestId).toBeDefined();
    expect(headers["x-runner-request-id"]).toBe(requestId);
    expect(res.headersSent).toBe(false);
  });

  it("does not set response header after headers are already sent", () => {
    const req = makeReq({ "x-runner-request-id": "existing-id" });
    const { res, headers } = makeRes();
    res.headersSent = true;

    const requestId = ensureRequestId(req, res);
    expect(requestId).toBe("existing-id");
    expect(headers["x-runner-request-id"]).toBeUndefined();
  });

  it("falls back to randomBytes when randomUUID is unavailable", () => {
    jest.doMock("node:crypto", () => ({
      randomUUID: undefined,
      randomBytes: () => Buffer.from("00112233445566778899aabbccddeeff", "hex"),
    }));

    jest.isolateModules(() => {
      const mod =
        require("../../../exposure/requestIdentity") as typeof import("../../../exposure/requestIdentity");
      const req = makeReq({});
      const { res } = makeRes();
      const requestId = mod.ensureRequestId(req, res);
      expect(requestId).toBe("00112233445566778899aabbccddeeff");
    });
  });
});
