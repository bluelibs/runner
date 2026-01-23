import type { IncomingMessage, ServerResponse } from "http";
import { applyCorsActual, handleCorsPreflight } from "../../exposure/cors";

function makeReq(headers: Record<string, any>, method: string = "OPTIONS") {
  return { headers, method } as unknown as IncomingMessage;
}

function makeRes() {
  const headers: Record<string, string> = {};
  const res: any = {
    statusCode: 0,
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

describe("cors core", () => {
  it("preflight: regex origin matches and sets allow-origin without Vary when varyOrigin=false", () => {
    const req = makeReq({ Origin: "https://sub.example.test" });
    const { res, headers } = makeRes();
    const handled = handleCorsPreflight(req, res, {
      origin: (o?: string) => o,
      varyOrigin: false,
      methods: ["POST"],
    });
    expect(handled).toBe(true);
    expect(headers["access-control-allow-origin"]).toBe(
      "https://sub.example.test",
    );
    expect(headers["vary"]).toBeUndefined();
  });

  it("applyCorsActual: function origin echoes and appends Vary: Origin by default", () => {
    const req = makeReq({ origin: "https://site.ok.test" }, "POST");
    const { res, headers } = makeRes();
    applyCorsActual(req, res, {
      origin: (o?: string) => (o?.endsWith(".ok.test") ? o : null),
    });
    expect(headers["access-control-allow-origin"]).toBe("https://site.ok.test");
    expect((headers["vary"] || "").toLowerCase()).toContain("origin");
  });

  it("preflight: array origin disallows non-listed and does not set allow-origin", () => {
    const req = makeReq({ origin: "https://bad.example" });
    const { res, headers } = makeRes();
    const handled = handleCorsPreflight(req, res, {
      origin: ["https://good.example"],
    });
    expect(handled).toBe(true);
    expect(headers["access-control-allow-origin"]).toBeUndefined();
  });
});
