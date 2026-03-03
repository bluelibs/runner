import { Readable } from "stream";
import { createRequestHandlers } from "../../../exposure/requestHandlers";
import { createAllowListGuard } from "../../../exposure/allowList";
import { Serializer } from "../../../../serializer";
import { defineResource, defineEvent } from "../../../../define";
import { run } from "../../../../run";
import { rpcExposure } from "../testkit/rpcExposure";
import {
  createReqRes,
  HeaderName,
  HttpMethod,
  MimeType,
} from "./requestHandlers.test.utils";

describe("requestHandlers - routing and dispatching", () => {
  const serializer = new Serializer();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("Method and URL Routing", () => {
    it("handleTask responds 405 for non-POST", async () => {
      const deps: any = {
        store: { tasks: new Map([["t.id", { task: async () => 1 }]]) },
        taskRunner: { run: async () => 1 },
        eventManager: {} as any,
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        authenticator: async () => ({ ok: true }),
        allowList: { ensureTask: () => null, ensureEvent: () => null },
        router: {
          basePath: "/api",
          extract: () => ({ kind: "task", id: "t.id" }),
          isUnderBase: () => true,
        },
        cors: undefined,
      };
      const { handleTask } = createRequestHandlers(deps);
      const { req, res } = createReqRes({
        method: "GET",
        url: "/api/task/t.id",
        headers: { [HeaderName.ContentType]: MimeType.ApplicationJson },
      });
      await handleTask(req, res);
      expect(res._status).toBe(405);
      const json = res._buf
        ? JSON.parse((res._buf as Buffer).toString("utf8"))
        : undefined;
      expect(json?.error?.code).toBe("METHOD_NOT_ALLOWED");
    });

    it("handleRequest returns false for paths outside basePath", async () => {
      const deps: any = {
        store: { tasks: new Map(), events: new Map() },
        taskRunner: {} as any,
        eventManager: {} as any,
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        authenticator: async () => ({ ok: true }),
        allowList: { ensureTask: () => null, ensureEvent: () => null },
        router: {
          basePath: "/api",
          extract: () => null,
          isUnderBase: () => false,
        },
        cors: undefined,
      };
      const { handleRequest } = createRequestHandlers(deps);
      const { req, res } = createReqRes({
        method: HttpMethod.Get,
        url: "/outside",
      });
      const handled = await handleRequest(req, res);
      expect(handled).toBe(false);
    });

    it("handleRequest returns true and 404 JSON when under base but no target", async () => {
      const deps: any = {
        store: { tasks: new Map(), events: new Map() },
        taskRunner: {} as any,
        eventManager: {} as any,
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        authenticator: async () => ({ ok: true }),
        allowList: { ensureTask: () => null, ensureEvent: () => null },
        router: {
          basePath: "/api",
          extract: () => null,
          isUnderBase: () => true,
        },
        cors: undefined,
      };
      const { handleRequest } = createRequestHandlers(deps);
      const { req, res } = createReqRes({
        method: HttpMethod.Get,
        url: "/api/",
      });
      const handled = await handleRequest(req, res);
      expect(handled).toBe(true);
      expect(res._status).toBe(404);
      const json = res._buf
        ? JSON.parse((res._buf as Buffer).toString("utf8"))
        : undefined;
      expect(json?.error?.code).toBe("NOT_FOUND");
    });

    it("handleRequest returns true for unknown extracted target kinds without dispatch", async () => {
      const deps: any = {
        store: {
          tasks: new Map(),
          events: new Map(),
          asyncContexts: new Map(),
        },
        taskRunner: {} as any,
        eventManager: {} as any,
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        authenticator: async () => ({ ok: true }),
        allowList: { ensureTask: () => null, ensureEvent: () => null },
        router: {
          basePath: "/api",
          extract: () => ({ kind: "other", id: "x" }),
          isUnderBase: () => true,
        },
        cors: undefined,
        serializer,
      };
      const { handleRequest } = createRequestHandlers(deps);
      const { req, res } = createReqRes({
        method: HttpMethod.Post,
        url: "/api/other/x",
      });
      await expect(handleRequest(req, res)).resolves.toBe(true);
      expect(res._status).toBeUndefined();
    });

    it("returns 404 when task id missing from store", async () => {
      const deps: any = {
        store: {
          tasks: new Map(),
          events: new Map(),
          asyncContexts: new Map(),
          resources: new Map(),
        },
        taskRunner: { run: async () => 1 },
        eventManager: { emit: async () => {} },
        logger: {
          info: async () => {},
          warn: async () => {},
          error: async () => {},
        },
        authenticator: async () => ({ ok: true }),
        allowList: { ensureTask: () => null, ensureEvent: () => null },
        router: {
          basePath: "/api",
          extract: () => ({ kind: "task", id: "missing" }),
          isUnderBase: () => true,
        },
        cors: undefined,
        serializer,
      };
      const { handleTask } = createRequestHandlers(deps);
      const { req, res } = createReqRes({
        method: HttpMethod.Post,
        url: "/api/task/missing",
        headers: { [HeaderName.ContentType]: MimeType.ApplicationJson },
      });
      await handleTask(req, res);
      expect(res._status).toBe(404);
      const json = res._buf
        ? (serializer.parse((res._buf as Buffer).toString("utf8")) as any)
        : undefined;
      expect(json?.error?.code).toBe("NOT_FOUND");
    });

    it("discovery resolves allow-list from rpc lane served ids", async () => {
      const store = {
        tasks: new Map([["task.a", { task: { id: "task.a" } }]]),
        events: new Map(),
        resources: new Map(),
        asyncContexts: new Map(),
      } as any;

      const deps: any = {
        store,
        taskRunner: { run: async () => 1 },
        eventManager: { emit: async () => {} },
        logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
        authenticator: async () => ({ ok: true }),
        allowList: { ensureTask: () => null, ensureEvent: () => null },
        router: {
          basePath: "/api",
          extract: () => ({ kind: "discovery" }),
          isUnderBase: () => true,
        },
        cors: undefined,
        serializer,
        policy: {
          enabled: true,
          taskIds: ["task.a"],
          eventIds: [],
          taskAllowAsyncContext: {},
          eventAllowAsyncContext: {},
          taskAsyncContextAllowList: {},
          eventAsyncContextAllowList: {},
        },
      };
      const { handleDiscovery } = createRequestHandlers(deps);
      const { req, res } = createReqRes({
        method: HttpMethod.Get,
        url: "/api/discovery",
      });

      await handleDiscovery(req, res);

      expect(res._status).toBe(200);
      const body = res._buf
        ? (serializer.parse((res._buf as Buffer).toString("utf8")) as any)
        : undefined;
      expect(body?.result?.allowList?.tasks).toContain("task.a");
    });
  });

  describe("Authentication and Authorization", () => {
    it("returns auth error when authenticator fails", async () => {
      const deps: any = {
        store: {
          tasks: new Map(),
          events: new Map(),
          asyncContexts: new Map(),
        },
        taskRunner: { run: async () => 1 },
        eventManager: { emit: async () => {} },
        logger: {
          info: async () => {},
          warn: async () => {},
          error: async () => {},
        },
        authenticator: async () => ({
          ok: false as const,
          response: {
            status: 401,
            body: { ok: false, error: { code: "UNAUTHORIZED" } },
          },
        }),
        allowList: { ensureTask: () => null, ensureEvent: () => null },
        router: {
          basePath: "/api",
          extract: () => ({ kind: "task", id: "t.id" }),
          isUnderBase: () => true,
        },
        cors: undefined,
        serializer,
      };
      const { handleTask } = createRequestHandlers(deps);
      const { req, res } = createReqRes({
        method: HttpMethod.Post,
        url: "/api/task/t.id",
        headers: { [HeaderName.ContentType]: MimeType.ApplicationJson },
      });
      await handleTask(req, res);
      expect(res._status).toBe(401);
      const json = res._buf
        ? (serializer.parse((res._buf as Buffer).toString("utf8")) as any)
        : undefined;
      expect(json?.error?.code).toBe("UNAUTHORIZED");
    });

    it("returns 403 when task/event blocked by allow-list", async () => {
      const policy = {
        enabled: true,
        taskIds: ["allowed.task"],
        eventIds: ["allowed.event"],
        taskAllowAsyncContext: {},
        eventAllowAsyncContext: {},
        taskAsyncContextAllowList: {},
        eventAsyncContextAllowList: {},
      } as const;
      const store: any = {
        tasks: new Map([["allowed.task", { task: { id: "allowed.task" } }]]),
        events: new Map([
          ["allowed.event", { event: { id: "allowed.event" } }],
        ]),
        resources: new Map(),
        asyncContexts: new Map(),
      };

      const deps: any = {
        store,
        taskRunner: { run: async () => 1 },
        eventManager: { emit: async () => {} },
        logger: {
          info: async () => {},
          warn: async () => {},
          error: async () => {},
        },
        authenticator: async () => ({ ok: true }),
        allowList: createAllowListGuard(policy),
        router: {
          basePath: "/api",
          extract: () => ({ kind: "task", id: "blocked.task" }),
          isUnderBase: () => true,
        },
        cors: undefined,
        serializer,
        policy,
      };

      const { handleTask, handleEvent } = createRequestHandlers(deps);

      // Task request blocked
      const { req: tReq, res: tRes } = createReqRes({
        method: HttpMethod.Post,
        url: "/api/task/blocked.task",
        headers: { [HeaderName.ContentType]: MimeType.ApplicationJson },
      });
      await handleTask(tReq, tRes);
      expect(tRes._status).toBe(403);

      // Event request blocked
      deps.router.extract = () => ({ kind: "event", id: "blocked.event" });
      const { req: eReq, res: eRes } = createReqRes({
        method: HttpMethod.Post,
        url: "/api/event/blocked.event",
        headers: { [HeaderName.ContentType]: MimeType.ApplicationJson },
      });
      await handleEvent(eReq, eRes);
      expect(eRes._status).toBe(403);
    });

    it("serializes blocked event responses with the configured serializer", async () => {
      const policy = {
        enabled: true,
        taskIds: [],
        eventIds: ["allowed.event"],
        taskAllowAsyncContext: {},
        eventAllowAsyncContext: {},
        taskAsyncContextAllowList: {},
        eventAsyncContextAllowList: {},
      } as const;
      const store: any = {
        tasks: new Map(),
        events: new Map([
          ["allowed.event", { event: { id: "allowed.event" } }],
        ]),
        resources: new Map(),
        asyncContexts: new Map(),
      };
      const customSerializer = {
        stringify: jest.fn(
          (value: unknown) => `wrapped:${JSON.stringify(value)}`,
        ),
        parse: jest.fn((text: string) =>
          JSON.parse(
            text.startsWith("wrapped:") ? text.slice("wrapped:".length) : text,
          ),
        ),
      };
      const deps: any = {
        store,
        taskRunner: { run: async () => 1 },
        eventManager: { emit: async () => {} },
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        authenticator: async () => ({ ok: true }),
        allowList: createAllowListGuard(policy),
        router: {
          basePath: "/api",
          extract: () => ({ kind: "event", id: "blocked.event" }),
          isUnderBase: () => true,
        },
        cors: undefined,
        serializer: customSerializer,
        policy,
      };

      const { handleEvent } = createRequestHandlers(deps);
      const { req, res } = createReqRes({
        method: HttpMethod.Post,
        url: "/api/event/blocked.event",
        headers: { [HeaderName.ContentType]: MimeType.ApplicationJson },
      });

      await handleEvent(req, res);
      expect(res._status).toBe(403);
      expect(res._buf?.toString("utf8")).toMatch(/^wrapped:/);
      expect(customSerializer.stringify).toHaveBeenCalled();
    });

    it("returns 403 when exposure is disabled", async () => {
      const policy = {
        enabled: false,
        taskIds: [],
        eventIds: [],
        taskAllowAsyncContext: {},
        eventAllowAsyncContext: {},
        taskAsyncContextAllowList: {},
        eventAsyncContextAllowList: {},
      } as const;
      const store: any = {
        tasks: new Map([["t", { task: { id: "t" } }]]),
        events: new Map(),
        asyncContexts: new Map(),
        resources: new Map(),
      };
      const deps: any = {
        store,
        taskRunner: { run: async () => 1 },
        eventManager: { emit: async () => {} },
        logger: {
          info: async () => {},
          warn: async () => {},
          error: async () => {},
        },
        authenticator: async () => ({ ok: true }),
        allowList: createAllowListGuard(policy),
        router: {
          basePath: "/api",
          extract: () => ({ kind: "task", id: "t" }),
          isUnderBase: () => true,
        },
        cors: undefined,
        serializer,
        policy,
      };
      const { handleTask } = createRequestHandlers(deps);
      const { req, res } = createReqRes({
        method: HttpMethod.Post,
        url: "/api/task/t",
        headers: { [HeaderName.ContentType]: MimeType.ApplicationJson },
      });
      await handleTask(req, res);
      expect(res._status).toBe(403);
      const json = res._buf
        ? (serializer.parse((res._buf as Buffer).toString("utf8")) as any)
        : undefined;
      expect(json?.error?.code).toBe("FORBIDDEN");
    });
  });

  describe("Edge Case Internal Routing", () => {
    it("handles early res.close and triggers listener wiring path", async () => {
      const ev = defineEvent<{ payload?: unknown }>({
        id: "tests.routing.abort",
      });
      const exposure = rpcExposure.with({
        http: {
          basePath: "/__runner",
          auth: { allowAnonymous: true },
        },
      });
      const app = defineResource({
        id: "tests.app.routing.abort",
        register: [ev, exposure],
      });
      const rr = await run(app);
      try {
        const handlers = await rr.getResourceValue(exposure as any);
        const req: any = new Readable({ read() {} });
        req.method = "POST";
        req.url = `/__runner/event/${encodeURIComponent(ev.id)}`;
        req.headers = { "content-type": "application/json" };
        req.once = undefined; // Force .on fallback

        const chunks: Buffer[] = [];
        const res: any = {
          statusCode: 0,
          headers: {},
          setHeader(k: string, v: string) {
            this.headers[k.toLowerCase()] = v;
          },
          write(p: any) {
            chunks.push(Buffer.from(p));
          },
          end(p: any) {
            if (p) this.write(p);
            this.writableEnded = true;
          },
          close() {
            this.writableEnded = true;
          },
        };

        setImmediate(() => {
          res.close();
          req.emit(
            "data",
            Buffer.from(JSON.stringify({ payload: {} }), "utf8"),
          );
          req.emit("end");
        });

        await handlers.handleEvent(req, res);
        await new Promise((r) => setImmediate(r));
        expect(res.statusCode === 0 || res.statusCode === 200).toBe(true);
      } finally {
        await rr.dispose();
      }
    });
  });
});
