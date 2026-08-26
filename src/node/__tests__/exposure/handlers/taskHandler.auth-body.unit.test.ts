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

  it("hashes the exact received JSON bytes, not the re-serialized payload", async () => {
    const runSpy = jest.fn(async () => "ok");
    let capturedBodyText: string | undefined;
    const deps = createRequestHandlersDeps(serializer, {
      store: {
        tasks: new Map([["t-raw-bytes", { task: { id: "t-raw-bytes" } }]]),
      },
      taskRunner: { run: runSpy },
      router: { extract: () => ({ kind: "task", id: "t-raw-bytes" }) },
      authorizeTaskBody: async (
        _req: unknown,
        _taskId: string,
        bodyText?: string,
      ) => {
        capturedBodyText = bodyText;
        return null;
      },
    });

    const { handleTask } = createRequestHandlers(deps);
    // Exceeds Number.MAX_SAFE_INTEGER: parsing then re-stringifying would
    // corrupt it, so the auth hash must cover the original bytes.
    const rawBody = '{"input":12345678901234567890}';
    const { req, res } = createReqRes({
      method: HttpMethod.Post,
      url: "/api/task/t-raw-bytes",
      headers: { [HeaderName.ContentType]: MimeType.ApplicationJson },
      body: rawBody,
    });

    await handleTask(req, res);

    expect(capturedBodyText).toBe(rawBody);
    expect(runSpy).toHaveBeenCalledTimes(1);
  });

  it("passes empty bodyText to authorizeTaskBody for multipart requests", async () => {
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
    let capturedBodyText: string | undefined = "unset";
    const deps = createRequestHandlersDeps(serializer, {
      store: {
        tasks: new Map([["t-mp-empty", { task: { id: "t-mp-empty" } }]]),
      },
      taskRunner: { run: async () => "ok" },
      router: { extract: () => ({ kind: "task", id: "t-mp-empty" }) },
      authorizeTaskBody: async (
        _req: unknown,
        _taskId: string,
        bodyText?: string,
      ) => {
        capturedBodyText = bodyText;
        return null;
      },
    });

    const { handleTask } = createRequestHandlers(deps);
    const { req, res } = createReqRes({
      method: HttpMethod.Post,
      url: "/api/task/t-mp-empty",
      headers: {
        [HeaderName.ContentType]: "multipart/form-data; boundary=tests",
      },
      body: "--tests--",
    });

    await handleTask(req, res);

    expect(capturedBodyText).toBe("");
  });

  it("passes empty bodyText to authorizeTaskBody for octet-stream requests", async () => {
    let capturedBodyText: string | undefined = "unset";
    const deps = createRequestHandlersDeps(serializer, {
      store: {
        tasks: new Map([["t-octet-empty", { task: { id: "t-octet-empty" } }]]),
      },
      taskRunner: { run: async () => "ok" },
      router: { extract: () => ({ kind: "task", id: "t-octet-empty" }) },
      authorizeTaskBody: async (
        _req: unknown,
        _taskId: string,
        bodyText?: string,
      ) => {
        capturedBodyText = bodyText;
        return null;
      },
    });

    const { handleTask } = createRequestHandlers(deps);
    const { req, res } = createReqRes({
      method: HttpMethod.Post,
      url: "/api/task/t-octet-empty",
      headers: { [HeaderName.ContentType]: MimeType.ApplicationOctetStream },
      body: "raw",
    });

    await handleTask(req, res);

    expect(capturedBodyText).toBe("");
  });
});
