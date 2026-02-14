import type { IncomingMessage } from "http";

import {
  createRequestHandlers,
  type RequestProcessingDeps,
} from "../../../exposure/requestHandlers";
import type { JsonResponse } from "../../../exposure/types";
import { Serializer } from "../../../../serializer";
import {
  createReqRes,
  HeaderName,
  HttpMethod,
  MimeType,
} from "./requestHandlers.test.utils";

describe("requestHandlers - audit and request id", () => {
  const serializer = new Serializer();

  const getBaseDeps = (): RequestProcessingDeps =>
    ({
      store: {
        tasks: new Map([["t.id", { task: { id: "t.id" } }]]),
        events: new Map(),
        asyncContexts: new Map(),
        errors: new Map(),
      } as unknown as RequestProcessingDeps["store"],
      taskRunner: {
        run: async () => "ok",
      } as unknown as RequestProcessingDeps["taskRunner"],
      eventManager: {
        emit: async () => undefined,
      } as unknown as RequestProcessingDeps["eventManager"],
      logger: {
        info: () => {},
        warn: jest.fn(),
        error: () => {},
      } as unknown as RequestProcessingDeps["logger"],
      authenticator: async () => ({ ok: true as const }),
      allowList: {
        ensureTask: () => null,
        ensureEvent: () => null,
      },
      router: {
        basePath: "/api",
        extract: () => ({ kind: "task", id: "t.id" }),
        isUnderBase: () => true,
      },
      cors: undefined,
      serializer,
    }) satisfies RequestProcessingDeps;

  it("assigns and echoes x-runner-request-id when missing", async () => {
    const deps = getBaseDeps();
    const { handleTask } = createRequestHandlers(deps);
    const transport = createReqRes({
      method: HttpMethod.Post,
      url: "/api/task/t.id",
      headers: { [HeaderName.ContentType]: MimeType.ApplicationJson },
      body: "{}",
    });

    await handleTask(transport.req, transport.res);

    const requestId = transport.res.headers["x-runner-request-id"];
    expect(requestId).toBeDefined();
    expect(String(requestId).length).toBeGreaterThan(0);
  });

  it("keeps a valid incoming x-runner-request-id", async () => {
    const deps = getBaseDeps();
    const { handleTask } = createRequestHandlers(deps);
    const transport = createReqRes({
      method: HttpMethod.Post,
      url: "/api/task/t.id",
      headers: {
        [HeaderName.ContentType]: MimeType.ApplicationJson,
        "x-runner-request-id": "req-12345",
      },
      body: "{}",
    });

    await handleTask(transport.req, transport.res);

    expect(transport.res.headers["x-runner-request-id"]).toBe("req-12345");
  });

  it("replaces invalid incoming x-runner-request-id", async () => {
    const deps = getBaseDeps();
    const { handleTask } = createRequestHandlers(deps);
    const transport = createReqRes({
      method: HttpMethod.Post,
      url: "/api/task/t.id",
      headers: {
        [HeaderName.ContentType]: MimeType.ApplicationJson,
        "x-runner-request-id": "bad id!",
      },
      body: "{}",
    });

    await handleTask(transport.req, transport.res);

    const requestId = transport.res.headers["x-runner-request-id"];
    expect(requestId).toBeDefined();
    expect(requestId).not.toBe("bad id!");
  });

  it("logs authentication failures with audit metadata", async () => {
    const deps = getBaseDeps();
    deps.authenticator = async () => ({
      ok: false as const,
      response: {
        status: 401,
        body: { ok: false, error: { code: "UNAUTHORIZED" } },
      },
    });
    const warn = deps.logger.warn as unknown as jest.Mock;

    const { handleTask } = createRequestHandlers(deps);
    const transport = createReqRes({
      method: HttpMethod.Post,
      url: "/api/task/t.id",
      headers: { [HeaderName.ContentType]: MimeType.ApplicationJson },
      body: "{}",
    });

    await handleTask(transport.req, transport.res);

    expect(transport.res._status).toBe(401);
    expect(warn).toHaveBeenCalledWith(
      "exposure.auth.failure",
      expect.objectContaining({
        requestId: expect.any(String),
        status: 401,
        code: "UNAUTHORIZED",
      }),
    );
  });

  it("logs auth failures when error payload is not an object", async () => {
    const deps = getBaseDeps();
    deps.authenticator = async () => ({
      ok: false as const,
      response: {
        status: 401,
        body: "bad-payload" as unknown as JsonResponse["body"],
      },
    });
    const warn = deps.logger.warn as unknown as jest.Mock;

    const { handleTask } = createRequestHandlers(deps);
    const transport = createReqRes({
      method: HttpMethod.Post,
      url: "/api/task/t.id",
      headers: { [HeaderName.ContentType]: MimeType.ApplicationJson },
      body: "{}",
    });

    await handleTask(transport.req, transport.res);

    expect(transport.res._status).toBe(401);
    expect(warn).toHaveBeenCalledWith(
      "exposure.auth.failure",
      expect.objectContaining({
        status: 401,
        code: undefined,
      }),
    );
  });

  it("logs auth failures when error field is not an object", async () => {
    const deps = getBaseDeps();
    deps.authenticator = async () => ({
      ok: false as const,
      response: {
        status: 401,
        body: {
          ok: false,
          error: "x",
        } as unknown as JsonResponse["body"],
      },
    });
    const warn = deps.logger.warn as unknown as jest.Mock;

    const { handleTask } = createRequestHandlers(deps);
    const transport = createReqRes({
      method: HttpMethod.Post,
      url: "/api/task/t.id",
      headers: { [HeaderName.ContentType]: MimeType.ApplicationJson },
      body: "{}",
    });

    await handleTask(transport.req, transport.res);

    expect(transport.res._status).toBe(401);
    expect(warn).toHaveBeenCalledWith(
      "exposure.auth.failure",
      expect.objectContaining({
        status: 401,
        code: undefined,
      }),
    );
  });

  it("logs auth failures when error code is non-string", async () => {
    const deps = getBaseDeps();
    deps.authenticator = async () => ({
      ok: false as const,
      response: {
        status: 401,
        body: {
          ok: false,
          error: { code: 123 },
        } as unknown as JsonResponse["body"],
      },
    });
    const warn = deps.logger.warn as unknown as jest.Mock;

    const { handleTask } = createRequestHandlers(deps);
    const transport = createReqRes({
      method: HttpMethod.Post,
      url: "/api/task/t.id",
      headers: { [HeaderName.ContentType]: MimeType.ApplicationJson },
      body: "{}",
    });

    await handleTask(transport.req, transport.res);

    expect(transport.res._status).toBe(401);
    expect(warn).toHaveBeenCalledWith(
      "exposure.auth.failure",
      expect.objectContaining({
        status: 401,
        code: undefined,
      }),
    );
  });

  it("uses GET as fallback method in auth audit logs when req.method is missing", async () => {
    const deps = getBaseDeps();
    deps.authenticator = async (req: IncomingMessage) => {
      req.method = undefined;
      return {
        ok: false as const,
        response: {
          status: 401,
          body: { ok: false, error: { code: "UNAUTHORIZED" } },
        },
      };
    };
    const warn = deps.logger.warn as unknown as jest.Mock;

    const { handleTask } = createRequestHandlers(deps);
    const transport = createReqRes({
      method: HttpMethod.Post,
      url: "/api/task/t.id",
      headers: { [HeaderName.ContentType]: MimeType.ApplicationJson },
      body: "{}",
    });
    await handleTask(transport.req, transport.res);

    expect(warn).toHaveBeenCalledWith(
      "exposure.auth.failure",
      expect.objectContaining({
        method: "GET",
        code: "UNAUTHORIZED",
      }),
    );
  });
});
