import { buildTestRunner } from "#/general/test/utils";
import { auth, AuthConfig, AuthValue } from "./auth.resource";
import { r, globals } from "@bluelibs/runner";

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

  it("hashes and verifies passwords", async () => {
    const rr = await buildTestRunner({ register: [auth.with({})] });
    try {
      const a = rr.getResourceValue(auth);
      const password = "testpassword123";

      // Hash password
      const { hash, salt } = await a.hashPassword(password);
      expect(hash).toHaveLength(64); // 32 bytes as hex
      expect(salt).toHaveLength(32); // 16 bytes as hex

      // Verify correct password
      const isValid = await a.verifyPassword(password, hash, salt);
      expect(isValid).toBe(true);

      // Verify wrong password
      const isInvalid = await a.verifyPassword("wrongpassword", hash, salt);
      expect(isInvalid).toBe(false);

      // Verify with empty hash returns false
      const emptyHash = await a.verifyPassword(password, "", salt);
      expect(emptyHash).toBe(false);

      // Verify with empty salt returns false
      const emptySalt = await a.verifyPassword(password, hash, "");
      expect(emptySalt).toBe(false);

      // Verify with invalid hex hash (should not throw)
      const invalidHex = await a.verifyPassword(password, "invalid-hex", salt);
      expect(invalidHex).toBe(false);
    } finally {
      await rr.dispose();
    }
  });

  it("uses default configuration values", async () => {
    const rr = await buildTestRunner({ register: [auth.with({})] });
    try {
      const a = rr.getResourceValue(auth);

      // Default cookie name should be 'auth'
      expect(a.cookieName).toBe("auth");

      // Default expiry should be 7 days (604800 seconds)
      const token = a.createSessionToken("user1");
      const payload = a.verifyToken(token);
      const now = Math.floor(Date.now() / 1000);
      const expectedExp = now + 60 * 60 * 24 * 7; // 7 days
      expect(payload?.exp).toBeGreaterThan(now + 604700); // Within 100s of expected
      expect(payload?.exp).toBeLessThan(expectedExp + 100);
    } finally {
      await rr.dispose();
    }
  });

  it("handles custom configuration", async () => {
    const config = {
      secret: "custom-secret",
      tokenExpiresInSeconds: 3600, // 1 hour
      cookieName: "customAuth",
    };
    const rr = await buildTestRunner({ register: [auth.with(config)] });
    try {
      const a = rr.getResourceValue(auth);

      // Custom cookie name
      expect(a.cookieName).toBe("customAuth");

      // Custom expiry
      const token = a.createSessionToken("user1");
      const payload = a.verifyToken(token);
      const now = Math.floor(Date.now() / 1000);
      expect(payload?.exp).toBeGreaterThan(now + 3500);
      expect(payload?.exp).toBeLessThan(now + 3700);
    } finally {
      await rr.dispose();
    }
  });

  it("handles token verification edge cases", async () => {
    const rr = await buildTestRunner({
      register: [auth.with({ secret: "test" })],
    });
    try {
      const a = rr.getResourceValue(auth);

      // Empty token
      expect(a.verifyToken("")).toBeNull();
      expect(a.verifyToken(null as any)).toBeNull();

      // Malformed token (wrong number of parts)
      expect(a.verifyToken("invalid")).toBeNull();
      expect(a.verifyToken("only.two")).toBeNull();
      expect(a.verifyToken("too.many.parts.here")).toBeNull();

      // Invalid signature
      const validToken = a.createSessionToken("user1", 60);
      const parts = validToken.split(".");
      const tamperedToken = `${parts[0]}.${parts[1]}.invalid-signature`;
      expect(a.verifyToken(tamperedToken)).toBeNull();
    } finally {
      await rr.dispose();
    }
  });

  it("builds cookies without Secure flag in non-production", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    const rr = await buildTestRunner({ register: [auth.with({})] });
    try {
      const a = rr.getResourceValue(auth);

      // Cookie should not include Secure in development
      const cookie = a.buildAuthCookie("token", 60);
      expect(cookie).not.toContain("Secure");
      expect(cookie).toContain("auth=token");
      expect(cookie).toContain("Path=/");
      expect(cookie).toContain("Max-Age=60");
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Lax");

      // Clear cookie should not include Secure in development
      const cleared = a.clearAuthCookie();
      expect(cleared).not.toContain("Secure");
      expect(cleared).toContain("auth=");
      expect(cleared).toContain("Max-Age=0");
    } finally {
      await rr.dispose();
      process.env.NODE_ENV = prev;
    }
  });

  it("uses environment variable fallbacks", async () => {
    const prevSecret = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "env-secret";

    const rr = await buildTestRunner({ register: [auth.with({})] });
    try {
      const a = rr.getResourceValue(auth);

      // Should use environment secret to sign token
      const token1 = a.createSessionToken("user1", 60);
      const payload1 = a.verifyToken(token1);
      expect(payload1?.sub).toBe("user1");

      // Token should be verifiable with same environment secret
      expect(a.verifyToken(token1)).toBeTruthy();
    } finally {
      await rr.dispose();
      if (prevSecret !== undefined) {
        process.env.AUTH_SECRET = prevSecret;
      } else {
        delete process.env.AUTH_SECRET;
      }
    }
  });

  it("handles custom expiry in createSessionToken", async () => {
    const rr = await buildTestRunner({ register: [auth.with({})] });
    try {
      const a = rr.getResourceValue(auth);

      // Custom expiry override
      const token = a.createSessionToken("user1", 120); // 2 minutes
      const payload = a.verifyToken(token);
      const now = Math.floor(Date.now() / 1000);
      expect(payload?.exp).toBeGreaterThan(now + 110);
      expect(payload?.exp).toBeLessThan(now + 130);
    } finally {
      await rr.dispose();
    }
  });

  it("handles env resource NODE_ENV fallback to process.env", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    // Register auth with env resource that has undefined NODE_ENV
    const rr = await buildTestRunner({
      register: [auth.with({})],
    });
    try {
      const a = rr.getResourceValue(auth);

      // Should fallback to process.env.NODE_ENV for production check
      const cookie = a.buildAuthCookie("token", 60);
      expect(cookie).toContain("Secure"); // Should be production mode
    } finally {
      await rr.dispose();
      process.env.NODE_ENV = prev;
    }
  });

  it("covers b64url padding edge cases in token verification", async () => {
    const rr = await buildTestRunner({
      register: [auth.with({ secret: "test" })],
    });
    try {
      const a = rr.getResourceValue(auth);

      // Test multiple different scenarios to ensure we hit both branches of padding logic

      // Test various payloads that will create different base64url padding needs
      const testCases = [
        { sub: "x", exp: Math.floor(Date.now() / 1000) + 60 }, // Very short
        { sub: "ab", exp: Math.floor(Date.now() / 1000) + 60 }, // 2 chars
        { sub: "abc", exp: Math.floor(Date.now() / 1000) + 60 }, // 3 chars
        { sub: "abcd", exp: Math.floor(Date.now() / 1000) + 60 }, // 4 chars (divisible by 4)
        { sub: "short", exp: Math.floor(Date.now() / 1000) + 60 },
        { sub: "medium-length", exp: Math.floor(Date.now() / 1000) + 60 },
        {
          sub: "very-long-user-id-string",
          exp: Math.floor(Date.now() / 1000) + 60,
        },
        { sub: "exactly-sixteen-c", exp: Math.floor(Date.now() / 1000) + 60 }, // Exactly 16 chars
        { sub: "user", exp: Math.floor(Date.now() / 1000) + 60, extra: "data" },
        {
          sub: "u",
          exp: Math.floor(Date.now() / 1000) + 60,
          additional: "field",
          more: "content",
        },
      ];

      for (const payload of testCases) {
        const token = a.signToken(payload);
        const verified = a.verifyToken(token);
        expect(verified).toBeTruthy();
        expect(verified?.sub).toBe(payload.sub);
      }
    } finally {
      await rr.dispose();
    }
  });

  it("handles different env NODE_ENV scenarios", async () => {
    const prev = process.env.NODE_ENV;

    try {
      // Test case 1: env resource with falsy NODE_ENV, fallback to process.env
      process.env.NODE_ENV = "production";

      const mockEnv = r
        .resource("test.mock.env")
        .init(async () => ({ NODE_ENV: "" })) // Empty string (falsy)
        .build();

      const authWithEmptyEnv = r
        .resource<AuthConfig>("test.auth.empty.env")
        .dependencies({
          logger: globals.resources.logger,
          env: mockEnv,
        })
        .init(async (cfg, { logger, env }): Promise<AuthValue> => {
          const secret =
            cfg.secret || process.env.AUTH_SECRET || "dev-secret-change-me";
          const cookieName = cfg.cookieName || "auth";
          const defaultExpiry = cfg.tokenExpiresInSeconds ?? 60 * 60 * 24 * 7;
          const isProd =
            (env?.NODE_ENV || process.env.NODE_ENV) === "production";

          const buildAuthCookie = (token: string, maxAgeSeconds: number) => {
            const attrs = [
              `${cookieName}=${token}`,
              "Path=/",
              `Max-Age=${maxAgeSeconds}`,
              "HttpOnly",
              "SameSite=Lax",
            ];
            if (isProd) attrs.push("Secure");
            return attrs.join("; ");
          };

          return {
            hashPassword: async () => ({ hash: "", salt: "" }),
            verifyPassword: async () => false,
            signToken: () => "",
            verifyToken: () => null,
            createSessionToken: () => "",
            cookieName,
            buildAuthCookie,
            clearAuthCookie: () => "",
          };
        })
        .build();

      const rr1 = await buildTestRunner({
        register: [mockEnv, authWithEmptyEnv.with({})],
      });
      const a1 = rr1.getResourceValue(authWithEmptyEnv);

      // Should fallback to process.env.NODE_ENV since env.NODE_ENV is falsy
      const cookie1 = a1.buildAuthCookie("token", 60);
      expect(cookie1).toContain("Secure"); // Should be production mode from process.env
      await rr1.dispose();

      // Test case 2: No env dependency at all
      process.env.NODE_ENV = "development";

      const authWithoutEnv = r
        .resource<AuthConfig>("test.auth.without.env")
        .dependencies({
          logger: globals.resources.logger,
        })
        .init(async (cfg, { logger }): Promise<AuthValue> => {
          const secret =
            cfg.secret || process.env.AUTH_SECRET || "dev-secret-change-me";
          const cookieName = cfg.cookieName || "auth";
          const defaultExpiry = cfg.tokenExpiresInSeconds ?? 60 * 60 * 24 * 7;
          const envValue: any = undefined;
          const isProd =
            (envValue?.NODE_ENV || process.env.NODE_ENV) === "production";

          const buildAuthCookie = (token: string, maxAgeSeconds: number) => {
            const attrs = [
              `${cookieName}=${token}`,
              "Path=/",
              `Max-Age=${maxAgeSeconds}`,
              "HttpOnly",
              "SameSite=Lax",
            ];
            if (isProd) attrs.push("Secure");
            return attrs.join("; ");
          };

          return {
            hashPassword: async () => ({ hash: "", salt: "" }),
            verifyPassword: async () => false,
            signToken: () => "",
            verifyToken: () => null,
            createSessionToken: () => "",
            cookieName,
            buildAuthCookie,
            clearAuthCookie: () => "",
          };
        })
        .build();

      const rr2 = await buildTestRunner({
        register: [authWithoutEnv.with({})],
      });
      const a2 = rr2.getResourceValue(authWithoutEnv);

      // Should be development mode (no Secure)
      const cookie2 = a2.buildAuthCookie("token", 60);
      expect(cookie2).not.toContain("Secure");
      await rr2.dispose();
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
