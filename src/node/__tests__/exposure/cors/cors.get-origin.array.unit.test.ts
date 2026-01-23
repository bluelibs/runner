import type { IncomingMessage, ServerResponse } from "http";
import { handleCorsPreflight } from "../../../exposure/cors";

function makeRes() {
  const headers: Record<string, string> = {};
  const res: any = {
    setHeader(k: string, v: string) {
      headers[k.toLowerCase()] = v;
    },
    getHeader(k: string) {
      return headers[k.toLowerCase()];
    },
    end() {},
  };
  return { res: res as ServerResponse, headers };
}

describe("cors getRequestOrigin array branches", () => {
  it("handles origin as array and Origin as array", () => {
    const req1 = {
      method: "OPTIONS",
      headers: { origin: ["https://a", "https://b"] },
    } as unknown as IncomingMessage;
    const { res: res1, headers: h1 } = makeRes();
    handleCorsPreflight(req1, res1, { origin: /.*/ });
    expect(h1["access-control-allow-origin"]).toBe("https://a");

    const req2 = {
      method: "OPTIONS",
      headers: { Origin: ["https://x", "https://y"] },
    } as unknown as IncomingMessage;
    const { res: res2, headers: h2 } = makeRes();
    handleCorsPreflight(req2, res2, { origin: /.*/ });
    expect(h2["access-control-allow-origin"]).toBe("https://x");
  });
});
