import { createRequestHandlers } from "../../../exposure/requestHandlers";
import { defineError } from "../../../../definers/defineError";
import { getDefaultSerializer } from "../../../../serializer";
import * as requestBody from "../../../exposure/requestBody";
import { cancellationError } from "../../../../errors";
import {
  createReqRes,
  HeaderName,
  HttpMethod,
  MimeType,
  type NodeLikeHeaders,
} from "./requestHandlers.test.utils";

describe("requestHandlers - task handling", () => {
  const serializer = getDefaultSerializer();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("Application Errors and Sanitization", () => {
    it("includes id and data for known application errors", async () => {
      const AppError = defineError<{ code: number; message: string }>({
        id: "tests.errors.app",
      });
      const deps: any = {
        store: {
          tasks: new Map([["t.app", { task: { id: "t.app" } }]]),
          errors: new Map([[AppError.id, AppError]]),
        },
        taskRunner: {
          run: async () => AppError.throw({ code: 7, message: "Nope" }),
        },
        eventManager: {} as any,
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        authenticator: async () => ({ ok: true }),
        allowList: { ensureTask: () => null, ensureEvent: () => null },
        router: {
          basePath: "/api",
          extract: (_p: string) => ({ kind: "task", id: "t.app" }),
          isUnderBase: () => true,
        },
        cors: undefined,
        serializer,
      };

      const { handleTask } = createRequestHandlers(deps);
      const { req, res } = createReqRes({
        method: HttpMethod.Post,
        url: `/api/task/${encodeURIComponent("t.app")}`,
        headers: { [HeaderName.ContentType]: MimeType.ApplicationJson },
        body: JSON.stringify({ input: { a: 1 } }),
      });
      await handleTask(req, res);
      const json = res._buf ? serializer.parse((res._buf as Buffer).toString("utf8")) : undefined;
      expect(res._status).toBe(500);
      expect(json?.error?.id).toBe("tests.errors.app");
      expect(json?.error?.data).toEqual({ code: 7, message: "Nope" });
    });

    it("omits id when the matched error has a non-string name", async () => {
      const helper = {
        id: "tests.errors.non-string-name",
        is: (_e: unknown): _e is { name: number; data: unknown } => true,
      };
      const deps: any = {
        store: {
          tasks: new Map([["t.app", { task: { id: "t.app" } }]]),
          errors: new Map([[helper.id, helper]]),
        },
        taskRunner: {
          run: async () => { throw { name: 123, data: { reason: "x" } }; },
        },
        eventManager: {} as any,
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        authenticator: async () => ({ ok: true }),
        allowList: { ensureTask: () => null, ensureEvent: () => null },
        router: {
          basePath: "/api",
          extract: (_p: string) => ({ kind: "task", id: "t.app" }),
          isUnderBase: () => true,
        },
        cors: undefined,
        serializer,
      };

      const { handleTask } = createRequestHandlers(deps);
      const { req, res } = createReqRes({
        method: HttpMethod.Post,
        url: `/api/task/${encodeURIComponent("t.app")}`,
        headers: { [HeaderName.ContentType]: MimeType.ApplicationJson },
        body: JSON.stringify({ input: { a: 1 } }),
      });
      await handleTask(req, res);
      const json = res._buf ? serializer.parse((res._buf as Buffer).toString("utf8")) : undefined;
      expect(res._status).toBe(500);
      expect(json?.error?.id).toBeUndefined();
      expect(json?.error?.data).toEqual({ reason: "x" });
    });
  });

  describe("Context Hydration", () => {
    it("hydrates async context around taskRunner.run", async () => {
      let current: any;
      const ctx = {
        id: "ctx.demo",
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
          tasks: new Map([["t.ctx", { task: { id: "t.ctx" } }]]),
          errors: new Map(),
          asyncContexts: new Map([[ctx.id, ctx]]),
        },
        taskRunner: {
          run: async () => {
            expect(ctx.use().v).toBe(1);
            return 123;
          },
        },
        eventManager: {} as any,
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        authenticator: async () => ({ ok: true }),
        allowList: { ensureTask: () => null, ensureEvent: () => null },
        router: {
          basePath: "/api",
          extract: (_p: string) => ({ kind: "task", id: "t.ctx" }),
          isUnderBase: () => true,
        },
        cors: undefined,
        serializer,
      };

      const { handleTask } = createRequestHandlers(deps);
      const headers = {
        [HeaderName.ContentType]: MimeType.ApplicationJson,
        [HeaderName.XRunnerContext]: serializer.stringify({ [ctx.id]: ctx.serialize({ v: 1 }) }),
      } satisfies NodeLikeHeaders;

      const { req, res } = createReqRes({
        method: HttpMethod.Post,
        url: `/api/task/${encodeURIComponent("t.ctx")}`,
        headers,
        body: JSON.stringify({ input: { a: 1 } }),
      });
      await handleTask(req, res);
      expect(res._status).toBe(200);
      const json = res._buf ? serializer.parse((res._buf as Buffer).toString("utf8")) : undefined;
      expect(json?.result).toBe(123);
    });

    it("hydrates context when header is provided as array (task)", async () => {
      let current: any;
      const ctx = {
        id: "ctx.demo2",
        use: () => current,
        serialize: (v: any) => JSON.stringify(v),
        parse: (s: string) => JSON.parse(s),
        provide: (v: any, fn: any) => { current = v; return fn(); },
        require: () => ({}) as any,
      } as any;

      const deps: any = {
        store: { tasks: new Map([["t.ctx.arr", { task: { id: "t.ctx.arr" } }]]), errors: new Map(), asyncContexts: new Map([[ctx.id, ctx]]) },
        taskRunner: { run: async () => { expect(ctx.use().v).toBe(2); return 321; } },
        eventManager: {} as any,
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        authenticator: async () => ({ ok: true }),
        allowList: { ensureTask: () => null, ensureEvent: () => null },
        router: { basePath: "/api", extract: () => ({ kind: "task", id: "t.ctx.arr" }), isUnderBase: () => true },
        cors: undefined,
        serializer,
      };
      const { handleTask } = createRequestHandlers(deps);
      const headerText = serializer.stringify({ [ctx.id]: ctx.serialize({ v: 2 }) });
      const headers = {
        [HeaderName.ContentType]: MimeType.ApplicationJson,
        [HeaderName.XRunnerContext]: [headerText],
      } satisfies NodeLikeHeaders;

      const { req, res } = createReqRes({ method: HttpMethod.Post, url: "/api/task/t.ctx.arr", headers, body: JSON.stringify({ input: { a: 1 } }) });
      await handleTask(req, res);
      expect(res._status).toBe(200);
      const json = res._buf ? serializer.parse((res._buf as Buffer).toString("utf8")) : undefined;
      expect(json?.result).toBe(321);
    });
  });

  describe("Cancellations", () => {
    it("responds 499 when readJsonBody rejects with CancellationError (task)", async () => {
      const cancellation = (() => {
        try { cancellationError.throw({ reason: "Client Closed Request" }); } catch (error) { return error; }
      })();
      jest.spyOn(requestBody, "readJsonBody").mockRejectedValue(cancellation);

      const deps: any = {
        store: { tasks: new Map([["t.id", { task: { id: "t.id" } }]]) },
        taskRunner: { run: async () => {} },
        eventManager: { emit: async () => {} },
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        authenticator: async () => ({ ok: true }),
        allowList: { ensureTask: () => null, ensureEvent: () => null },
        router: {
          basePath: "/api",
          extract: (_p: string) => ({ kind: "task", id: "t.id" }),
          isUnderBase: () => true,
        },
        cors: undefined,
      };

      const { handleTask } = createRequestHandlers(deps);
      const { req, res } = createReqRes({
        method: HttpMethod.Post,
        url: "/api/task/t.id",
        headers: { [HeaderName.ContentType]: MimeType.ApplicationJson },
        body: null,
        autoEnd: true,
        autoCloseOnOnce: true,
      });
      await handleTask(req, res);
      expect(res._status).toBe(499);
      const json = res._buf ? JSON.parse((res._buf as Buffer).toString("utf8")) : undefined;
      expect(json?.error?.code).toBe("REQUEST_ABORTED");
    });
  });
});
