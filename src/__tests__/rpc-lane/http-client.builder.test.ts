import { Serializer } from "../../serializer";
import { r } from "../..";
import {
  registerRpcLaneHttpClientPreset,
  rpcLaneHttpClient,
} from "../../definers/builders/rpcLane";
import { defineResource } from "../../define";
import { run } from "../../run";
import { globalResources } from "../../globals/globalResources";

describe("r.rpcLane.httpClient helper", () => {
  it("uses fetch preset with injected clientFactory when available", async () => {
    const helper = rpcLaneHttpClient({
      client: "fetch",
      baseUrl: "http://example.test/__runner",
    });

    const taskMock = jest.fn(async () => "remote-value");
    const communicator = await helper(
      {},
      {
        clientFactory: () => ({
          task: taskMock,
          event: async () => {},
        }),
      },
    );

    await expect(
      communicator.task!("app.tasks.any", { ok: true }),
    ).resolves.toBe("remote-value");
    expect(taskMock).toHaveBeenCalledWith("app.tasks.any", { ok: true });
  });

  it("forwards event/eventWithResult when using injected clientFactory", async () => {
    const helper = rpcLaneHttpClient({
      client: "fetch",
      baseUrl: "http://example.test/__runner",
    });

    const eventMock = jest.fn(async () => undefined);
    const eventWithResultMock = jest.fn(async () => ({ ok: "yes" }));
    const communicator = await helper(
      {},
      {
        clientFactory: () => ({
          task: async () => "remote-value",
          event: eventMock,
          eventWithResult: eventWithResultMock,
        }),
      },
    );

    await expect(
      communicator.event?.("app.events.any", { p: true }),
    ).resolves.toBeUndefined();
    await expect(
      communicator.eventWithResult?.("app.events.any", { p: true }),
    ).resolves.toEqual({ ok: "yes" });

    expect(eventMock).toHaveBeenCalledWith("app.events.any", { p: true });
    expect(eventWithResultMock).toHaveBeenCalledWith("app.events.any", {
      p: true,
    });
  });

  it("falls back to createHttpClient path without clientFactory", async () => {
    const fetchImpl: typeof fetch = (async (_input: any) =>
      new Response(JSON.stringify({ ok: true, result: 7 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as any;

    const helper = r.rpcLane.httpClient({
      client: "fetch",
      baseUrl: "http://example.test/__runner",
      fetchImpl,
    });

    const communicator = await helper(
      {},
      {
        serializer: new Serializer(),
      },
    );

    await expect(
      communicator.task!("app.tasks.add", { a: 3, b: 4 }),
    ).resolves.toBe(7);
  });

  it("supports event/eventWithResult in fetch fallback path", async () => {
    const helper = r.rpcLane.httpClient({
      client: "fetch",
      baseUrl: "http://example.test/__runner",
      fetchImpl: (async (input: any) => {
        const url = String(input?.url ?? input);
        if (url.includes("/event/")) {
          return new Response(JSON.stringify({ ok: true, result: { v: 11 } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ ok: true, result: null }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as any,
    });

    const communicator = await helper(
      {},
      {
        serializer: new Serializer(),
      },
    );

    await expect(
      communicator.event?.("app.events.notify", { x: 1 }),
    ).resolves.toBeUndefined();
    await expect(
      communicator.eventWithResult?.("app.events.notify", { x: 1 }),
    ).resolves.toEqual({ v: 11 });
  });

  it("uses default fetch preset when client is omitted", async () => {
    const helper = rpcLaneHttpClient({
      baseUrl: "http://example.test/__runner",
    });

    const taskMock = jest.fn(async () => "default-fetch");
    const communicator = await helper(
      {},
      {
        clientFactory: () => ({
          task: taskMock,
        }),
      },
    );

    await expect(communicator.task!("app.tasks.default", {})).resolves.toBe(
      "default-fetch",
    );
    expect(taskMock).toHaveBeenCalledWith("app.tasks.default", {});
  });

  it("creates serializer and registries from store when serializer is not provided", async () => {
    const helper = r.rpcLane.httpClient({
      client: "fetch",
      baseUrl: "http://example.test/__runner",
      fetchImpl: (async () =>
        new Response(JSON.stringify({ ok: true, result: "store-aware" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })) as any,
    });

    const runtime = await run(
      defineResource({ id: "tests.rpc-lane.fetch.store", register: [] }) as any,
    );
    const store = await runtime.getResourceValue(globalResources.store as any);

    const communicator = await helper({}, { store });
    await expect(
      communicator.task!("app.tasks.with-store", { v: 1 }),
    ).resolves.toBe("store-aware");

    await runtime.dispose();
  });

  it("throws when preset is missing", async () => {
    const helper = r.rpcLane.httpClient({
      client: "unknown-preset",
      baseUrl: "http://example.test/__runner",
    });

    await expect(helper({}, {})).rejects.toMatchObject({
      name: "runner.errors.rpcLane.httpClientPresetNotFound",
    });
  });

  it("throws when preset returns invalid communicator", async () => {
    registerRpcLaneHttpClientPreset(
      "tests.rpcLane.invalid-communicator",
      async () => ({}) as any,
    );
    const helper = r.rpcLane.httpClient({
      client: "tests.rpcLane.invalid-communicator",
      baseUrl: "http://example.test/__runner",
    });

    await expect(helper({}, {})).rejects.toMatchObject({
      name: "runner.errors.rpcLane.communicatorContract",
    });
  });
});
