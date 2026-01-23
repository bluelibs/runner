import { createAuthenticator } from "../../exposure/authenticator";
import {
  makeRequestListener,
  startHttpServer,
  stopHttpServer,
} from "../../exposure/serverLifecycle";
import { TaskRunner } from "../../../models/TaskRunner";
import { ITask } from "../../../defs";
import { IncomingMessage } from "http";
import { Logger } from "../../../models/Logger";

// Mock TaskRunner for tests
const mockTaskRunner = {
  run: jest.fn(),
} as unknown as jest.Mocked<TaskRunner>;

describe("node exposure helpers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("createAuthenticator", () => {
    it("returns AUTH_NOT_CONFIGURED when token is not set and no validators (fail-closed)", async () => {
      const auth = createAuthenticator(undefined, mockTaskRunner, []);
      const result = await auth({
        headers: {},
      } as unknown as IncomingMessage);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(500);
        expect(
          (result.response.body as unknown as { error: { code: string } }).error
            .code,
        ).toBe("AUTH_NOT_CONFIGURED");
      }
    });

    it("returns passthrough when allowAnonymous is explicitly true", async () => {
      const auth = createAuthenticator(
        { allowAnonymous: true },
        mockTaskRunner,
        [],
      );
      const result = await auth({ headers: {} } as unknown as IncomingMessage);
      expect(result).toEqual({ ok: true });
    });

    it("accepts provided token using custom header and array values", async () => {
      const auth = createAuthenticator(
        { header: "X-Custom", token: "secret" },
        mockTaskRunner,
        [],
      );
      const ok = await auth({
        headers: { "x-custom": ["secret"] },
      } as unknown as IncomingMessage);
      expect(ok).toEqual({ ok: true });
    });

    it("accepts provided token from default header string", async () => {
      const auth = createAuthenticator(
        { token: "expected" },
        mockTaskRunner,
        [],
      );
      const ok = await auth({
        headers: { "x-runner-token": "expected" },
      } as unknown as IncomingMessage);
      expect(ok).toEqual({ ok: true });
    });

    it("rejects when token mismatches", async () => {
      const auth = createAuthenticator(
        { token: "expected" },
        mockTaskRunner,
        [],
      );
      const result = await auth({ headers: {} } as unknown as IncomingMessage);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(401);
      }
    });

    it("falls back to empty string when header array has no first value", async () => {
      const auth = createAuthenticator(
        { token: "expected" },
        mockTaskRunner,
        [],
      );
      const result = await auth({
        headers: { "x-runner-token": [] },
      } as unknown as IncomingMessage);
      expect(result.ok).toBe(false);
    });

    it("supports array of tokens", async () => {
      const auth = createAuthenticator(
        { token: ["token1", "token2"] },
        mockTaskRunner,
        [],
      );
      const ok1 = await auth({
        headers: { "x-runner-token": "token1" },
      } as unknown as IncomingMessage);
      expect(ok1).toEqual({ ok: true });
      const ok2 = await auth({
        headers: { "x-runner-token": "token2" },
      } as unknown as IncomingMessage);
      expect(ok2).toEqual({ ok: true });
      const fail = await auth({
        headers: { "x-runner-token": "wrong" },
      } as unknown as IncomingMessage);
      expect(fail.ok).toBe(false);
    });

    it("runs validator tasks when token check fails", async () => {
      const task = {
        id: "v1",
      } as unknown as ITask;
      mockTaskRunner.run.mockResolvedValueOnce(Promise.resolve({ ok: true }));

      const auth = createAuthenticator(undefined, mockTaskRunner, [task]);
      const result = await auth({
        headers: {},
      } as unknown as IncomingMessage);

      expect(mockTaskRunner.run).toHaveBeenCalledWith(
        task,
        expect.objectContaining({
          url: "/",
          method: "GET",
        }),
      );
      expect(result).toEqual({ ok: true });
    });

    it("tries next validator if first fails", async () => {
      const t1 = { id: "v1" } as unknown as ITask;
      const t2 = { id: "v2" } as unknown as ITask;

      mockTaskRunner.run.mockResolvedValueOnce(Promise.resolve({ ok: false }));
      mockTaskRunner.run.mockResolvedValueOnce(Promise.resolve({ ok: true }));

      const auth = createAuthenticator(undefined, mockTaskRunner, [t1, t2]);
      const result = await auth({ headers: {} } as unknown as IncomingMessage);

      expect(result).toEqual({ ok: true });
      expect(mockTaskRunner.run).toHaveBeenCalledTimes(2);
    });

    it("treats validator exceptions as failures and continues", async () => {
      const t1 = { id: "v1" } as unknown as ITask;
      const t2 = { id: "v2" } as unknown as ITask;

      mockTaskRunner.run.mockRejectedValueOnce(new Error("oops"));
      mockTaskRunner.run.mockResolvedValueOnce(Promise.resolve({ ok: true }));

      const auth = createAuthenticator(undefined, mockTaskRunner, [t1, t2]);
      const result = await auth({ headers: {} } as unknown as IncomingMessage);

      expect(result).toEqual({ ok: true });
    });

    it("fails if all validators fail", async () => {
      const t1 = { id: "v1" } as unknown as ITask;
      mockTaskRunner.run.mockResolvedValueOnce(Promise.resolve({ ok: false }));

      const auth = createAuthenticator(undefined, mockTaskRunner, [t1]);
      const result = await auth({
        headers: {},
      } as unknown as IncomingMessage);

      expect(result.ok).toBe(false);
    });
  });

  describe("makeRequestListener", () => {
    const invokeListener = async (
      listener: ReturnType<typeof makeRequestListener>,
      res: any,
    ) => {
      await new Promise<void>((resolve) => {
        listener({} as unknown as import("http").IncomingMessage, res);
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
      const logger = {
        error: () => {},
      } as unknown as Logger;
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
      const logger = {
        error: () => {},
      } as unknown as Logger;
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
      const logger = {
        error: () => {},
      } as unknown as Logger;
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
      const logger = {
        error: (_: string, data: Record<string, unknown>) => errors.push(data),
      } as unknown as Logger;
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
      expect(JSON.parse(res.payload.toString()).error.code).toBe(
        "INTERNAL_ERROR",
      );
      expect(errors[0]?.error).toBe("boom");
    });

    it("does not write response when handler throws after response ended", async () => {
      const logger = {
        error: () => {},
      } as unknown as Logger;
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
      } as unknown as import("net").Server;
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
      } as unknown as import("net").Server;
      await startHttpServer(fakeServer, { port: 1234, host: "0.0.0.0" });
      expect(calls).toEqual([{ port: 1234, host: "0.0.0.0" }]);
      await stopHttpServer(fakeServer);
      expect(closed).toBe(true);
    });
  });
});
