import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { r, run, globals } from "../index";
import { createHttpSmartClient, createHttpMixedClient } from "../node";
import type { RunResult } from "../models/RunResult";

describe("httpClientFactory", () => {
  let runtime: RunResult<void>;

  beforeAll(async () => {
    const app = r.resource("test.httpClientFactory").build();
    runtime = await run(app);
  });

  afterAll(async () => {
    await runtime.dispose();
  });

  it("should inject httpClientFactory from globals", async () => {
    const factory = await runtime.getResourceValue(
      globals.resources.httpClientFactory,
    );
    expect(factory).toBeDefined();
    expect(typeof factory).toBe("function");
  });

  it("should automatically inject serializer into created clients", async () => {
    const factory = await runtime.getResourceValue(
      globals.resources.httpClientFactory,
    );

    const client = factory({
      baseUrl: "http://localhost:9999/__runner",
    });

    expect(client).toBeDefined();
    expect(client.task).toBeDefined();
    expect(client.event).toBeDefined();
  });

  it("should automatically inject error registry from store", async () => {
    // Define a custom error and register it
    const TestError = r
      .error<{ code: number; message: string }>("test.errors.TestError")
      .build();

    const appWithError = r
      .resource("test.withError")
      .register([TestError])
      .build();

    const rt = await run(appWithError);

    const factory = await rt.getResourceValue(globals.resources.httpClientFactory);
    const store = await rt.getResourceValue(globals.resources.store);

    // Verify error is in store
    expect(store.errors.has(TestError.id)).toBe(true);

    // Factory should have picked it up
    expect(factory).toBeDefined();

    await rt.dispose();
  });

  it("should automatically inject async contexts from store", async () => {
    const requestContext = r
      .asyncContext<{ requestId: string }>("test.ctx.request")
      .build();

    const appWithContext = r
      .resource("test.withContext")
      .register([requestContext])
      .build();

    const rt = await run(appWithContext);

    const factory = await rt.getResourceValue(globals.resources.httpClientFactory);
    const store = await rt.getResourceValue(globals.resources.store);

    // Verify context is in store
    expect(store.asyncContexts.has(requestContext.id)).toBe(true);

    // Factory should have picked it up
    expect(factory).toBeDefined();

    await rt.dispose();
  });

  it("should work as a dependency in tasks", async () => {
    const myTask = r
      .task("test.tasks.useFactory")
      .dependencies({ factory: globals.resources.httpClientFactory })
      .run(async (_, { factory }) => {
        const client = factory({
          baseUrl: "http://example.com/__runner",
        });
        return { hasClient: !!client };
      })
      .build();

    const app = r.resource("test.app").register([myTask]).build();
    const rt = await run(app);

    const result = await rt.runTask(myTask);
    expect(result).toBeDefined();
    expect(result!.hasClient).toBe(true);

    await rt.dispose();
  });

  // Node-specific tests: use node-only exports directly
  if (
    typeof process !== "undefined" &&
    process.versions &&
    process.versions.node
  ) {
    it("should provide createSmartClient in Node environment via node entry", async () => {
      const serializer = (await runtime.getResourceValue(
        globals.resources.serializer,
      )) as any;
      const smartClient = createHttpSmartClient({
        baseUrl: "http://localhost:9999/__runner",
        serializer,
      });

      expect(smartClient).toBeDefined();
      expect(smartClient.task).toBeDefined();
      expect(smartClient.event).toBeDefined();
    });

    it("should provide createMixedClient in Node environment via node entry", async () => {
      const serializer = (await runtime.getResourceValue(
        globals.resources.serializer,
      )) as any;
      const mixedClient = createHttpMixedClient({
        baseUrl: "http://localhost:9999/__runner",
        serializer,
      });

      expect(mixedClient).toBeDefined();
      expect(mixedClient.task).toBeDefined();
      expect(mixedClient.event).toBeDefined();
    });
  }
});
