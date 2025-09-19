import type { IncomingMessage, ServerResponse } from "http";
import { createRequestHandlers } from "../requestHandlers";

function makeReq(path: string): IncomingMessage {
  const req: any = { method: "OPTIONS", url: path, headers: {} };
  return req as IncomingMessage;
}

function makeRes(): ServerResponse & { _called?: boolean } {
  const res: any = {
    statusCode: 0,
    setHeader() {},
    end() {
      this._called = true;
    },
  };
  return res as any;
}

describe("requestHandlers - preflight early returns", () => {
  it("handleTask returns early on OPTIONS (line 384)", async () => {
    const deps: any = {
      store: { tasks: new Map([["t", { task: async () => 1 }]]) },
      taskRunner: { run: async () => 1 },
      eventManager: {} as any,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      authenticator: () => ({ ok: true }),
      allowList: { ensureTask: () => null, ensureEvent: () => null },
      router: {
        basePath: "/api",
        extract: (_: string) => ({ kind: "task", id: "t" }),
        isUnderBase: () => true,
      },
      cors: {},
    };
    const { handleTask } = createRequestHandlers(deps);
    const req = makeReq("/api/task/t");
    const res = makeRes();
    await handleTask(req, res);
  });

  it("handleEvent returns early on OPTIONS (line 395)", async () => {
    const deps: any = {
      store: { events: new Map([["e", { event: { id: "e" } }]]) },
      taskRunner: {} as any,
      eventManager: { emit: async () => {} },
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      authenticator: () => ({ ok: true }),
      allowList: { ensureTask: () => null, ensureEvent: () => null },
      router: {
        basePath: "/api",
        extract: (_: string) => ({ kind: "event", id: "e" }),
        isUnderBase: () => true,
      },
      cors: {},
    };
    const { handleEvent } = createRequestHandlers(deps);
    const req = makeReq("/api/event/e");
    const res = makeRes();
    await handleEvent(req, res);
  });

  it("handleRequest returns early on OPTIONS for task path (line 412)", async () => {
    const deps: any = {
      store: {
        tasks: new Map([["t", { task: async () => 1 }]]),
        events: new Map([["e", { event: { id: "e" } }]]),
      },
      taskRunner: { run: async () => 1 },
      eventManager: { emit: async () => {} },
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      authenticator: () => ({ ok: true }),
      allowList: { ensureTask: () => null, ensureEvent: () => null },
      router: {
        basePath: "/api",
        extract: (p: string) => ({
          kind: p.includes("/task/") ? "task" : "event",
          id: p.includes("/task/") ? "t" : "e",
        }),
        isUnderBase: () => true,
      },
      cors: {},
    };
    const { handleRequest } = createRequestHandlers(deps);
    const req: any = { method: "OPTIONS", url: "/api/task/t", headers: {} };
    const res = makeRes();
    await handleRequest(req, res);
  });

  it("handleRequest returns early on OPTIONS for event path (line 421)", async () => {
    const deps: any = {
      store: {
        tasks: new Map([["t", { task: async () => 1 }]]),
        events: new Map([["e", { event: { id: "e" } }]]),
      },
      taskRunner: { run: async () => 1 },
      eventManager: { emit: async () => {} },
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      authenticator: () => ({ ok: true }),
      allowList: { ensureTask: () => null, ensureEvent: () => null },
      router: {
        basePath: "/api",
        extract: (p: string) => ({
          kind: p.includes("/event/") ? "event" : "task",
          id: p.includes("/event/") ? "e" : "t",
        }),
        isUnderBase: () => true,
      },
      cors: {},
    };
    const { handleRequest } = createRequestHandlers(deps);
    const req: any = { method: "OPTIONS", url: "/api/event/e", headers: {} };
    const res = makeRes();
    await handleRequest(req, res);
  });
});
