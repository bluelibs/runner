import { createAuthenticator } from "../exposure/authenticator";
import { makeRequestListener, startHttpServer, stopHttpServer } from "../exposure/serverLifecycle";

describe("node exposure helpers", () => {
  describe("createAuthenticator", () => {
    it("returns passthrough when token is not configured", () => {
      const auth = createAuthenticator();
      const result = auth({ headers: {} } as any);
      expect(result).toEqual({ ok: true });
    });

    it("accepts provided token using custom header and array values", () => {
      const auth = createAuthenticator({ header: "X-Custom", token: "secret" });
      const ok = auth({ headers: { "x-custom": ["secret"] } } as any);
      expect(ok).toEqual({ ok: true });
    });

    it("accepts provided token from default header string", () => {
      const auth = createAuthenticator({ token: "expected" });
      const ok = auth({ headers: { "x-runner-token": "expected" } } as any);
      expect(ok).toEqual({ ok: true });
    });

    it("rejects when token mismatches", () => {
      const auth = createAuthenticator({ token: "expected" });
      const result = auth({ headers: {} } as any);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(401);
      }
    });

    it("falls back to empty string when header array has no first value", () => {
      const auth = createAuthenticator({ token: "expected" });
      const result = auth({ headers: { "x-runner-token": [] } } as any);
      expect(result.ok).toBe(false);
    });
  });

  describe("makeRequestListener", () => {
    const invokeListener = async (listener: ReturnType<typeof makeRequestListener>, res: any) => {
      await new Promise<void>((resolve) => {
        listener({} as any, res);
        setImmediate(resolve);
      });
    };

    const createResponse = () => ({
      statusCode: 0,
      writableEnded: false,
      headers: new Map<string, string>(),
      payload: Buffer.alloc(0),
      setHeader(key: string, value: string) {
        this.headers.set(key.toLowerCase(), value);
      },
      end(payload?: any) {
        this.writableEnded = true;
        if (payload != null) {
          this.payload = Buffer.isBuffer(payload)
            ? payload
            : Buffer.from(String(payload));
        }
      },
    });

    it("responds with 404 when handler reports miss", async () => {
      const logger = { error: () => {} } as any;
      const res = createResponse();
      const listener = makeRequestListener({
        handler: async () => false,
        respondOnMiss: true,
        logger,
      });
      await invokeListener(listener, res);
      expect(res.statusCode).toBe(404);
      expect(res.writableEnded).toBe(true);
    });

    it("ignores miss when respondOnMiss is disabled", async () => {
      const logger = { error: () => {} } as any;
      const res = createResponse();
      const listener = makeRequestListener({
        handler: async () => false,
        respondOnMiss: false,
        logger,
      });
      await invokeListener(listener, res);
      expect(res.writableEnded).toBe(false);
      expect(res.statusCode).toBe(0);
    });

    it("skips response when already ended on miss", async () => {
      const logger = { error: () => {} } as any;
      const res = createResponse();
      res.writableEnded = true;
      const listener = makeRequestListener({
        handler: async () => false,
        respondOnMiss: true,
        logger,
      });
      await invokeListener(listener, res);
      expect(res.statusCode).toBe(0);
    });

    it("writes 500 when handler throws", async () => {
      const errors: Array<Record<string, unknown>> = [];
      const logger = { error: (_: string, data: Record<string, unknown>) => errors.push(data) } as any;
      const res = createResponse();
      const listener = makeRequestListener({
        handler: async () => {
          throw new Error("boom");
        },
        respondOnMiss: false,
        logger,
      });
      await invokeListener(listener, res);
      expect(res.statusCode).toBe(500);
      expect(res.writableEnded).toBe(true);
      expect(JSON.parse(res.payload.toString()).error.code).toBe("INTERNAL_ERROR");
      expect(errors[0]?.error).toBe("boom");
    });

    it("does not write response when handler throws after response ended", async () => {
      const logger = { error: () => {} } as any;
      const res = createResponse();
      res.writableEnded = true;
      const listener = makeRequestListener({
        handler: async () => {
          throw new Error("late");
        },
        respondOnMiss: true,
        logger,
      });
      await invokeListener(listener, res);
      expect(res.statusCode).toBe(0);
      expect(res.payload.length).toBe(0);
    });
  });

  describe("server lifecycle helpers", () => {
    it("startHttpServer uses default host when host omitted", async () => {
      const calls: Array<{ port: number; host: string }> = [];
      const fakeServer: any = {
        listen(port: number, host: string, cb: () => void) {
          calls.push({ port, host });
          cb();
        },
      };
      await startHttpServer(fakeServer, { port: 4321 });
      expect(calls).toEqual([{ port: 4321, host: "127.0.0.1" }]);
    });

    it("startHttpServer uses provided host and stopHttpServer closes server", async () => {
      const calls: Array<{ port: number; host: string }> = [];
      let closed = false;
      const fakeServer: any = {
        listen(port: number, host: string, cb: () => void) {
          calls.push({ port, host });
          cb();
        },
        close(cb: () => void) {
          closed = true;
          cb();
        },
      };
      await startHttpServer(fakeServer, { port: 1234, host: "0.0.0.0" });
      expect(calls).toEqual([{ port: 1234, host: "0.0.0.0" }]);
      await stopHttpServer(fakeServer);
      expect(closed).toBe(true);
    });
  });
});
