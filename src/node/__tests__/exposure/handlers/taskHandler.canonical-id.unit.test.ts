import { createMessageError } from "../../../../errors";
import { Serializer } from "../../../../serializer";
import { createTaskHandler } from "../../../exposure/handlers/taskHandler";
import * as errorHandlers from "../../../exposure/handlers/errorHandlers";
import * as requestBodyModule from "../../../exposure/requestBody";
import {
  createReqRes,
  HeaderName,
  HttpMethod,
  MimeType,
} from "./requestHandlers.test.utils";

describe("taskHandler canonical id boundaries", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("canonicalizes request task ids and exposure source ids through the store contract", async () => {
    const serializer = new Serializer();
    const run = jest.fn(async () => "ok");
    const ensureTask = jest.fn(() => null);
    const authorizeTask = jest.fn(() => null);
    jest.spyOn(requestBodyModule, "readJsonBody").mockResolvedValue({
      ok: true,
      value: { input: { ok: true } },
    });

    const handler = createTaskHandler({
      store: {
        tasks: new Map([
          ["app.tasks.echo", { task: { id: "app.tasks.echo" } }],
        ]),
        errors: new Map(),
        hasDefinition(reference: unknown) {
          return reference === "echo" || reference === "exposure";
        },
        findIdByDefinition(reference: unknown) {
          if (reference === "echo") {
            return "app.tasks.echo";
          }
          if (reference === "exposure") {
            return "app.resources.exposure";
          }
          return String(reference);
        },
      } as any,
      taskRunner: { run } as any,
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any,
      authenticator: async () => ({ ok: true }),
      allowList: { ensureTask } as any,
      authorizeTask,
      router: { basePath: "/api" },
      serializer,
      sourceResourceId: "exposure",
    });

    const { req, res } = createReqRes({
      method: HttpMethod.Post,
      url: "/api/task/echo",
      headers: { [HeaderName.ContentType]: MimeType.ApplicationJson },
      body: JSON.stringify({ input: { ok: true } }),
    });

    await handler(req, res, "echo");

    expect(res._status).toBe(200);
    expect(ensureTask).toHaveBeenCalledWith("app.tasks.echo");
    expect(authorizeTask).toHaveBeenCalledWith(req, "app.tasks.echo");
    expect(run).toHaveBeenCalledWith(
      { id: "app.tasks.echo" },
      { ok: true },
      expect.objectContaining({
        source: {
          kind: "resource",
          id: "app.resources.exposure",
        },
        signal: expect.any(Object),
      }),
    );
  });

  it("treats throwing app-error helpers as best-effort during request failure handling", async () => {
    const serializer = new Serializer();
    const handleRequestErrorSpy = jest.spyOn(
      errorHandlers,
      "handleRequestError",
    );
    jest.spyOn(requestBodyModule, "readJsonBody").mockResolvedValue({
      ok: true,
      value: { input: 1 },
    });

    const handler = createTaskHandler({
      store: {
        tasks: new Map([["task", { task: { id: "task" } }]]),
        errors: new Map([
          [
            "broken-helper",
            {
              is: () => {
                throw new Error("broken helper");
              },
            },
          ],
        ]),
      } as any,
      taskRunner: {
        run: async () => {
          throw createMessageError("boom");
        },
      } as any,
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any,
      authenticator: async () => ({ ok: true }),
      allowList: { ensureTask: () => null } as any,
      router: { basePath: "/api" },
      serializer,
    });

    const { req, res } = createReqRes({
      method: HttpMethod.Post,
      url: "/api/task/task",
      headers: { [HeaderName.ContentType]: MimeType.ApplicationJson },
      body: JSON.stringify({ input: 1 }),
    });

    await expect(handler(req, res, "task")).resolves.toBeUndefined();
    expect(handleRequestErrorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        appErrorId: undefined,
      }),
    );
  });

  it("falls back to raw ids when canonical resolution returns null", async () => {
    const serializer = new Serializer();
    const run = jest.fn(async () => "ok");
    const ensureTask = jest.fn(() => null);
    jest.spyOn(requestBodyModule, "readJsonBody").mockResolvedValue({
      ok: true,
      value: { input: { ok: true } },
    });

    const handler = createTaskHandler({
      store: {
        tasks: new Map([["", { task: { id: "" } }]]),
        errors: new Map(),
      } as any,
      taskRunner: { run } as any,
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any,
      authenticator: async () => ({ ok: true }),
      allowList: { ensureTask } as any,
      router: { basePath: "/api" },
      serializer,
      sourceResourceId: "",
    });

    const { req, res } = createReqRes({
      method: HttpMethod.Post,
      url: "/api/task/",
      headers: { [HeaderName.ContentType]: MimeType.ApplicationJson },
      body: JSON.stringify({ input: { ok: true } }),
    });

    await handler(req, res, "");

    expect(res._status).toBe(200);
    expect(ensureTask).toHaveBeenCalledWith("");
    expect(run).toHaveBeenCalledWith(
      { id: "" },
      { ok: true },
      expect.objectContaining({
        source: {
          kind: "resource",
          id: "",
        },
        signal: expect.any(Object),
      }),
    );
  });
});
