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

function createStore(eventId: string, asyncContexts: Map<string, unknown>) {
  return {
    events: new Map([[eventId, { event: { id: eventId } }]]),
    asyncContexts,
    errors: new Map(),
    resolveDefinitionId: (reference: unknown) =>
      typeof reference === "string"
        ? reference
        : (reference as { id?: string })?.id,
    toPublicId: (reference: unknown) =>
      typeof reference === "string"
        ? reference
        : ((reference as { id?: string })?.id ?? String(reference)),
  };
}

describe("eventHandler allowAsyncContext option", () => {
  it("disables user async-context hydration when allowAsyncContext resolver returns false", async () => {
    const serializer = new Serializer();
    const ctx = {
      id: "ctx-event-disabled",
      parse: jest.fn((value: string) => JSON.parse(value)),
      provide: jest.fn(async (_value: unknown, fn: () => Promise<unknown>) =>
        fn(),
      ),
    };

    const handler = createEventHandler({
      store: createStore("event.id", new Map([[ctx.id, ctx]])) as any,
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
      id: "ctx-event-default",
      parse: jest.fn((value: string) => JSON.parse(value)),
      provide: jest.fn(async (_value: unknown, fn: () => Promise<unknown>) =>
        fn(),
      ),
    };

    const handler = createEventHandler({
      store: createStore("event.id", new Map([[ctx.id, ctx]])) as any,
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
      store: createStore("event.id", new Map()) as any,
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

  it("falls back to raw event ids when request id resolution misses", async () => {
    const serializer = new Serializer();
    const ensureEvent = jest.fn(() => null);
    const authorizeEvent = jest.fn(() => null);
    const emitWithResult = jest.fn(async () => ({ echoed: true }));
    const rawEventId = "event.raw-id";
    jest.spyOn(requestBodyModule, "readJsonBody").mockResolvedValue({
      ok: true,
      value: { payload: { a: 1 }, returnPayload: true },
    });
    const handler = createEventHandler({
      store: {
        events: new Map([[rawEventId, { event: { id: rawEventId } }]]),
        asyncContexts: new Map(),
        errors: new Map(),
        resolveDefinitionId: () => undefined,
        toPublicId: (reference: unknown) =>
          typeof reference === "string"
            ? reference
            : ((reference as { id?: string })?.id ?? String(reference)),
      } as any,
      eventManager: {
        emit: async () => undefined,
        emitWithResult,
      } as any,
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any,
      authenticator: async () => ({ ok: true }),
      allowList: { ensureTask: () => null, ensureEvent },
      serializer,
      authorizeEvent,
    });

    const { req, res } = createReqRes({
      method: HttpMethod.Post,
      url: `/api/event/${rawEventId}`,
      headers: {
        [HeaderName.ContentType]: MimeType.ApplicationJson,
      },
      body: JSON.stringify({ payload: { a: 1 }, returnPayload: true }),
    });

    await handler(req, res, rawEventId);

    expect(res._status).toBe(200);
    expect(ensureEvent).toHaveBeenCalledWith(rawEventId);
    expect(authorizeEvent).toHaveBeenCalledWith(req, rawEventId);
    expect(emitWithResult).toHaveBeenCalledWith(
      { id: rawEventId },
      { a: 1 },
      expect.anything(),
    );
  });
});
