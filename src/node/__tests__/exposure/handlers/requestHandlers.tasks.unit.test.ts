import { createRequestHandlers } from "../../../exposure/requestHandlers";
import { defineError } from "../../../../definers/defineError";
import { Serializer } from "../../../../serializer";
import * as requestBody from "../../../exposure/requestBody";
import { cancellationError } from "../../../../errors";
import { createRequestHandlersDeps } from "./requestHandlers.deps.test.utils";
import {
  createReqRes,
  HeaderName,
  HttpMethod,
  MimeType,
  type NodeLikeHeaders,
} from "./requestHandlers.test.utils";

describe("requestHandlers - task handling", () => {
  const serializer = new Serializer();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns authorizeTask response before task execution", async () => {
    const runSpy = jest.fn(async () => "ok");
    const deps = createRequestHandlersDeps(serializer, {
      store: {
        tasks: new Map([["t-authz", { task: { id: "t-authz" } }]]),
        errors: new Map(),
      },
      taskRunner: {
        run: runSpy,
      },
      eventManager: {},
      router: {
        extract: () => ({ kind: "task", id: "t-authz" }),
      },
      authorizeTask: async () => ({
        status: 401,
        body: {
          ok: false,
          error: { code: "UNAUTHORIZED", message: "Unauthorized" },
        },
      }),
    });

    const { handleTask } = createRequestHandlers(deps);
    const { req, res } = createReqRes({
      method: HttpMethod.Post,
      url: "/api/task/t-authz",
      headers: { [HeaderName.ContentType]: MimeType.ApplicationJson },
      body: JSON.stringify({ input: { a: 1 } }),
    });
    await handleTask(req, res);
    expect(runSpy).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
    const json = res._buf
      ? (serializer.parse((res._buf as Buffer).toString("utf8")) as any)
      : undefined;
    expect(json?.error?.code).toBe("UNAUTHORIZED");
  });

  it("returns authorizeTaskBody response before task execution", async () => {
    const runSpy = jest.fn(async () => "ok");
    const deps = createRequestHandlersDeps(serializer, {
      store: {
        tasks: new Map([["t-authz-body", { task: { id: "t-authz-body" } }]]),
        errors: new Map(),
      },
      taskRunner: {
        run: runSpy,
      },
      eventManager: {},
      router: {
        extract: () => ({ kind: "task", id: "t-authz-body" }),
      },
      authorizeTaskBody: async () => ({
        status: 401,
        body: {
          ok: false,
          error: { code: "UNAUTHORIZED", message: "Unauthorized" },
        },
      }),
    });

    const { handleTask } = createRequestHandlers(deps);
    const { req, res } = createReqRes({
      method: HttpMethod.Post,
      url: "/api/task/t-authz-body",
      headers: { [HeaderName.ContentType]: MimeType.ApplicationJson },
      body: JSON.stringify({ input: { a: 1 } }),
    });
    await handleTask(req, res);
    expect(runSpy).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
  });

  it("forwards the request abort signal into task execution", async () => {
    const runSpy = jest.fn(async () => "ok");
    const deps = createRequestHandlersDeps(serializer, {
      store: {
        tasks: new Map([["t-signal", { task: { id: "t-signal" } }]]),
        errors: new Map(),
      },
      taskRunner: {
        run: runSpy,
      },
      eventManager: {},
      router: {
        extract: () => ({ kind: "task", id: "t-signal" }),
      },
    });

    const { handleTask } = createRequestHandlers(deps);
    const { req, res } = createReqRes({
      method: HttpMethod.Post,
      url: "/api/task/t-signal",
      headers: { [HeaderName.ContentType]: MimeType.ApplicationJson },
      body: JSON.stringify({ input: { a: 1 } }),
    });

    await handleTask(req, res);

    expect(runSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: "t-signal" }),
      { a: 1 },
      expect.objectContaining({
        signal: expect.any(Object),
      }),
    );
    const call = runSpy.mock.calls[0] as unknown as [
      unknown,
      unknown,
      { signal: AbortSignal },
    ];
    expect(call[2].signal).toBeDefined();
  });

  describe("Application Errors and Sanitization", () => {
    it("includes id and data for known application errors", async () => {
      const AppError = defineError<{ code: number; message: string }>({
        id: "tests-errors-app",
        httpCode: 409,
      });
      const deps = createRequestHandlersDeps(serializer, {
        store: {
          tasks: new Map([["t-app", { task: { id: "t-app" } }]]),
          errors: new Map([[AppError.id, AppError]]),
        },
        taskRunner: {
          run: async () => AppError.throw({ code: 7, message: "Nope" }),
        },
        eventManager: {},
        router: {
          extract: (_p: string) => ({ kind: "task", id: "t-app" }),
        },
        policy: {
          enabled: true,
          taskIds: ["t-ctx-disabled"],
          eventIds: [],
          taskAllowAsyncContext: {
            "t-ctx-disabled": false,
          },
          eventAllowAsyncContext: {},
          taskAsyncContextAllowList: {},
          eventAsyncContextAllowList: {},
        },
      });

      const { handleTask } = createRequestHandlers(deps);
      const { req, res } = createReqRes({
        method: HttpMethod.Post,
        url: `/api/task/${encodeURIComponent("t-app")}`,
        headers: { [HeaderName.ContentType]: MimeType.ApplicationJson },
        body: JSON.stringify({ input: { a: 1 } }),
      });
      await handleTask(req, res);
      const json = res._buf
        ? (serializer.parse((res._buf as Buffer).toString("utf8")) as any)
        : undefined;
      expect(res._status).toBe(409);
      expect(json?.error?.id).toBe("tests-errors-app");
      expect(json?.error?.data).toEqual({ code: 7, message: "Nope" });
      expect(json?.error?.httpCode).toBe(409);
    });

    it("omits id when the matched error has a non-string name", async () => {
      const helper = {
        id: "tests-errors-non-string-name",
        is: (_e: unknown): _e is { name: number; data: unknown } => true,
      };
      const deps = createRequestHandlersDeps(serializer, {
        store: {
          tasks: new Map([["t-app", { task: { id: "t-app" } }]]),
          errors: new Map([[helper.id, helper]]),
        },
        taskRunner: {
          run: async () => {
            throw { name: 123, data: { reason: "x" } };
          },
        },
        eventManager: {},
        router: {
          extract: (_p: string) => ({ kind: "task", id: "t-app" }),
        },
        policy: {
          enabled: true,
          taskIds: ["t-ctx-policy"],
          eventIds: [],
          taskAllowAsyncContext: {
            "t-ctx-policy": false,
          },
          eventAllowAsyncContext: {},
          taskAsyncContextAllowList: {},
          eventAsyncContextAllowList: {},
        },
      });

      const { handleTask } = createRequestHandlers(deps);
      const { req, res } = createReqRes({
        method: HttpMethod.Post,
        url: `/api/task/${encodeURIComponent("t-app")}`,
        headers: { [HeaderName.ContentType]: MimeType.ApplicationJson },
        body: JSON.stringify({ input: { a: 1 } }),
      });
      await handleTask(req, res);
      const json = res._buf
        ? (serializer.parse((res._buf as Buffer).toString("utf8")) as any)
        : undefined;
      expect(res._status).toBe(500);
      expect(json?.error?.id).toBe("tests-errors-non-string-name");
      expect(json?.error?.data).toEqual({ reason: "x" });
    });
  });

  describe("Context Hydration", () => {
    it("hydrates async context around taskRunner.run", async () => {
      let current: any;
      const ctx = {
        id: "ctx-demo",
        use: () => current,
        serialize: (v: any) => JSON.stringify(v),
        parse: (s: string) => JSON.parse(s),
        provide: (v: any, fn: any) => {
          current = v;
          return fn();
        },
        require: () => ({}) as any,
      } as any;

      const deps = createRequestHandlersDeps(serializer, {
        store: {
          tasks: new Map([["t-ctx", { task: { id: "t-ctx" } }]]),
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
          extract: (_p: string) => ({ kind: "task", id: "t-ctx" }),
          isUnderBase: () => true,
        },
        cors: undefined,
      });

      const { handleTask } = createRequestHandlers(deps);
      const headers = {
        [HeaderName.ContentType]: MimeType.ApplicationJson,
        [HeaderName.XRunnerContext]: serializer.stringify({
          [ctx.id]: ctx.serialize({ v: 1 }),
        }),
      } satisfies NodeLikeHeaders;

      const { req, res } = createReqRes({
        method: HttpMethod.Post,
        url: `/api/task/${encodeURIComponent("t-ctx")}`,
        headers,
        body: JSON.stringify({ input: { a: 1 } }),
      });
      await handleTask(req, res);
      expect(res._status).toBe(200);
      const json = res._buf
        ? (serializer.parse((res._buf as Buffer).toString("utf8")) as any)
        : undefined;
      expect(json?.result).toBe(123);
    });

    it("hydrates context when header is provided as array (task)", async () => {
      let current: any;
      const ctx = {
        id: "ctx-demo2",
        use: () => current,
        serialize: (v: any) => JSON.stringify(v),
        parse: (s: string) => JSON.parse(s),
        provide: (v: any, fn: any) => {
          current = v;
          return fn();
        },
        require: () => ({}) as any,
      } as any;

      const deps = createRequestHandlersDeps(serializer, {
        store: {
          tasks: new Map([["t-ctx-arr", { task: { id: "t-ctx-arr" } }]]),
          errors: new Map(),
          asyncContexts: new Map([[ctx.id, ctx]]),
        },
        taskRunner: {
          run: async () => {
            expect(ctx.use().v).toBe(2);
            return 321;
          },
        },
        eventManager: {} as any,
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        authenticator: async () => ({ ok: true }),
        allowList: { ensureTask: () => null, ensureEvent: () => null },
        router: {
          basePath: "/api",
          extract: () => ({ kind: "task", id: "t-ctx-arr" }),
          isUnderBase: () => true,
        },
        cors: undefined,
      });
      const { handleTask } = createRequestHandlers(deps);
      const headerText = serializer.stringify({
        [ctx.id]: ctx.serialize({ v: 2 }),
      });
      const headers = {
        [HeaderName.ContentType]: MimeType.ApplicationJson,
        [HeaderName.XRunnerContext]: [headerText],
      } satisfies NodeLikeHeaders;

      const { req, res } = createReqRes({
        method: HttpMethod.Post,
        url: "/api/task/t-ctx-arr",
        headers,
        body: JSON.stringify({ input: { a: 1 } }),
      });
      await handleTask(req, res);
      expect(res._status).toBe(200);
      const json = res._buf
        ? (serializer.parse((res._buf as Buffer).toString("utf8")) as any)
        : undefined;
      expect(json?.result).toBe(321);
    });

    it("skips async context hydration when rpc-lane policy disables it", async () => {
      let current: any;
      const parse = jest.fn((s: string) => JSON.parse(s));
      const provide = jest.fn((v: any, fn: any) => {
        current = v;
        return fn();
      });
      const ctx = {
        id: "ctx-disabled",
        use: () => current,
        serialize: (v: any) => JSON.stringify(v),
        parse,
        provide,
        require: () => ({}) as any,
      } as any;

      const deps = createRequestHandlersDeps(serializer, {
        store: {
          tasks: new Map([
            ["t-ctx-disabled", { task: { id: "t-ctx-disabled" } }],
          ]),
          errors: new Map(),
          asyncContexts: new Map([[ctx.id, ctx]]),
        },
        taskRunner: {
          run: async () => {
            expect(ctx.use()).toBeUndefined();
            return "ok";
          },
        },
        eventManager: {} as any,
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        authenticator: async () => ({ ok: true }),
        allowList: { ensureTask: () => null, ensureEvent: () => null },
        router: {
          basePath: "/api",
          extract: () => ({ kind: "task", id: "t-ctx-disabled" }),
          isUnderBase: () => true,
        },
        cors: undefined,
        policy: {
          enabled: true,
          taskIds: ["t-ctx-disabled"],
          eventIds: [],
          taskAllowAsyncContext: {
            "t-ctx-disabled": false,
          },
          eventAllowAsyncContext: {},
          taskAsyncContextAllowList: {},
          eventAsyncContextAllowList: {},
        },
      });

      const { handleTask } = createRequestHandlers(deps);
      const headers = {
        [HeaderName.ContentType]: MimeType.ApplicationJson,
        [HeaderName.XRunnerContext]: serializer.stringify({
          [ctx.id]: ctx.serialize({ v: 99 }),
        }),
      } satisfies NodeLikeHeaders;

      const { req, res } = createReqRes({
        method: HttpMethod.Post,
        url: "/api/task/t-ctx-disabled",
        headers,
        body: JSON.stringify({ input: { a: 1 } }),
      });
      await handleTask(req, res);
      expect(res._status).toBe(200);
      const json = res._buf
        ? (serializer.parse((res._buf as Buffer).toString("utf8")) as any)
        : undefined;
      expect(json?.result).toBe("ok");
      expect(parse).not.toHaveBeenCalled();
      expect(provide).not.toHaveBeenCalled();
    });

    it("uses rpc-lane allowAsyncContext=false policy for task ids", async () => {
      let current: any;
      const parse = jest.fn((s: string) => JSON.parse(s));
      const provide = jest.fn((v: any, fn: any) => {
        current = v;
        return fn();
      });
      const ctx = {
        id: "ctx-rpc-policy-task",
        use: () => current,
        serialize: (v: any) => JSON.stringify(v),
        parse,
        provide,
        require: () => ({}) as any,
      } as any;

      const deps = createRequestHandlersDeps(serializer, {
        store: {
          tasks: new Map([["t-ctx-policy", { task: { id: "t-ctx-policy" } }]]),
          events: new Map(),
          errors: new Map(),
          asyncContexts: new Map([[ctx.id, ctx]]),
        },
        taskRunner: {
          run: async () => {
            expect(ctx.use()).toBeUndefined();
            return "ok";
          },
        },
        eventManager: {} as any,
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        authenticator: async () => ({ ok: true }),
        allowList: { ensureTask: () => null, ensureEvent: () => null },
        router: {
          basePath: "/api",
          extract: () => ({ kind: "task", id: "t-ctx-policy" }),
          isUnderBase: () => true,
        },
        cors: undefined,
        policy: {
          enabled: true,
          taskIds: ["t-ctx-policy"],
          eventIds: [],
          taskAllowAsyncContext: {
            "t-ctx-policy": false,
          },
          eventAllowAsyncContext: {},
          taskAsyncContextAllowList: {},
          eventAsyncContextAllowList: {},
        },
      });

      const { handleTask } = createRequestHandlers(deps);
      const headers = {
        [HeaderName.ContentType]: MimeType.ApplicationJson,
        [HeaderName.XRunnerContext]: serializer.stringify({
          [ctx.id]: ctx.serialize({ v: 123 }),
        }),
      } satisfies NodeLikeHeaders;
      const { req, res } = createReqRes({
        method: HttpMethod.Post,
        url: "/api/task/t-ctx-policy",
        headers,
        body: JSON.stringify({ input: { a: 1 } }),
      });

      await handleTask(req, res);
      expect(res._status).toBe(200);
      expect(parse).not.toHaveBeenCalled();
      expect(provide).not.toHaveBeenCalled();
    });

    it("hydrates only rpc-lane allowlisted async contexts for task ids", async () => {
      let allowedCurrent: any;
      let blockedCurrent: any;
      const allowedParse = jest.fn((s: string) => JSON.parse(s));
      const allowedProvide = jest.fn((v: any, fn: any) => {
        allowedCurrent = v;
        return fn();
      });
      const blockedParse = jest.fn((s: string) => JSON.parse(s));
      const blockedProvide = jest.fn((v: any, fn: any) => {
        blockedCurrent = v;
        return fn();
      });
      const allowedCtx = {
        id: "ctx-rpc-allowed-task",
        use: () => allowedCurrent,
        serialize: (v: any) => JSON.stringify(v),
        parse: allowedParse,
        provide: allowedProvide,
        require: () => ({}) as any,
      } as any;
      const blockedCtx = {
        id: "ctx-rpc-blocked-task",
        use: () => blockedCurrent,
        serialize: (v: any) => JSON.stringify(v),
        parse: blockedParse,
        provide: blockedProvide,
        require: () => ({}) as any,
      } as any;

      const deps = createRequestHandlersDeps(serializer, {
        store: {
          tasks: new Map([["t-ctx-rpc", { task: { id: "t-ctx-rpc" } }]]),
          events: new Map(),
          errors: new Map(),
          asyncContexts: new Map([
            [allowedCtx.id, allowedCtx],
            [blockedCtx.id, blockedCtx],
          ]),
        },
        taskRunner: {
          run: async () => {
            expect(allowedCtx.use()).toEqual({ ok: "yes" });
            expect(blockedCtx.use()).toBeUndefined();
            return "ok";
          },
        },
        eventManager: {} as any,
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        authenticator: async () => ({ ok: true }),
        allowList: { ensureTask: () => null, ensureEvent: () => null },
        router: {
          basePath: "/api",
          extract: () => ({ kind: "task", id: "t-ctx-rpc" }),
          isUnderBase: () => true,
        },
        cors: undefined,
        policy: {
          enabled: true,
          taskIds: ["t-ctx-rpc"],
          eventIds: [],
          taskAllowAsyncContext: { "t-ctx-rpc": true },
          eventAllowAsyncContext: {},
          taskAsyncContextAllowList: {
            "t-ctx-rpc": [allowedCtx.id],
          },
          eventAsyncContextAllowList: {},
        },
      });

      const { handleTask } = createRequestHandlers(deps);
      const headers = {
        [HeaderName.ContentType]: MimeType.ApplicationJson,
        [HeaderName.XRunnerContext]: serializer.stringify({
          [allowedCtx.id]: allowedCtx.serialize({ ok: "yes" }),
          [blockedCtx.id]: blockedCtx.serialize({ no: "no" }),
        }),
      } satisfies NodeLikeHeaders;
      const { req, res } = createReqRes({
        method: HttpMethod.Post,
        url: "/api/task/t-ctx-rpc",
        headers,
        body: JSON.stringify({ input: { a: 1 } }),
      });

      await handleTask(req, res);
      expect(res._status).toBe(200);
      expect(allowedParse).toHaveBeenCalledTimes(1);
      expect(allowedProvide).toHaveBeenCalledTimes(1);
      expect(blockedParse).not.toHaveBeenCalled();
      expect(blockedProvide).not.toHaveBeenCalled();
    });
  });

  describe("Cancellations", () => {
    it("responds 499 when readJsonBody rejects with CancellationError (task)", async () => {
      const cancellation = (() => {
        try {
          cancellationError.throw({ reason: "Client Closed Request" });
        } catch (error) {
          return error;
        }
      })();
      jest.spyOn(requestBody, "readJsonBody").mockRejectedValue(cancellation);

      const deps = createRequestHandlersDeps(serializer, {
        store: { tasks: new Map([["t-id", { task: { id: "t-id" } }]]) },
        taskRunner: { run: async () => {} },
        eventManager: { emit: async () => {} },
        router: {
          extract: (_p: string) => ({ kind: "task", id: "t-id" }),
        },
        cors: undefined,
      });

      const { handleTask } = createRequestHandlers(deps);
      const { req, res } = createReqRes({
        method: HttpMethod.Post,
        url: "/api/task/t-id",
        headers: { [HeaderName.ContentType]: MimeType.ApplicationJson },
        body: null,
        autoEnd: true,
        autoCloseOnOnce: true,
      });
      await handleTask(req, res);
      expect(res._status).toBe(499);
      const json = res._buf
        ? JSON.parse((res._buf as Buffer).toString("utf8"))
        : undefined;
      expect(json?.error?.code).toBe("REQUEST_ABORTED");
    });
  });
});
