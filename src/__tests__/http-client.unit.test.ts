import { Readable } from "stream";

// Mocks for transport layers used by http-client
jest.mock("../http-fetch-tunnel.resource", () => {
  const task = jest.fn(async (_id: string, _input: any) => "JSON-OK");
  const event = jest.fn(async (_id: string, _payload?: any) => {});
  const createExposureFetch = jest.fn((cfg: any) => {
    (createExposureFetch as any).__lastCfg = cfg;
    (createExposureFetch as any).__task = task;
    (createExposureFetch as any).__event = event;
    return { task, event };
  });
  return { createExposureFetch };
});

jest.mock("../node/http-smart-client.model", () => {
  const createHttpSmartClient = jest.fn((_cfg: any) => ({
    task: jest.fn(async (_id: string, _input: any) => "SMART-OK"),
    event: jest.fn(async () => {}),
  }));
  return { createHttpSmartClient };
});

import { createHttpClient } from "../http-client";
import { createWebFile } from "../platform/createWebFile";
import { createFile as createNodeFile } from "../node/platform/createFile";
import { getDefaultSerializer } from "../globals/resources/tunnel/serializer";

describe("http-client", () => {
  const baseUrl = "http://127.0.0.1:7070/__runner";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("JSON fallback uses exposure fetch", async () => {
    const { createExposureFetch } = require("../http-fetch-tunnel.resource");
    const client = createHttpClient({ baseUrl });
    const result = await client.task("t.json", { a: 1 } as any);
    expect(result).toBe("JSON-OK");
    expect((createExposureFetch as any).__lastCfg.baseUrl).toBe(
      baseUrl.replace(/\/$/, ""),
    );
    expect((createExposureFetch as any).__task).toBeDefined();
  });

  it("event delegates to exposure fetch event", async () => {
    const { createExposureFetch } = require("../http-fetch-tunnel.resource");
    const client = createHttpClient({ baseUrl });
    await client.event("e.hello", { x: true } as any);
    const event = (createExposureFetch as any).__event as jest.Mock;
    expect(event).toHaveBeenCalledTimes(1);
    expect(event.mock.calls[0][0]).toBe("e.hello");
  });

  it("browser multipart uses FormData and onRequest sees auth header", async () => {
    const blob = new Blob([Buffer.from("abc") as any], { type: "text/plain" });
    const file = createWebFile(
      { name: "a.txt", type: "text/plain" },
      blob,
      "F2",
    );
    const calls: Array<{ url: string; headers: any; body: any }> = [];
    const fetchMock = jest.fn(async (url: any, init?: any) => {
      // Touch formdata to exercise code path (if available)
      const fd = init?.body as FormData;
      if (fd && typeof (fd as any).get === "function")
        (fd as any).get("__manifest");
      calls.push({
        url: String(url),
        headers: init?.headers ?? {},
        body: init?.body,
      });
      const env = { ok: true, result: "UP" };
      return {
        text: async () => getDefaultSerializer().stringify(env),
      } as any;
    });
    const onRequest = jest.fn();
    const client = createHttpClient({
      baseUrl,
      fetchImpl: fetchMock as any,
      auth: { token: "tok" },
      onRequest,
    });
    const r = await client.task("t.upload.web", { file } as any);
    expect(r).toBe("UP");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(calls[0].headers["x-runner-token"]).toBe("tok");
  });

  it("browser multipart uses default filename when meta.name missing", async () => {
    const blob = new Blob([Buffer.from("abc") as any], {
      type: "application/octet-stream",
    });
    // Intentionally pass meta without name to exercise default filename branch
    const file = createWebFile({} as any, blob, "FDEF");
    const fetchMock = jest.fn(
      async (url: any, init?: any) =>
        ({
          text: async () =>
            getDefaultSerializer().stringify({ ok: true, result: "DEF" }),
        } as any),
    );
    const client = createHttpClient({ baseUrl, fetchImpl: fetchMock as any });
    const r = await client.task("t.upload.def", { file } as any);
    expect(r).toBe("DEF");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("node multipart converts web blobs to buffers and delegates to smart client", async () => {
    const {
      createHttpSmartClient,
    } = require("../node/http-smart-client.model");
    // One node file, one web file
    const nodeSentinel = createNodeFile(
      { name: "n.bin" },
      { buffer: Buffer.from([1, 2]) },
      "N2",
    );
    const webBlob = new Blob([Buffer.from("xyz") as any], {
      type: "application/octet-stream",
    });
    const webSentinel = createWebFile({ name: "w.bin" }, webBlob, "W2");

    // Customize smart client return for this test
    (createHttpSmartClient as jest.Mock).mockReturnValueOnce({
      task: jest.fn(async () => "SMART-MP"),
      event: jest.fn(async () => {}),
    });
    const client = createHttpClient({ baseUrl, auth: { token: "t" } });
    const r = await client.task("t.upload.node", {
      a: nodeSentinel,
      b: webSentinel,
    } as any);
    expect(r).toBe("SMART-MP");
    expect(createHttpSmartClient).toHaveBeenCalledTimes(1);
    const args = (createHttpSmartClient as jest.Mock).mock.calls[0][0];
    expect(args.baseUrl).toBe(baseUrl.replace(/\/$/, ""));
  });

  it("duplex path delegates to smart client when input is Node Readable", async () => {
    const {
      createHttpSmartClient,
    } = require("../node/http-smart-client.model");
    (createHttpSmartClient as jest.Mock).mockReturnValueOnce({
      task: jest.fn(async () => "SMART-DUPLEX"),
      event: jest.fn(async () => {}),
    });
    const client = createHttpClient({ baseUrl });
    const stream = Readable.from([Buffer.from("data")]);
    const r = await client.task("t.duplex", stream as any);
    expect(r).toBe("SMART-DUPLEX");
    expect(createHttpSmartClient).toHaveBeenCalledTimes(1);
  });

  it("falls back to global fetch when fetchImpl not provided (web multipart)", async () => {
    const origFetch = (globalThis as any).fetch;
    (globalThis as any).fetch = jest.fn(async (_url: any, _init?: any) => ({
      text: async () =>
        getDefaultSerializer().stringify({ ok: true, result: "GUP" }),
    }));
    try {
      const blob = new Blob([Buffer.from("abc") as any], {
        type: "text/plain",
      });
      const file = createWebFile(
        { name: "a.txt", type: "text/plain" },
        blob,
        "F3",
      );
      const client = createHttpClient({ baseUrl, auth: { token: "tk" } });
      const r = await client.task("t.upload.web2", { file } as any);
      expect(r).toBe("GUP");
      expect(globalThis.fetch as any).toHaveBeenCalledTimes(1);
    } finally {
      (globalThis as any).fetch = origFetch;
    }
  });

  it("throws on empty baseUrl", () => {
    expect(() => createHttpClient({ baseUrl: "" as any })).toThrow();
  });
});
