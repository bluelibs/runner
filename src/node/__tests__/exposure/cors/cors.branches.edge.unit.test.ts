import type { IncomingMessage, ServerResponse } from "http";
import { handleCorsPreflight } from "../../../exposure/cors";

function makeReq(headers: Record<string, any>, method: string = "OPTIONS") {
  return { headers, method } as unknown as IncomingMessage;
}

function makeRes() {
  const headers: Record<string, any> = {};
  const res: any = {
    statusCode: 0,
    headers,
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

describe("cors edge branches", () => {
  it("credentials with undefined origin denies access (secure by default)", () => {
    const req = makeReq({});
    const { res, headers } = makeRes();
    handleCorsPreflight(req, res, { credentials: true });
    // SECURITY: credentials=true without explicit origin config should NOT set allow-origin
    // Previously it would set 'null', but this is insecure behavior
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("array origin non-match sets vary but no allow-origin (35, 55, 64)", () => {
    const req = makeReq({ origin: "https://x.test" });
    const { res, headers } = makeRes();
    // pre-seed Vary to array-like scenario
    (res as any).setHeader("Vary", ["Accept-Encoding"]);
    handleCorsPreflight(req, res, {
      origin: ["https://a.test", "https://b.test"],
    });
    expect((headers["Vary"] as string) || "").toContain("Origin");
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("regex origin true branch (39-40)", () => {
    const req = makeReq({ origin: "https://ok.re" });
    const { res, headers } = makeRes();
    handleCorsPreflight(req, res, { origin: /ok\.re$/ });
    expect(headers["Access-Control-Allow-Origin"]).toBe("https://ok.re");
  });
});
