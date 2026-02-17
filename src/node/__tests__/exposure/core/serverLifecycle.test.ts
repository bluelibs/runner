import {
  makeRequestListener,
  startHttpServer,
  stopHttpServer,
} from "../../../exposure/serverLifecycle";
import { Logger } from "../../../../models/Logger";
import { EventEmitter } from "events";
import { createMessageError } from "../../../../errors";

describe("node exposure - server lifecycle", () => {
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
      const logger = { error: () => {} } as unknown as Logger;
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
      const logger = { error: () => {} } as unknown as Logger;
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
      const logger = { error: () => {} } as unknown as Logger;
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
          throw createMessageError("boom");
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
      const logger = { error: () => {} } as unknown as Logger;
      const res = createResponse();
      res.writableEnded = true;
      const listener = makeRequestListener({
        handler: async () => {
          throw createMessageError("late");
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
      const fakeServer: any = Object.assign(new EventEmitter(), {
        listen(port: number, host: string, cb: () => void) {
          calls.push({ port, host });
          cb();
        },
      }) as unknown as import("net").Server;
      await startHttpServer(fakeServer, { port: 4321 });
      expect(calls).toEqual([{ port: 4321, host: "127.0.0.1" }]);
    });

    it("startHttpServer uses provided host and stopHttpServer closes server", async () => {
      const calls: Array<{ port: number; host: string }> = [];
      let closed = false;
      const fakeServer: any = Object.assign(new EventEmitter(), {
        listen(port: number, host: string, cb: () => void) {
          calls.push({ port, host });
          cb();
        },
        close(cb: () => void) {
          closed = true;
          cb();
        },
      }) as unknown as import("net").Server;
      await startHttpServer(fakeServer, { port: 1234, host: "0.0.0.0" });
      expect(calls).toEqual([{ port: 1234, host: "0.0.0.0" }]);
      await stopHttpServer(fakeServer);
      expect(closed).toBe(true);
    });

    it("startHttpServer rejects when server emits error", async () => {
      const fakeServer: any = Object.assign(new EventEmitter(), {
        listen(_port: number, _host: string, _cb: () => void) {
          setImmediate(() => {
            fakeServer.emit("error", new Error("listen failed"));
          });
        },
      }) as unknown as import("net").Server;

      await expect(startHttpServer(fakeServer, { port: 9999 })).rejects.toThrow(
        "listen failed",
      );
    });

    it("cleans temporary error listener when emitter-based listen throws", async () => {
      const fakeServer = Object.assign(new EventEmitter(), {
        listen() {
          throw createMessageError("sync emitter listen failed");
        },
      });

      await expect(
        startHttpServer(fakeServer as unknown as import("http").Server, {
          port: 6666,
        }),
      ).rejects.toThrow("sync emitter listen failed");
      expect(fakeServer.listenerCount("error")).toBe(0);
    });

    it("startHttpServer rejects when fallback listen throws", async () => {
      const fakeServer: any = {
        listen() {
          throw createMessageError("sync listen failed");
        },
      } as unknown as import("net").Server;

      await expect(startHttpServer(fakeServer, { port: 7777 })).rejects.toThrow(
        "sync listen failed",
      );
    });

    it("stopHttpServer rejects when close callback receives an error", async () => {
      const fakeServer: any = Object.assign(new EventEmitter(), {
        close(cb: (error?: Error) => void) {
          cb(new Error("close failed"));
        },
      }) as unknown as import("net").Server;

      await expect(stopHttpServer(fakeServer)).rejects.toThrow("close failed");
    });
  });
});
