import { createRequestHandlers } from "../../../exposure/requestHandlers";
import { createReqRes, HttpMethod } from "./requestHandlers.test.utils";

describe("requestHandlers - preflight handling", () => {
  const getDeps = () => ({
    store: {
      tasks: new Map([["t", { task: async () => 1 }]]),
      events: new Map([["e", { event: { id: "e" } }]]),
    },
    taskRunner: { run: async () => 1 },
    eventManager: { emit: async () => {} },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    authenticator: async () => ({ ok: true }),
    allowList: { ensureTask: () => null, ensureEvent: () => null },
    router: {
      basePath: "/api",
      extract: (p: string) => {
        if (p.includes("/task/")) return { kind: "task", id: "t" };
        if (p.includes("/event/")) return { kind: "event", id: "e" };
        return null;
      },
      isUnderBase: () => true,
    },
    cors: {},
  });

  describe("Early returns and handling", () => {
    it("handleTask returns early on OPTIONS", async () => {
      const { handleTask } = createRequestHandlers(getDeps() as any);
      const { req, res } = createReqRes({
        method: HttpMethod.Options,
        url: "/api/task/t",
        headers: {},
      });
      await handleTask(req, res);
      expect(res.statusCode).toBe(204);
    });

    it("handleEvent returns early on OPTIONS", async () => {
      const { handleEvent } = createRequestHandlers(getDeps() as any);
      const { req, res } = createReqRes({
        method: HttpMethod.Options,
        url: "/api/event/e",
        headers: {},
      });
      await handleEvent(req, res);
      expect(res.statusCode).toBe(204);
    });

    it("handleRequest returns early on OPTIONS for task path", async () => {
      const { handleRequest } = createRequestHandlers(getDeps() as any);
      const { req, res } = createReqRes({
        method: HttpMethod.Options,
        url: "/api/task/t",
        headers: {},
      });
      const handled = await handleRequest(req, res);
      expect(handled).toBe(true);
      expect(res.statusCode).toBe(204);
    });

    it("handleRequest returns early on OPTIONS for event path", async () => {
      const { handleRequest } = createRequestHandlers(getDeps() as any);
      const { req, res } = createReqRes({
        method: HttpMethod.Options,
        url: "/api/event/e",
        headers: {},
      });
      const handled = await handleRequest(req, res);
      expect(handled).toBe(true);
      expect(res.statusCode).toBe(204);
    });

    it("handleRequest returns true after preflight end with no target under base", async () => {
      const deps = getDeps();
      deps.router.extract = () => null;
      const { handleRequest } = createRequestHandlers(deps as any);
      const { req, res } = createReqRes({
        method: HttpMethod.Options,
        url: "/api/anything",
        headers: {},
        body: null,
        autoEnd: true,
      });
      const handled = await handleRequest(req, res);
      expect(handled).toBe(true);
      expect(res.writableEnded).toBe(true);
      expect(res.statusCode).toBe(204);
    });
  });
});
