import { createRequestHandlers } from "../../../exposure/requestHandlers";
import { Serializer } from "../../../../serializer";
import {
  createReqRes,
  HeaderName,
  HttpMethod,
  MimeType,
  type NodeLikeHeaders,
} from "./requestHandlers.test.utils";

describe("requestHandlers - content-type handling", () => {
  const getDeps = () => ({
    store: { tasks: new Map([["t", { task: async () => 7 }]]) },
    taskRunner: { run: async () => 7 },
    eventManager: {} as any,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    authenticator: async () => ({ ok: true }),
    allowList: { ensureTask: () => null, ensureEvent: () => null },
    router: {
      basePath: "/api",
      extract: (_: string) => ({ kind: "task", id: "t" }),
      isUnderBase: () => true,
    },
    cors: undefined,
  });

  it('covers truthy branch of contentTypeRaw[0] || "" (array with value)', async () => {
    const deps = getDeps();
    const { handleTask } = createRequestHandlers({
      ...deps,
      serializer: new Serializer(),
    } as any);
    const headers = {
      [HeaderName.ContentType]: [MimeType.ApplicationJson],
    } satisfies NodeLikeHeaders;

    const { req, res } = createReqRes({
      method: HttpMethod.Post,
      url: "/api/task/t",
      headers,
      body: "{}",
    });
    await handleTask(req, res);
    expect(res._status).toBe(200);
  });

  it("handles content-type array with empty first element", async () => {
    const deps = getDeps();
    const { handleTask } = createRequestHandlers({
      ...deps,
      serializer: new Serializer(),
    } as any);
    const headers = {
      [HeaderName.ContentType]: [""],
    } satisfies NodeLikeHeaders;

    const { req, res } = createReqRes({
      method: HttpMethod.Post,
      url: "/api/task/t",
      headers,
      body: "{}",
    });
    await handleTask(req, res);
    expect(res._status).toBe(200);
  });

  it("handles missing content-type by treating as empty string", async () => {
    const deps = getDeps();
    const { handleTask } = createRequestHandlers(deps as any);
    const { req, res } = createReqRes({
      method: HttpMethod.Post,
      url: "/api/task/t",
      headers: {},
      body: null,
      autoEnd: true,
    });
    await handleTask(req, res);
    expect(res._status).toBe(200);
    const json = res._buf
      ? JSON.parse((res._buf as Buffer).toString("utf8"))
      : undefined;
    expect(json?.ok).toBe(true);
  });
});
