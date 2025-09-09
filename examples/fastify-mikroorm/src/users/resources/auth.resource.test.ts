import { buildTestRunner } from "#/general/test/utils";
import { auth } from "./auth.resource";

describe("auth resource", () => {
  const ORIG_ENV = { ...process.env };
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIG_ENV };
  });
  afterAll(() => {
    process.env = ORIG_ENV;
  });

  it("signs and verifies tokens, handles expiry and parse errors, cookie flags", async () => {
    const secret = "s3cr3t";
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const rr = await buildTestRunner({ register: [auth.with({ secret })] });
    try {
      const a = rr.getResourceValue(auth);

      // Valid token
      const t1 = a.createSessionToken("u1", 10);
      const p1 = a.verifyToken(t1);
      expect(p1?.sub).toBe("u1");

      // Expired token returns null
      const t2 = a.createSessionToken("u2", -1);
      expect(a.verifyToken(t2)).toBeNull();

      // Parse error path: craft invalid payload part
      // Build a token with valid signature but invalid JSON payload
      const header = { alg: "HS256", typ: "JWT" };
      const h = Buffer.from(JSON.stringify(header))
        .toString("base64")
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
      const p = Buffer.from("not-json")
        .toString("base64")
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
      const { createHmac } = require("crypto");
      const sig = createHmac("sha256", secret)
        .update(`${h}.${p}`)
        .digest("base64")
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
      const bad = `${h}.${p}.${sig}`;
      expect(a.verifyToken(bad)).toBeNull();

      // Cookies include Secure in production
      const cookie = a.buildAuthCookie("tok", 60);
      expect(cookie).toContain("Secure");
      const cleared = a.clearAuthCookie();
      expect(cleared).toContain("Secure");
    } finally {
      await rr.dispose();
      process.env.NODE_ENV = prev;
    }
  });
});
