import * as http from "http";
import { Readable, Writable } from "stream";
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { r, globals as coreGlobals } from "../../..";
import { globals as nodeGlobals, run as runNode } from "../../node";
import type { RunResult } from "../../../models/RunResult";

function asIncoming(
  res: Readable,
  headers: Record<string, string>,
): http.IncomingMessage {
  (res as unknown as { headers: Record<string, string> }).headers = headers;
  return res as unknown as http.IncomingMessage;
}

function makeSink(): http.ClientRequest {
  const sink = new Writable({
    write(_c, _e, n) {
      n();
    },
    final(n) {
      n();
    },
  }) as unknown as http.ClientRequest;

  (sink as unknown as { on: any }).on = (_: any, __: any) => sink;
  (sink as unknown as { setTimeout: any }).setTimeout = () => sink;
  (sink as unknown as { destroy: any }).destroy = () => undefined;
  return sink;
}

describe("node client factories (DI)", () => {
  let runtime: RunResult<void>;

  beforeAll(async () => {
    const app = r.resource("test.nodeFactories").build();
    runtime = await runNode(app);
  });

  afterAll(async () => {
    await runtime.dispose();
  });

  it("should expose httpSmartClientFactory via node globals and auto-inject deps", async () => {
    const factory = await runtime.getResourceValue(
      nodeGlobals.resources.httpSmartClientFactory,
    );
    expect(factory).toBeDefined();
    expect(typeof factory).toBe("function");
    const client = factory({
      baseUrl: "http://localhost:9999/__runner",
    });
    expect(client).toBeDefined();
    expect(client.task).toBeDefined();
    expect(client.event).toBeDefined();
  });

  it("should expose httpMixedClientFactory via node globals and auto-inject deps", async () => {
    const factory = await runtime.getResourceValue(
      nodeGlobals.resources.httpMixedClientFactory,
    );
    expect(factory).toBeDefined();
    expect(typeof factory).toBe("function");
    const client = factory({
      baseUrl: "http://localhost:9999/__runner",
    });
    expect(client).toBeDefined();
    expect(client.task).toBeDefined();
    expect(client.event).toBeDefined();
  });

  it("should pull error registry and async contexts from store", async () => {
    const TestError = r
      .error<{ code: number; message: string }>("test.errors.NodeFactoryTest")
      .build();
    const ctx = r.asyncContext<{ requestId: string }>("test.ctx").build();

    const appWithDeps = r
      .resource("test.appWithDeps")
      .register([TestError, ctx])
      .build();

    const rt = await runNode(appWithDeps);

    const store = await rt.getResourceValue(coreGlobals.resources.store);
    expect(store.errors.has(TestError.id)).toBe(true);
    expect(store.asyncContexts.has(ctx.id)).toBe(true);

    // Factories should be resolvable and build clients successfully
    const mixedFactory = await rt.getResourceValue(
      nodeGlobals.resources.httpMixedClientFactory,
    );
    const client = mixedFactory({
      baseUrl: "http://localhost:9999/__runner",
    });
    expect(client).toBeDefined();

    await rt.dispose();
  });

  it("httpSmartClientFactory should rethrow typed errors (auto-injected errorRegistry)", async () => {
    const SmartError = r
      .error<{ code: number }>("test.errors.NodeSmartFactory")
      .build();
    const app = r
      .resource("test.smartFactoryTypedErrors")
      .register([SmartError])
      .build();
    const rt = await runNode(app);

    const factory = await rt.getResourceValue(
      nodeGlobals.resources.httpSmartClientFactory,
    );

    const reqSpy = jest
      .spyOn(http, "request")
      .mockImplementation((_opts: unknown, cb: unknown) => {
        const callback = cb as (res: http.IncomingMessage) => void;
        const env = {
          ok: false,
          error: {
            code: "APP",
            message: "boom",
            id: SmartError.id,
            data: { code: 7 },
          },
        };
        const body = Buffer.from(JSON.stringify(env), "utf8");
        callback(
          asIncoming(Readable.from([body]), {
            "content-type": "application/json",
          }),
        );
        return makeSink();
      });

    const client = factory({ baseUrl: "http://127.0.0.1:9999/__runner" });

    await expect(client.task("t.json", { a: 1 } as any)).rejects.toMatchObject({
      name: SmartError.id,
      id: SmartError.id,
      data: { code: 7 },
    });
    expect(reqSpy).toHaveBeenCalled();

    jest.restoreAllMocks();
    await rt.dispose();
  });
});
