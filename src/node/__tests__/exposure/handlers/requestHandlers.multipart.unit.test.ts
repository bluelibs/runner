import {
  createRequestHandlers,
  type RequestProcessingDeps,
} from "../../../exposure/requestHandlers";
import { Serializer } from "../../../../serializer";
import * as multipartModule from "../../../exposure/multipart";
import {
  createReqRes,
  HeaderName,
  HttpMethod,
  MimeType,
  type NodeLikeHeaders,
} from "./requestHandlers.test.utils";
import { createMessageError } from "../../../../errors";

describe("requestHandlers - multipart and sanitization", () => {
  const getDeps = () => ({
    store: {
      tasks: new Map([["t", { task: async () => 1 }]]),
      errors: new Map(),
      asyncContexts: new Map(),
    },
    taskRunner: { run: async () => 1 },
    eventManager: { emit: async () => undefined } as any,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    authenticator: async () => ({ ok: true as const }),
    allowList: { ensureTask: () => null, ensureEvent: () => null },
    router: {
      basePath: "/api",
      extract: (_: string) => ({ kind: "task", id: "t" }),
      isUnderBase: () => true,
    },
    cors: undefined,
    serializer: new Serializer(),
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("multipart response handling", () => {
    it("responds with parse error when multipart fails", async () => {
      jest
        .spyOn(multipartModule, "isMultipart")
        .mockImplementation((ct: string) => /multipart\/form-data/i.test(ct));
      jest.spyOn(multipartModule, "parseMultipartInput").mockResolvedValue({
        ok: false,
        response: {
          status: 400,
          body: { ok: false, error: { code: "INVALID_MULTIPART" } },
        },
      } as any);

      const { handleTask } = createRequestHandlers(getDeps() as any);
      const headers = {
        [HeaderName.ContentType]: `${MimeType.MultipartFormData}; boundary=abc`,
      } satisfies NodeLikeHeaders;

      const { req, res } = createReqRes({
        method: HttpMethod.Post,
        url: "/api/task/t",
        headers,
        body: null,
        autoEnd: true,
      });
      await handleTask(req, res);
      expect(res._status).toBe(400);
      const json = res._buf
        ? JSON.parse((res._buf as Buffer).toString("utf8"))
        : undefined;
      expect(json?.error?.code).toBe("INVALID_MULTIPART");
    });

    it("normalizes non-object error responses", async () => {
      jest
        .spyOn(multipartModule, "isMultipart")
        .mockImplementation(() => true as never);
      jest.spyOn(multipartModule, "parseMultipartInput").mockResolvedValue({
        ok: false,
        response: { status: 500, error: "STRING_ERR" },
      } as any);

      const { handleTask } = createRequestHandlers(getDeps() as any);
      const { req, res } = createReqRes({
        method: HttpMethod.Post,
        url: "/api/task/t",
        headers: {
          [HeaderName.ContentType]: `${MimeType.MultipartFormData}; boundary=abc`,
        },
        body: null,
        autoEnd: true,
      });
      await handleTask(req, res);
      expect(res._status).toBe(500);
      const json = res._buf
        ? JSON.parse((res._buf as Buffer).toString("utf8"))
        : undefined;
      expect(json?.error?.code).toBe("INTERNAL_ERROR");
    });

    it("returns body without sanitization when status<500", async () => {
      jest
        .spyOn(multipartModule, "isMultipart")
        .mockImplementation(() => true as never);
      jest.spyOn(multipartModule, "parseMultipartInput").mockResolvedValue({
        ok: false,
        response: {
          status: 401,
          body: { ok: false, error: { code: "INVALID_TOKEN" } },
        },
      } as any);

      const { handleTask } = createRequestHandlers(getDeps() as any);
      const { req, res } = createReqRes({
        method: HttpMethod.Post,
        url: "/api/task/t",
        headers: {
          [HeaderName.ContentType]: `${MimeType.MultipartFormData}; boundary=abc`,
        },
        body: null,
        autoEnd: true,
      });
      await handleTask(req, res);
      expect(res._status).toBe(401);
      const json = res._buf
        ? JSON.parse((res._buf as Buffer).toString("utf8"))
        : undefined;
      expect(json?.error?.code).toBe("INVALID_TOKEN");
    });

    it("normalizes {statusCode, error} and sanitizes 500 errors", async () => {
      jest
        .spyOn(multipartModule, "isMultipart")
        .mockImplementation(() => true as never);
      jest.spyOn(multipartModule, "parseMultipartInput").mockResolvedValue({
        ok: false,
        response: {
          status: 500,
          body: {
            ok: false,
            error: { message: "Sensitive Error", code: "STREAM_ERROR" },
          },
        },
      });

      const { handleTask } = createRequestHandlers(
        getDeps() as unknown as RequestProcessingDeps,
      );
      const { req, res } = createReqRes({
        method: HttpMethod.Post,
        url: "/api/task/t",
        headers: {
          [HeaderName.ContentType]: `${MimeType.MultipartFormData}; boundary=abc`,
        },
        body: null,
        autoEnd: true,
      });
      await handleTask(req, res);

      expect(res._status).toBe(500);
      const json = res._buf
        ? JSON.parse((res._buf as Buffer).toString("utf8"))
        : undefined;
      expect(json?.error?.code).toBe("STREAM_ERROR");
      expect(json?.error?.message).toBe("Internal Error");
    });

    it("surfaces error via handler when multipart module throws", async () => {
      jest
        .spyOn(multipartModule, "isMultipart")
        .mockImplementation(() => true as never);
      jest
        .spyOn(multipartModule, "parseMultipartInput")
        .mockImplementation(() => {
          throw createMessageError("parse-fail");
        });

      const { handleTask } = createRequestHandlers(getDeps() as any);
      const { req, res } = createReqRes({
        method: HttpMethod.Post,
        url: "/api/task/t",
        headers: {
          [HeaderName.ContentType]: `${MimeType.MultipartFormData}; boundary=abc`,
        },
        body: null,
        autoEnd: true,
      });
      await handleTask(req, res);
      expect(res._status).toBe(500);
      const json = res._buf
        ? JSON.parse((res._buf as Buffer).toString("utf8"))
        : undefined;
      expect(json?.error?.code).toBe("INTERNAL_ERROR");
    });
  });

  describe("sanitization logic", () => {
    it("returns sanitized error on finalize failure", async () => {
      jest
        .spyOn(multipartModule, "isMultipart")
        .mockImplementation(() => true as never);
      jest.spyOn(multipartModule, "parseMultipartInput").mockResolvedValue({
        ok: true,
        value: { a: 1 },
        finalize: Promise.resolve({
          ok: false,
          response: { status: 400, error: { code: "INVALID_DATA" } },
        }),
      } as any);

      const { handleTask } = createRequestHandlers(getDeps() as any);
      const { req, res } = createReqRes({
        method: HttpMethod.Post,
        url: "/api/task/t",
        headers: {
          [HeaderName.ContentType]: `${MimeType.MultipartFormData}; boundary=abc`,
        },
        body: null,
        autoEnd: true,
      });
      await handleTask(req, res);
      expect(res._status).toBe(400);
      const json = res._buf
        ? JSON.parse((res._buf as Buffer).toString("utf8"))
        : undefined;
      expect(json?.error?.code).toBe("INVALID_DATA");
    });

    it("normalizes numeric codes to string in error response", async () => {
      jest
        .spyOn(multipartModule, "isMultipart")
        .mockImplementation(() => true as never);
      jest.spyOn(multipartModule, "parseMultipartInput").mockResolvedValue({
        ok: false,
        response: {
          status: 500,
          error: { code: 123, message: "INVALID" },
        },
      } as any);

      const { handleTask } = createRequestHandlers(getDeps() as any);
      const { req, res } = createReqRes({
        method: HttpMethod.Post,
        url: "/api/task/t",
        headers: {
          [HeaderName.ContentType]: `${MimeType.MultipartFormData}; boundary=abc`,
        },
        body: null,
        autoEnd: true,
      });
      await handleTask(req, res);
      expect(res._status).toBe(500);
      const json = res._buf
        ? JSON.parse((res._buf as Buffer).toString("utf8"))
        : undefined;
      expect(json?.error?.code).toBe("INTERNAL_ERROR");
    });

    it("includes id and data in sanitized response when present", async () => {
      jest
        .spyOn(multipartModule, "isMultipart")
        .mockImplementation(() => true as never);
      jest.spyOn(multipartModule, "parseMultipartInput").mockResolvedValue({
        ok: false,
        response: {
          status: 500,
          body: {
            ok: false,
            error: { message: "X", id: "MY_ID", data: { foo: 1 } },
          },
        },
      } as any);
      const { handleTask } = createRequestHandlers(getDeps() as any);
      const { req, res } = createReqRes({
        method: HttpMethod.Post,
        url: "/api/task/t",
        headers: { [HeaderName.ContentType]: MimeType.MultipartFormData },
        body: null,
        autoEnd: true,
      });
      await handleTask(req, res);
      const json = res._buf
        ? JSON.parse((res._buf as Buffer).toString("utf8"))
        : undefined;
      expect(json?.error?.id).toBe("MY_ID");
      expect(json?.error?.data).toEqual({ foo: 1 });
    });

    it("includes payload when sanitized error is NOT 500", async () => {
      jest
        .spyOn(multipartModule, "isMultipart")
        .mockImplementation(() => true as never);
      jest.spyOn(multipartModule, "parseMultipartInput").mockResolvedValue({
        ok: false,
        response: { status: 400, body: { ok: false, custom: "data" } },
      } as any);
      const { handleTask } = createRequestHandlers(getDeps() as any);
      const { req, res } = createReqRes({
        method: HttpMethod.Post,
        url: "/api/task/t",
        headers: { [HeaderName.ContentType]: MimeType.MultipartFormData },
        body: null,
        autoEnd: true,
      });
      await handleTask(req, res);
      const json = res._buf
        ? JSON.parse((res._buf as Buffer).toString("utf8"))
        : undefined;
      expect(json?.custom).toBe("data");
    });

    it("falls back to INTERNAL_ERROR when error code is numeric (pre-sanitization in multipart)", async () => {
      jest
        .spyOn(multipartModule, "isMultipart")
        .mockImplementation(() => true as never);
      jest.spyOn(multipartModule, "parseMultipartInput").mockResolvedValue({
        ok: false,
        response: { status: 500, body: { ok: false, error: { code: 123 } } },
      } as any);
      const { handleTask } = createRequestHandlers(getDeps() as any);
      const { req, res } = createReqRes({
        method: HttpMethod.Post,
        url: "/api/task/t",
        headers: { [HeaderName.ContentType]: MimeType.MultipartFormData },
        body: null,
        autoEnd: true,
      });
      await handleTask(req, res);
      const json = res._buf
        ? JSON.parse((res._buf as Buffer).toString("utf8"))
        : undefined;
      expect(json?.error?.code).toBe("INTERNAL_ERROR");
    });
  });
});
