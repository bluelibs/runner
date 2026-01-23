import type { IncomingMessage, ServerResponse } from "http";
import { applyCorsActual, handleCorsPreflight } from "../../exposure/cors";

function makeReq(headers: Record<string, any>, method: string = "OPTIONS") {
  return { headers, method } as unknown as IncomingMessage;
}

function makeRes() {
  const headers: Record<string, string> = {};
  const res: any = {
    statusCode: 0,
    headers,
    headersSent: false,
    setHeader(k: string, v: string) {
      headers[k.toLowerCase()] = v;
      this.headersSent = true;
    },
    getHeader(k: string) {
      return headers[k.toLowerCase()];
    },
    end() {
      this.writableEnded = true;
    },
  };
  return { res: res as ServerResponse, headers };
}

describe("cors extra branches", () => {
  it("preflight: no cfg uses wildcard and echoes requested headers", () => {
    const req = makeReq({ origin: "http://x" });
    const { res, headers } = makeRes();
    const handled = handleCorsPreflight(req, res, undefined);
    expect(handled).toBe(true);
    expect(headers["access-control-allow-origin"]).toBe("*");
  });

  it("applyCorsActual: no cfg sets wildcard", () => {
    const req = makeReq({ origin: "http://x" }, "POST");
    const { res, headers } = makeRes();
    applyCorsActual(req, res, undefined);
    expect(headers["access-control-allow-origin"]).toBe("*");
  });

  it("preflight: string origin sets fixed allow-origin without Vary", () => {
    const req = makeReq({ origin: "http://x" });
    const { res, headers } = makeRes();
    handleCorsPreflight(req, res, { origin: "https://fixed.test" });
    expect(headers["access-control-allow-origin"]).toBe("https://fixed.test");
    expect(headers["vary"]).toBeUndefined();
  });

  it("preflight: function origin returns null → no allow-origin header", () => {
    const req = makeReq({ origin: "https://nope.test" });
    const { res, headers } = makeRes();
    handleCorsPreflight(req, res, { origin: () => null });
    expect(headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("preflight: array origin matches first entry", () => {
    const req = makeReq({ origin: "https://a.test" });
    const { res, headers } = makeRes();
    handleCorsPreflight(req, res, {
      origin: ["https://a.test", "https://b.test"],
    });
    expect(headers["access-control-allow-origin"]).toBe("https://a.test");
  });
});
