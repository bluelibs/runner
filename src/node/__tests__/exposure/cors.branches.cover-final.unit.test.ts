import type { IncomingMessage, ServerResponse } from "http";
import { handleCorsPreflight } from "../../exposure/cors";

function makeReq(headers: Record<string, any>): IncomingMessage {
  return { method: "OPTIONS", headers } as unknown as IncomingMessage;
}

function makeRes() {
  const headers: Record<string, any> = {};
  const res: any = {
    statusCode: 0,
    setHeader(k: string, v: any) {
      headers[k] = v;
    },
    getHeader(k: string) {
      return headers[k];
    },
    end() {},
  };
  return { res: res as ServerResponse, headers };
}

describe("cors final branches", () => {
  it("array origin match echoes origin (line 35)", () => {
    const req = makeReq({ origin: "https://bar" });
    const { res, headers } = makeRes();
    handleCorsPreflight(req, res, { origin: ["https://foo", "https://bar"] });
    expect(headers["Access-Control-Allow-Origin"]).toBe("https://bar");
    const vary = (headers["Vary"] as string) || "";
    expect(vary.toLowerCase()).toContain("origin");
  });

  it("regex origin non-match sets vary but no allow-origin (39-40)", () => {
    const req = makeReq({ origin: "https://nope.test" });
    const { res, headers } = makeRes();
    handleCorsPreflight(req, res, { origin: /example\.com$/ });
    const vary = (headers["Vary"] as string) || "";
    expect(vary.toLowerCase()).toContain("origin");
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("array origin with missing request origin sets vary, no allow-origin (line 35 else)", () => {
    const req = makeReq({});
    const { res, headers } = makeRes();
    handleCorsPreflight(req, res, { origin: ["https://a", "https://b"] });
    const vary = (headers["Vary"] as string) || "";
    expect(vary.toLowerCase()).toContain("origin");
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("regex origin with missing request origin sets vary, no allow-origin (line 39 else)", () => {
    const req = makeReq({});
    const { res, headers } = makeRes();
    handleCorsPreflight(req, res, { origin: /ok$/ });
    const vary = (headers["Vary"] as string) || "";
    expect(vary.toLowerCase()).toContain("origin");
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });
});
