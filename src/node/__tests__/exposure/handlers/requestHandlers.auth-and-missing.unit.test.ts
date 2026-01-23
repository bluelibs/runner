import { Readable } from "stream";
import type { IncomingMessage, ServerResponse } from "http";
import { Socket } from "net";
import { createRequestHandlers } from "../../../exposure/requestHandlers";
import { createAllowListGuard } from "../../../exposure/allowList";
import { globalTags } from "../../../../globals/globalTags";
import { getDefaultSerializer } from "../../../../serializer";
import type { ExposureRouter } from "../../../exposure/router";
import type { NodeExposureDeps } from "../../../exposure/resourceTypes";

type MockReq = Readable & IncomingMessage;
type MockRes = ServerResponse & { _status?: number; _buf?: Buffer };

function makeRes(): MockRes {
  const res = {
    statusCode: 0,
    setHeader(_name: string, _value: number | string | ReadonlyArray<string>) {
      return res as unknown as ServerResponse;
    },
    end(buf?: unknown) {
      this._status = this.statusCode;
      if (buf)
        this._buf = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf));
      return res as unknown as ServerResponse;
    },
  } as unknown as MockRes;
  return res;
}

function makeRouter(target: ExposureRouter["extract"]): ExposureRouter {
  return {
    basePath: "/api",
    extract: target,
    isUnderBase: () => true,
  };
}

function makeJsonReq(url: string): MockReq {
  const req = new Readable({
    read() {
      this.push(null);
    },
  }) as MockReq;
  Object.assign(req, {
    aborted: false,
    httpVersion: "1.1",
    httpVersionMajor: 1,
    httpVersionMinor: 1,
    complete: true,
    rawHeaders: [] as string[],
    trailers: {} as Record<string, string>,
    rawTrailers: [] as string[],
    setTimeout(_msecs: number, _callback?: () => void) {
      return req;
    },
    socket: new Socket(),
  });
  req.method = "POST";
  req.url = url;
  req.headers = { "content-type": "application/json" };
  return req;
}

