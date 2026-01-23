import type { IncomingMessage, ServerResponse } from "http";
import { applyCorsActual, handleCorsPreflight } from "../../../exposure/cors";

function makeReq(
  method: string,
  headers: Record<string, any> = {},
): IncomingMessage {
  return { method, headers } as any;
}

function makeRes(): ServerResponse & { _headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  return {
    _headers: headers,
    setHeader(k: string, v: string) {
      headers[k.toLowerCase()] = v;
    },
    getHeader(k: string) {
      return headers[k.toLowerCase()];
    },
    statusCode: 0,
  } as any;
}

describe("cors helpers - branch coverage", () => {
  it("default actual: sets wildcard when cfg undefined", () => {
    const req = makeReq("POST", {});
    const res = makeRes();
    applyCorsActual(req, res, undefined);
    expect(res._headers["access-control-allow-origin"]).toBe("*");
  });

  it("credentials without origin: denies access (secure by default - no origin echoing)", () => {
    const req = makeReq("POST", { origin: "https://c.test" });
    const res = makeRes();
    applyCorsActual(req, res, { credentials: true });
    // SECURITY: Should NOT echo request origin when credentials=true without explicit origin config
    expect(res._headers["access-control-allow-origin"]).toBeUndefined();
    expect(res._headers["vary"]).toContain("Origin");
  });

  it("origin string: no Vary and sets exact origin; exposed headers set", () => {
    const req = makeReq("POST", { origin: "https://ignored.test" });
    const res = makeRes();
    applyCorsActual(req, res, {
      origin: "https://fixed.test",
      exposedHeaders: ["x-a", "x-b"],
    });
    expect(res._headers["access-control-allow-origin"]).toBe(
      "https://fixed.test",
    );
    expect(res._headers["access-control-expose-headers"]).toBe("x-a, x-b");
    expect(res._headers["vary"]).toBeUndefined();
  });

  it("origin array: matches and not matches; capitalized Origin header as array", () => {
    const req1 = makeReq("POST", {
      Origin: ["https://ok.test", "https://other.test"],
    });
    const res1 = makeRes();
    applyCorsActual(req1, res1, {
      origin: ["https://ok.test", "https://b.test"],
      credentials: true,
    });
    expect(res1._headers["access-control-allow-origin"]).toBe(
      "https://ok.test",
    );
    expect(res1._headers["vary"]).toContain("Origin");

    const req2 = makeReq("POST", { Origin: ["https://nope.test"] });
    const res2 = makeRes();
    applyCorsActual(req2, res2, {
      origin: ["https://ok.test"],
      credentials: true,
    });
    expect(res2._headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("origin regexp and function; varyOrigin=false disables Vary header", () => {
    const req = makeReq("POST", { origin: "https://sub.example.com" });
    const res = makeRes();
    applyCorsActual(req, res, { origin: /\.example\.com$/, varyOrigin: false });
    expect(res._headers["access-control-allow-origin"]).toBe(
      "https://sub.example.com",
    );
    expect(res._headers["vary"]).toBeUndefined();

    const req2 = makeReq("POST", { origin: "https://fn.test" });
    const res2 = makeRes();
    applyCorsActual(req2, res2, {
      origin: (o) => (o === "https://fn.test" ? o : null),
    });
    expect(res2._headers["access-control-allow-origin"]).toBe(
      "https://fn.test",
    );
    const req3 = makeReq("POST", { origin: "https://blocked.test" });
    const res3 = makeRes();
    applyCorsActual(req3, res3, { origin: () => null });
    expect(res3._headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("preflight: returns false when not OPTIONS", () => {
    const handled = handleCorsPreflight(
      makeReq("POST", {}),
      makeRes(),
      undefined,
    );
    expect(handled).toBe(false);
  });

  it("preflight: applies methods, allowed headers (echo and provided), credentials and maxAge; appends Vary", () => {
    const req = makeReq("OPTIONS", {
      origin: "https://pf.test",
      "access-control-request-headers": ["X-A", "x-b"],
    });
    const res = makeRes();
    const handled = handleCorsPreflight(req, res, {
      origin: ["https://pf.test"],
      methods: ["POST", "PUT"],
      allowedHeaders: ["x-token"],
      credentials: true,
      maxAge: 120,
    });
    expect(handled).toBe(true);
    expect(res._headers["access-control-allow-origin"]).toBe("https://pf.test");
    expect(res._headers["access-control-allow-methods"]).toBe("POST, PUT");
    expect(res._headers["access-control-allow-headers"]).toBe("x-token");
    expect(res._headers["access-control-allow-credentials"]).toBe("true");
    expect(res._headers["access-control-max-age"]).toBe("120");
    expect(res._headers["vary"]).toContain("Origin");
  });

  it("preflight: echoes requested headers when none configured", () => {
    const req = makeReq("OPTIONS", {
      origin: "https://pf2.test",
      "access-control-request-headers": "x-one, x-two",
    });
    const res = makeRes();
    const handled = handleCorsPreflight(req, res, { origin: /pf2/ });
    expect(handled).toBe(true);
    expect(res._headers["access-control-allow-headers"]).toBe("x-one, x-two");
  });

  it("origin array with lowercase origin header array", () => {
    const req = makeReq("POST", { origin: ["https://arr.test"] });
    const res = makeRes();
    applyCorsActual(req, res, {
      origin: ["https://arr.test"],
      credentials: true,
    });
    expect(res._headers["access-control-allow-origin"]).toBe(
      "https://arr.test",
    );
  });

  it("uppercase Origin header (string) is respected", () => {
    const req = makeReq("POST", { Origin: "https://upper.test" });
    const res = makeRes();
    applyCorsActual(req, res, {
      origin: ["https://upper.test"],
      credentials: true,
    });
    expect(res._headers["access-control-allow-origin"]).toBe(
      "https://upper.test",
    );
    expect((res._headers["vary"] || "").toLowerCase()).toContain("origin");
  });

  it("invalid origin type results in no allow-origin header and no vary", () => {
    const req = makeReq("POST", { origin: "https://x.test" });
    const res = makeRes();
    applyCorsActual(req, res, { origin: 123 as any });
    expect(res._headers["access-control-allow-origin"]).toBeUndefined();
    expect(res._headers["vary"]).toBeUndefined();
  });

  it("appendVaryHeader avoids duplicates when called twice (via actual then preflight)", () => {
    const req = makeReq("OPTIONS", { origin: "https://dup.test" });
    const res = makeRes();
    // Use explicit origin config to test Vary header behavior
    applyCorsActual(req, res, {
      origin: ["https://dup.test"],
      credentials: true,
    });
    handleCorsPreflight(req, res, {
      origin: ["https://dup.test"],
      credentials: true,
    });
    const vary = (res._headers["vary"] || "").split(",").map((s) => s.trim());
    const occurrences = vary.filter((v) => v.toLowerCase() === "origin").length;
    expect(occurrences).toBe(1);
  });
});
