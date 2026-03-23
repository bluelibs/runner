import * as multipart from "../../../exposure/multipart";
import { createRequestHandlers } from "../../../exposure/requestHandlers";
import { Serializer } from "../../../../serializer";
import { createRequestHandlersDeps } from "./requestHandlers.deps.test.utils";
import {
  createReqRes,
  HeaderName,
  HttpMethod,
  MimeType,
} from "./requestHandlers.test.utils";

describe("taskHandler authorizeTaskBody branches", () => {
  const serializer = new Serializer();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns authorizeTaskBody response for multipart requests", async () => {
    const runSpy = jest.fn(async () => "ok");
    jest
      .spyOn(
        multipart as {
          parseMultipartInput: typeof multipart.parseMultipartInput;
        },
        "parseMultipartInput",
      )
      .mockResolvedValue({
        ok: true,
        value: { field: "value" },
        finalize: Promise.resolve({ ok: true }),
      } as any);
    const deps = createRequestHandlersDeps(serializer, {
      store: {
        tasks: new Map([
          ["t-multipart-auth", { task: { id: "t-multipart-auth" } }],
        ]),
      },
      taskRunner: { run: runSpy },
      router: {
        extract: () => ({ kind: "task", id: "t-multipart-auth" }),
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
      url: "/api/task/t-multipart-auth",
      headers: {
        [HeaderName.ContentType]: "multipart/form-data; boundary=tests",
      },
      body: "--tests--",
    });

    await handleTask(req, res);

    expect(runSpy).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
  });

  it("returns authorizeTaskBody response for octet-stream requests", async () => {
    const runSpy = jest.fn(async () => "ok");
    const deps = createRequestHandlersDeps(serializer, {
      store: {
        tasks: new Map([["t-octet-auth", { task: { id: "t-octet-auth" } }]]),
      },
      taskRunner: { run: runSpy },
      router: {
        extract: () => ({ kind: "task", id: "t-octet-auth" }),
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
      url: "/api/task/t-octet-auth",
      headers: {
        [HeaderName.ContentType]: MimeType.ApplicationOctetStream,
      },
      body: "raw",
    });

    await handleTask(req, res);

    expect(runSpy).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
  });

  it("falls back to generic 500 handling when no error helpers are registered", async () => {
    const deps = createRequestHandlersDeps(serializer, {
      store: {
        tasks: new Map([
          ["t-generic-error", { task: { id: "t-generic-error" } }],
        ]),
        errors: undefined,
        hasId(id: string) {
          return (
            this.tasks.has(id) ||
            this.events.has(id) ||
            this.asyncContexts.has(id)
          );
        },
      },
      taskRunner: {
        run: async () => {
          throw new Error("plain failure");
        },
      },
      router: {
        extract: () => ({ kind: "task", id: "t-generic-error" }),
      },
    });

    const { handleTask } = createRequestHandlers(deps);
    const { req, res } = createReqRes({
      method: HttpMethod.Post,
      url: "/api/task/t-generic-error",
      headers: { [HeaderName.ContentType]: MimeType.ApplicationJson },
      body: JSON.stringify({ input: { a: 1 } }),
    });

    await handleTask(req, res);

    expect(res._status).toBe(500);
  });
});