describe("requestHandlers - auth fail and missing task", () => {
  it("returns auth error when authenticator fails", async () => {
    const store = {
      tasks: new Map(),
      events: new Map(),
      asyncContexts: new Map(),
      resources: new Map(),
    } as unknown as NodeExposureDeps["store"];
    const taskRunner = {
      async run() {
        return 1;
      },
    } as unknown as NodeExposureDeps["taskRunner"];
    const eventManager = {
      emit: async () => {},
    } as unknown as NodeExposureDeps["eventManager"];
    const logger = {
      info: async () => {},
      warn: async () => {},
      error: async () => {},
    } as unknown as NodeExposureDeps["logger"];

    const deps = {
      store,
      taskRunner,
      eventManager,
      logger,
      authenticator: async () => ({
        ok: false as const,
        response: {
          status: 401,
          body: { ok: false, error: { code: "UNAUTHORIZED" } },
        },
      }),
      allowList: { ensureTask: () => null, ensureEvent: () => null },
      router: makeRouter((_p: string) => ({ kind: "task", id: "t.id" })),
      cors: undefined,
      serializer: getDefaultSerializer(),
    } satisfies Parameters<typeof createRequestHandlers>[0];
    const { handleTask } = createRequestHandlers(deps);
    const req = makeJsonReq("/api/task/t.id");
    const res = makeRes();
    await handleTask(req, res);
    expect(res._status).toBe(401);
    const json = res._buf
      ? (deps.serializer.parse((res._buf as Buffer).toString("utf8")) as any)
      : undefined;
    expect(json?.error?.code).toBe("UNAUTHORIZED");
  });

  it("returns 404 when task id missing from store", async () => {
    const store = {
      tasks: new Map(),
      events: new Map(),
      asyncContexts: new Map(),
      resources: new Map(),
    } as unknown as NodeExposureDeps["store"];
    const taskRunner = {
      async run() {
        return 1;
      },
    } as unknown as NodeExposureDeps["taskRunner"];
    const eventManager = {
      emit: async () => {},
    } as unknown as NodeExposureDeps["eventManager"];
    const logger = {
      info: async () => {},
      warn: async () => {},
      error: async () => {},
    } as unknown as NodeExposureDeps["logger"];

    const deps = {
      store,
      taskRunner,
      eventManager,
      logger,
      authenticator: async () => ({ ok: true }),
      allowList: { ensureTask: () => null, ensureEvent: () => null },
      router: makeRouter((_p: string) => ({ kind: "task", id: "missing" })),
      cors: undefined,
      serializer: getDefaultSerializer(),
    } satisfies Parameters<typeof createRequestHandlers>[0];
    const { handleTask } = createRequestHandlers(deps);
    const req = makeJsonReq("/api/task/missing");
    const res = makeRes();
    await handleTask(req, res);
    expect(res._status).toBe(404);
    const json = res._buf
      ? (deps.serializer.parse((res._buf as Buffer).toString("utf8")) as any)
      : undefined;
    expect(json?.error?.code).toBe("NOT_FOUND");
  });

  it("returns 403 when exposure is disabled", async () => {
    const store = {
      tasks: new Map([["t", { task: { id: "t" } }]]),
      events: new Map(),
      asyncContexts: new Map(),
      resources: new Map(),
    } as unknown as NodeExposureDeps["store"];
    const taskRunner = {
      async run() {
        return 1;
      },
    } as unknown as NodeExposureDeps["taskRunner"];
    const eventManager = {
      emit: async () => {},
    } as unknown as NodeExposureDeps["eventManager"];
    const logger = {
      info: async () => {},
      warn: async () => {},
      error: async () => {},
    } as unknown as NodeExposureDeps["logger"];

    const deps = {
      store,
      taskRunner,
      eventManager,
      logger,
      authenticator: async () => ({ ok: true }),
      allowList: createAllowListGuard(store),
      router: makeRouter((_p: string) => ({ kind: "task", id: "t" })),
      cors: undefined,
      serializer: getDefaultSerializer(),
    } satisfies Parameters<typeof createRequestHandlers>[0];
    const { handleTask } = createRequestHandlers(deps);
    const req = makeJsonReq("/api/task/t");
    const res = makeRes();
    await handleTask(req, res);
    expect(res._status).toBe(403);
    const json = res._buf
      ? (deps.serializer.parse((res._buf as Buffer).toString("utf8")) as any)
      : undefined;
    expect(json?.error?.code).toBe("FORBIDDEN");
  });

  it("returns 403 when task/event blocked by allow-list", async () => {
    const store = {
      tasks: new Map([["allowed.task", { task: { id: "allowed.task" } }]]),
      events: new Map([["allowed.event", { event: { id: "allowed.event" } }]]),
      resources: new Map([
        [
          "srv",
          {
            resource: { id: "srv", tags: [globalTags.tunnel] },
            value: {
              mode: "server",
              transport: "http",
              tasks: ["allowed.task"],
              events: ["allowed.event"],
            },
          },
        ],
      ]),
      asyncContexts: new Map(),
    } as unknown as NodeExposureDeps["store"];

    const taskRunner = {
      async run() {
        return 1;
      },
    } as unknown as NodeExposureDeps["taskRunner"];
    const eventManager = {
      emit: async () => {},
    } as unknown as NodeExposureDeps["eventManager"];
    const logger = {
      info: async () => {},
      warn: async () => {},
      error: async () => {},
    } as unknown as NodeExposureDeps["logger"];

    const router = makeRouter((_p: string) => ({
      kind: "task",
      id: "blocked.task",
    }));

    const deps = {
      store,
      taskRunner,
      eventManager,
      logger,
      authenticator: async () => ({ ok: true }),
      allowList: createAllowListGuard(store),
      router,
      cors: undefined,
      serializer: getDefaultSerializer(),
    } satisfies Parameters<typeof createRequestHandlers>[0];

    const { handleTask, handleEvent } = createRequestHandlers(deps);

    // Task request blocked by allow-list
    const taskReq = makeJsonReq("/api/task/blocked.task");
    const taskRes = makeRes();
    await handleTask(taskReq, taskRes);
    expect(taskRes._status).toBe(403);
    const taskJson = taskRes._buf
      ? (deps.serializer.parse(
          (taskRes._buf as Buffer).toString("utf8"),
        ) as any)
      : undefined;
    expect(taskJson?.error?.code).toBe("FORBIDDEN");

    // Event request blocked by allow-list
    const eventReq = makeJsonReq("/api/event/blocked.event");
    const eventRes = makeRes();
    // update router to event for this call
    deps.router.extract = (_p: string) => ({
      kind: "event",
      id: "blocked.event",
    });
    await handleEvent(eventReq, eventRes);
    expect(eventRes._status).toBe(403);
    const eventJson = eventRes._buf
      ? (deps.serializer.parse(
          (eventRes._buf as Buffer).toString("utf8"),
        ) as any)
      : undefined;
    expect(eventJson?.error?.code).toBe("FORBIDDEN");
  });
});
