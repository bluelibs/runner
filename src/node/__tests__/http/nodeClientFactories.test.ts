import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { r, globals as coreGlobals } from "../../..";
import { globals as nodeGlobals, run as runNode } from "../../node";
import type { RunResult } from "../../../models/RunResult";

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
});
