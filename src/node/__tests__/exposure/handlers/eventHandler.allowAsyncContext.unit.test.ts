import { createEventHandler } from "../../../exposure/handlers/eventHandler";
import { Serializer } from "../../../../serializer";
import * as requestBodyModule from "../../../exposure/requestBody";
import {
  createReqRes,
  HeaderName,
  HttpMethod,
  MimeType,
} from "./requestHandlers.test.utils";
import { cancellationError } from "../../../../errors";

describe("eventHandler allowAsyncContext option", () => {
  it("disables user async-context hydration when allowAsyncContext resolver returns false", async () => {
    const serializer = new Serializer();
    const ctx = {
      id: "ctx.event.disabled",
      parse: jest.fn((value: string) => JSON.parse(value)),
      provide: jest.fn(async (_value: unknown, fn: () => Promise<unknown>) =>
        fn(),
      ),
    };

    const handler = createEventHandler({
      store: {
        events: new Map([["event.id", { event: { id: "event.id" } }]]),
        asyncContexts: new Map([[ctx.id, ctx]]),
        errors: new Map(),
      } as any,
      eventManager: {
        emit: async () => undefined,
        emitWithResult: async () => undefined,
      } as any,
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any,
      authenticator: async () => ({ ok: true }),
      allowList: { ensureTask: () => null, ensureEvent: () => null },
      serializer,
      allowAsyncContext: () => false,
    });

    const { req, res } = createReqRes({
      method: HttpMethod.Post,
      url: "/api/event/event.id",
      headers: {
        [HeaderName.ContentType]: MimeType.ApplicationJson,
        [HeaderName.XRunnerContext]: serializer.stringify({
          [ctx.id]: JSON.stringify({ hidden: true }),
        }),
      },
      body: JSON.stringify({ payload: { a: 1 } }),
    });

    await handler(req, res, "event.id");
    expect(res._status).toBe(200);
    expect(ctx.parse).not.toHaveBeenCalled();
    expect(ctx.provide).not.toHaveBeenCalled();
  });

  it("hydrates user async-context when allowAsyncContext is omitted", async () => {
    const serializer = new Serializer();
    const ctx = {
      id: "ctx.event.default",
      parse: jest.fn((value: string) => JSON.parse(value)),
      provide: jest.fn(async (_value: unknown, fn: () => Promise<unknown>) =>
        fn(),
      ),
    };

    const handler = createEventHandler({
      store: {
        events: new Map([["event.id", { event: { id: "event.id" } }]]),
        asyncContexts: new Map([[ctx.id, ctx]]),
        errors: new Map(),
      } as any,
      eventManager: {
        emit: async () => undefined,
        emitWithResult: async () => undefined,
      } as any,
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any,
      authenticator: async () => ({ ok: true }),
      allowList: { ensureTask: () => null, ensureEvent: () => null },
      serializer,
    });

    const { req, res } = createReqRes({
      method: HttpMethod.Post,
      url: "/api/event/event.id",
      headers: {
        [HeaderName.ContentType]: MimeType.ApplicationJson,
        [HeaderName.XRunnerContext]: serializer.stringify({
          [ctx.id]: JSON.stringify({ enabled: true }),
        }),
      },
      body: JSON.stringify({ payload: { a: 1 } }),
    });

    await handler(req, res, "event.id");
    expect(res._status).toBe(200);
    expect(ctx.parse).toHaveBeenCalledTimes(1);
    expect(ctx.provide).toHaveBeenCalledTimes(1);
  });

  it("skips cancellation response write when headers are already sent", async () => {
    const serializer = new Serializer();
    jest
      .spyOn(requestBodyModule, "readJsonBody")
      .mockRejectedValue(
        cancellationError.create({ reason: "Client Closed Request" }),
      );

    const handler = createEventHandler({
      store: {
        events: new Map([["event.id", { event: { id: "event.id" } }]]),
        asyncContexts: new Map(),
        errors: new Map(),
      } as any,
      eventManager: {
        emit: async () => undefined,
        emitWithResult: async () => undefined,
      } as any,
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any,
      authenticator: async () => ({ ok: true }),
      allowList: { ensureTask: () => null, ensureEvent: () => null },
      serializer,
    });

    const { req, res } = createReqRes({
      method: HttpMethod.Post,
      url: "/api/event/event.id",
      headers: { [HeaderName.ContentType]: MimeType.ApplicationJson },
      body: JSON.stringify({ payload: { a: 1 } }),
    });
    res.headersSent = true;
    res.writableEnded = true;

    await handler(req, res as any, "event.id");
    expect(res._status).toBeUndefined();
  });
});
