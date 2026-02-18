import * as http from "http";
import { createRequestHandlers } from "../../../exposure/requestHandlers";
import { defineError } from "../../../../definers/defineError";
import { Serializer } from "../../../../serializer";
import { defineResource, defineEvent, defineHook } from "../../../../define";
import { run } from "../../../../run";
import { nodeExposure } from "../../../exposure/resource";
import * as requestBody from "../../../exposure/requestBody";
import { cancellationError, createMessageError } from "../../../../errors";
import { globalTags } from "../../../../globals/globalTags";
import {
  createReqRes,
  HeaderName,
  HttpMethod,
  MimeType,
  type NodeLikeHeaders,
} from "./requestHandlers.test.utils";

describe("requestHandlers - event handling", () => {
  const serializer = new Serializer();

  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  describe("Application Errors and Sanitization", () => {
    it("includes id and data for known application errors", async () => {
      const AppError = defineError<{ code: number; message: string }>({
        id: "tests.errors.app.ev",
        httpCode: 410,
      });
      const deps: any = {
        store: {
          events: new Map([["e.app", { event: { id: "e.app" } }]]),
          errors: new Map([[AppError.id, AppError]]),
        },
        taskRunner: {} as any,
        eventManager: {
          emit: async () => {
            AppError.throw({ code: 9, message: "Ev" });
          },
        },
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        authenticator: async () => ({ ok: true }),
        allowList: { ensureTask: () => null, ensureEvent: () => null },
        router: {
          basePath: "/api",
          extract: (_p: string) => ({ kind: "event", id: "e.app" }),
          isUnderBase: () => true,
        },
        cors: undefined,
        serializer,
      };

      const { handleEvent } = createRequestHandlers(deps);
      const { req, res } = createReqRes({
        method: HttpMethod.Post,
        url: `/api/event/${encodeURIComponent("e.app")}`,
        headers: { [HeaderName.ContentType]: MimeType.ApplicationJson },
        body: JSON.stringify({ payload: { x: 1 } }),
      });
      await handleEvent(req, res);
      const json = res._buf
        ? (serializer.parse((res._buf as Buffer).toString("utf8")) as any)
        : undefined;
      expect(res._status).toBe(410);
      expect(json?.error?.id).toBe("tests.errors.app.ev");
      expect(json?.error?.data).toEqual({ code: 9, message: "Ev" });
      expect(json?.error?.httpCode).toBe(410);
    });

    it("omits id when the matched error has a non-string name", async () => {
      const helper = {
        id: "tests.errors.non-string-name.ev",
        is: (_e: unknown): _e is { name: number; data: unknown } => true,
      };
      const deps: any = {
        store: {
          events: new Map([["e.app", { event: { id: "e.app" } }]]),
          errors: new Map([[helper.id, helper]]),
        },
        taskRunner: {} as any,
        eventManager: {
          emit: async () => {
            throw { name: 123, data: { reason: "ev" } };
          },
        },
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        authenticator: async () => ({ ok: true }),
        allowList: { ensureTask: () => null, ensureEvent: () => null },
        router: {
          basePath: "/api",
          extract: (_p: string) => ({ kind: "event", id: "e.app" }),
          isUnderBase: () => true,
        },
        cors: undefined,
        serializer,
      };

      const { handleEvent } = createRequestHandlers(deps);
      const { req, res } = createReqRes({
        method: HttpMethod.Post,
        url: `/api/event/${encodeURIComponent("e.app")}`,
        headers: { [HeaderName.ContentType]: MimeType.ApplicationJson },
        body: JSON.stringify({ payload: { x: 1 } }),
      });
      await handleEvent(req, res);
      const json = res._buf
        ? (serializer.parse((res._buf as Buffer).toString("utf8")) as any)
        : undefined;
      expect(res._status).toBe(500);
      expect(json?.error?.id).toBeUndefined();
      expect(json?.error?.data).toEqual({ reason: "ev" });
    });

    it("returns 500 with generic message when hook throws a string (displayMessage fallback)", async () => {
      const deps: any = {
        store: {
          events: new Map([["e.str", { event: { id: "e.str" } }]]),
          errors: new Map(),
        },
        taskRunner: {} as any,
        eventManager: {
          emit: async () => {
            throw "bad string error";
          },
        },
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        authenticator: async () => ({ ok: true }),
        allowList: { ensureTask: () => null, ensureEvent: () => null },
        router: {
          basePath: "/api",
          extract: () => ({ kind: "event", id: "e.str" }),
          isUnderBase: () => true,
        },
        cors: undefined,
        serializer,
      };

      const { handleEvent } = createRequestHandlers(deps);
      const { req, res } = createReqRes({
        method: HttpMethod.Post,
        url: "/api/event/e.str",
        headers: { [HeaderName.ContentType]: MimeType.ApplicationJson },
        body: "{}",
      });
      await handleEvent(req, res);
      expect(res._status).toBe(500);
      const json = res._buf
        ? (serializer.parse((res._buf as Buffer).toString("utf8")) as any)
        : undefined;
      expect(json?.error?.message).toBe("Internal Error");
    });
  });

  describe("Context Hydration", () => {
    it("hydrates async context around event emit", async () => {
      let current: any;
      const ctx = {
        id: "ctx.ev",
        use: () => current,
        serialize: (v: any) => JSON.stringify(v),
        parse: (s: string) => JSON.parse(s),
        provide: (v: any, fn: any) => {
          current = v;
          return fn();
        },
        require: () => ({}) as any,
      } as any;

      const deps: any = {
        store: {
          events: new Map([["e.ctx", { event: { id: "e.ctx" } }]]),
          errors: new Map(),
          asyncContexts: new Map([[ctx.id, ctx]]),
        },
        taskRunner: {} as any,
        eventManager: {
          emit: async () => {
            expect(ctx.use().w).toBe(2);
          },
        },
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        authenticator: async () => ({ ok: true }),
        allowList: { ensureTask: () => null, ensureEvent: () => null },
        router: {
          basePath: "/api",
          extract: (_p: string) => ({ kind: "event", id: "e.ctx" }),
          isUnderBase: () => true,
        },
        cors: undefined,
        serializer,
      };

      const { handleEvent } = createRequestHandlers(deps);
      const headers = {
        [HeaderName.ContentType]: MimeType.ApplicationJson,
        [HeaderName.XRunnerContext]: serializer.stringify({
          [ctx.id]: ctx.serialize({ w: 2 }),
        }),
      } satisfies NodeLikeHeaders;

      const { req, res } = createReqRes({
        method: HttpMethod.Post,
        url: `/api/event/${encodeURIComponent("e.ctx")}`,
        headers,
        body: JSON.stringify({ payload: { a: 1 } }),
      });
      await handleEvent(req, res);
      expect(res._status).toBe(200);
    });

    it("hydrates context when header is provided as array (event)", async () => {
      let current: any;
      const ctx = {
        id: "ctx.ev2",
        use: () => current,
        serialize: (v: any) => JSON.stringify(v),
        parse: (s: string) => JSON.parse(s),
        provide: (v: any, fn: any) => {
          current = v;
          return fn();
        },
        require: () => ({}) as any,
      } as any;

      const deps: any = {
        store: {
          events: new Map([["e.ctx.arr", { event: { id: "e.ctx.arr" } }]]),
          errors: new Map(),
          asyncContexts: new Map([[ctx.id, ctx]]),
        },
        taskRunner: {} as any,
        eventManager: {
          emit: async () => {
            expect(ctx.use().w).toBe(7);
          },
        },
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        authenticator: async () => ({ ok: true }),
        allowList: { ensureTask: () => null, ensureEvent: () => null },
        router: {
          basePath: "/api",
          extract: () => ({ kind: "event", id: "e.ctx.arr" }),
          isUnderBase: () => true,
        },
        cors: undefined,
        serializer,
      };

      const { handleEvent } = createRequestHandlers(deps);
      const headerText = serializer.stringify({
        [ctx.id]: ctx.serialize({ w: 7 }),
      });
      const headers = {
        [HeaderName.ContentType]: MimeType.ApplicationJson,
        [HeaderName.XRunnerContext]: [headerText],
      } satisfies NodeLikeHeaders;

      const { req, res } = createReqRes({
        method: HttpMethod.Post,
        url: "/api/event/e.ctx.arr",
        headers,
        body: JSON.stringify({ payload: { a: 1 } }),
      });
      await handleEvent(req, res);
      expect(res._status).toBe(200);
    });

    it("skips async context hydration when tunnel policy disables it", async () => {
      let current: any;
      const parse = jest.fn((s: string) => JSON.parse(s));
      const provide = jest.fn((v: any, fn: any) => {
        current = v;
        return fn();
      });
      const ctx = {
        id: "ctx.ev.disabled",
        use: () => current,
        serialize: (v: any) => JSON.stringify(v),
        parse,
        provide,
        require: () => ({}) as any,
      } as any;

      const deps: any = {
        store: {
          events: new Map([
            ["e.ctx.disabled", { event: { id: "e.ctx.disabled" } }],
          ]),
          resources: new Map([
            [
              "srv",
              {
                resource: { id: "srv", tags: [globalTags.tunnel] },
                value: {
                  mode: "server",
                  transport: "http",
                  allowAsyncContext: false,
                  events: ["e.ctx.disabled"],
                },
              },
            ],
          ]),
          errors: new Map(),
          asyncContexts: new Map([[ctx.id, ctx]]),
        },
        taskRunner: {} as any,
        eventManager: {
          emit: async () => {
            expect(ctx.use()).toBeUndefined();
          },
        },
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        authenticator: async () => ({ ok: true }),
        allowList: { ensureTask: () => null, ensureEvent: () => null },
        router: {
          basePath: "/api",
          extract: () => ({ kind: "event", id: "e.ctx.disabled" }),
          isUnderBase: () => true,
        },
        cors: undefined,
        serializer,
      };

      const { handleEvent } = createRequestHandlers(deps);
      const headers = {
        [HeaderName.ContentType]: MimeType.ApplicationJson,
        [HeaderName.XRunnerContext]: serializer.stringify({
          [ctx.id]: ctx.serialize({ w: 8 }),
        }),
      } satisfies NodeLikeHeaders;

      const { req, res } = createReqRes({
        method: HttpMethod.Post,
        url: "/api/event/e.ctx.disabled",
        headers,
        body: JSON.stringify({ payload: { a: 1 } }),
      });
      await handleEvent(req, res);
      expect(res._status).toBe(200);
      expect(parse).not.toHaveBeenCalled();
      expect(provide).not.toHaveBeenCalled();
    });

    it("uses tunnel-level allowAsyncContext=false policy for event ids", async () => {
      let current: any;
      const parse = jest.fn((s: string) => JSON.parse(s));
      const provide = jest.fn((v: any, fn: any) => {
        current = v;
        return fn();
      });
      const ctx = {
        id: "ctx.tunnel.policy.event",
        use: () => current,
        serialize: (v: any) => JSON.stringify(v),
        parse,
        provide,
        require: () => ({}) as any,
      } as any;

      const deps: any = {
        store: {
          tasks: new Map(),
          events: new Map([
            ["e.ctx.policy", { event: { id: "e.ctx.policy" } }],
          ]),
          resources: new Map([
            [
              "srv",
              {
                resource: { id: "srv", tags: [globalTags.tunnel] },
                value: {
                  mode: "server",
                  transport: "http",
                  allowAsyncContext: false,
                  events: ["e.ctx.policy"],
                },
              },
            ],
          ]),
          errors: new Map(),
          asyncContexts: new Map([[ctx.id, ctx]]),
        },
        taskRunner: {} as any,
        eventManager: {
          emit: async () => {
            expect(ctx.use()).toBeUndefined();
          },
        },
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        authenticator: async () => ({ ok: true }),
        allowList: { ensureTask: () => null, ensureEvent: () => null },
        router: {
          basePath: "/api",
          extract: () => ({ kind: "event", id: "e.ctx.policy" }),
          isUnderBase: () => true,
        },
        cors: undefined,
        serializer,
      };

      const { handleEvent } = createRequestHandlers(deps);
      const headers = {
        [HeaderName.ContentType]: MimeType.ApplicationJson,
        [HeaderName.XRunnerContext]: serializer.stringify({
          [ctx.id]: ctx.serialize({ w: 9 }),
        }),
      } satisfies NodeLikeHeaders;
      const { req, res } = createReqRes({
        method: HttpMethod.Post,
        url: "/api/event/e.ctx.policy",
        headers,
        body: JSON.stringify({ payload: { a: 1 } }),
      });

      await handleEvent(req, res);
      expect(res._status).toBe(200);
      expect(parse).not.toHaveBeenCalled();
      expect(provide).not.toHaveBeenCalled();
    });
  });

  describe("Cancellations and Aborts", () => {
    it("responds 499 when readJsonBody rejects with CancellationError (event)", async () => {
      const cancellation = (() => {
        try {
          cancellationError.throw({ reason: "Client Closed Request" });
        } catch (error) {
          return error;
        }
      })();
      jest.spyOn(requestBody, "readJsonBody").mockRejectedValue(cancellation);

      const deps: any = {
        store: { events: new Map([["e.id", { event: { id: "e.id" } }]]) },
        taskRunner: {} as any,
        eventManager: { emit: async () => {} },
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        authenticator: async () => ({ ok: true }),
        allowList: { ensureTask: () => null, ensureEvent: () => null },
        router: {
          basePath: "/api",
          extract: (_p: string) => ({ kind: "event", id: "e.id" }),
          isUnderBase: () => true,
        },
        cors: undefined,
      };

      const { handleEvent } = createRequestHandlers(deps);
      const { req, res } = createReqRes({
        method: HttpMethod.Post,
        url: "/api/event/e.id",
        headers: { [HeaderName.ContentType]: MimeType.ApplicationJson },
        body: null,
        autoEnd: true,
        autoCloseOnOnce: true,
      });
      await handleEvent(req, res);
      expect(res._status).toBe(499);
      const json = res._buf
        ? JSON.parse((res._buf as Buffer).toString("utf8"))
        : undefined;
      expect(json?.error?.code).toBe("REQUEST_ABORTED");
    });

    it("handles abort via req 'aborted' signal", async () => {
      const deps: any = {
        store: { events: new Map([["e.id", { event: { id: "e.id" } }]]) },
        taskRunner: {} as any,
        eventManager: { emit: async () => {} },
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        authenticator: async () => ({ ok: true }),
        allowList: { ensureTask: () => null, ensureEvent: () => null },
        router: {
          basePath: "/api",
          extract: (_p: string) => ({ kind: "event", id: "e.id" }),
          isUnderBase: () => true,
        },
        cors: undefined,
      };

      const { handleEvent } = createRequestHandlers(deps);
      const { req, res } = createReqRes({
        method: HttpMethod.Post,
        url: "/api/event/e.id",
        headers: { [HeaderName.ContentType]: MimeType.ApplicationJson },
      });

      // Emit aborted right after handler starts
      setImmediate(() => (req as any).emit("aborted"));

      await handleEvent(req, res);
      const payload = res._buf
        ? JSON.parse((res._buf as Buffer).toString("utf8"))
        : undefined;
      expect(payload?.error?.code).toBe("REQUEST_ABORTED");
    });
  });

  describe("Return Payload", () => {
    it("responds with result when returnPayload is true", async () => {
      const emitWithResult = jest.fn(async () => ({ x: 2 }));
      const deps: any = {
        store: {
          events: new Map([["e.ret", { event: { id: "e.ret" } }]]),
          errors: new Map(),
          asyncContexts: new Map(),
        },
        taskRunner: {} as any,
        eventManager: { emit: jest.fn(async () => undefined), emitWithResult },
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        authenticator: async () => ({ ok: true }),
        allowList: { ensureTask: () => null, ensureEvent: () => null },
        router: {
          basePath: "/api",
          extract: (_p: string) => ({ kind: "event", id: "e.ret" }),
          isUnderBase: () => true,
        },
        cors: undefined,
        serializer,
      };

      const { handleEvent } = createRequestHandlers(deps);
      const { req, res } = createReqRes({
        method: HttpMethod.Post,
        url: "/api/event/e.ret",
        headers: { [HeaderName.ContentType]: MimeType.ApplicationJson },
        body: serializer.stringify({ payload: { x: 1 }, returnPayload: true }),
      });
      await handleEvent(req, res);
      const json = res._buf
        ? (serializer.parse((res._buf as Buffer).toString("utf8")) as any)
        : undefined;
      expect(res._status).toBe(200);
      expect(json?.result).toEqual({ x: 2 });
    });

    it("returns 400 when event is parallel and returnPayload is requested", async () => {
      const deps: any = {
        store: {
          events: new Map([
            ["e.par", { event: { id: "e.par", parallel: true } }],
          ]),
          errors: new Map(),
          asyncContexts: new Map(),
        },
        taskRunner: {} as any,
        eventManager: {
          emit: jest.fn(async () => undefined),
          emitWithResult: jest.fn(),
        },
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        authenticator: async () => ({ ok: true }),
        allowList: { ensureTask: () => null, ensureEvent: () => null },
        router: {
          basePath: "/api",
          extract: () => ({ kind: "event", id: "e.par" }),
          isUnderBase: () => true,
        },
        cors: undefined,
        serializer,
      };

      const { handleEvent } = createRequestHandlers(deps);
      const { req, res } = createReqRes({
        method: HttpMethod.Post,
        url: "/api/event/e.par",
        headers: { [HeaderName.ContentType]: MimeType.ApplicationJson },
        body: serializer.stringify({ payload: { x: 1 }, returnPayload: true }),
      });
      await handleEvent(req, res);
      expect(res._status).toBe(400);
      const json = res._buf
        ? (serializer.parse((res._buf as Buffer).toString("utf8")) as any)
        : undefined;
      expect(json?.error?.code).toBe("PARALLEL_EVENT_RETURN_UNSUPPORTED");
    });
  });

  describe("Integration Tests", () => {
    it("returns 500 when an event hook throws a normal error", async () => {
      const ev = defineEvent<{ payload?: unknown }>({ id: "tests.ev.err" });
      const hook = defineHook({
        id: "tests.ev.err.hook",
        on: ev,
        async run() {
          throw createMessageError("boom");
        },
      });
      const exposure = nodeExposure.with({
        http: {
          dangerouslyAllowOpenExposure: true,
          server: http.createServer(),
          basePath: "/__runner",
          auth: { allowAnonymous: true },
        },
      });
      const app = defineResource({
        id: "tests.app.ev.err",
        register: [ev, hook, exposure],
      });
      const rr = await run(app);
      try {
        const handlers = await rr.getResourceValue(exposure.resource as any);
        const { req, res } = createReqRes({
          method: HttpMethod.Post,
          url: `/__runner/event/${encodeURIComponent(ev.id)}`,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ payload: {} }),
        });
        await handlers.handleEvent(req, res);
        await new Promise((r) => setImmediate(r));
        expect(res.statusCode).toBe(500);
        const body = JSON.parse(res._buf!.toString("utf8"));
        expect(body.error?.code).toBe("INTERNAL_ERROR");
      } finally {
        await rr.dispose();
      }
    });

    it("routes kind:event through handleRequest() using createEventHandler", async () => {
      const processEventRequest = jest.fn(async () => undefined);
      jest.doMock("../../../exposure/handlers/eventHandler", () => ({
        createEventHandler: () => processEventRequest,
      }));

      const {
        createRequestHandlers: createHandlersMocked,
      } = require("../../../exposure/requestHandlers");
      const deps: any = {
        store: {
          tasks: new Map(),
          events: new Map([["e", { event: { id: "e" } }]]),
          errors: new Map(),
          asyncContexts: new Map(),
        },
        taskRunner: {} as any,
        eventManager: {} as any,
        logger: {
          info: () => undefined,
          warn: () => undefined,
          error: () => undefined,
        },
        authenticator: async () => ({ ok: true }),
        allowList: { ensureTask: () => null, ensureEvent: () => null },
        router: {
          basePath: "/api",
          extract: () => ({ kind: "event", id: "e" }),
          isUnderBase: () => true,
        },
        serializer,
        cors: undefined,
      };

      const { handleRequest } = createHandlersMocked(deps);
      const { req, res } = createReqRes({
        method: "POST",
        url: "/api/event/e",
      });

      const handled = await handleRequest(req, res);
      expect(handled).toBe(true);
      expect(processEventRequest).toHaveBeenCalledWith(req, res, "e");
    });
  });
});
