import { Readable } from "stream";
import { createHttpClient } from "../../http-client";
import { createWebFile } from "../../platform/createWebFile";
import { createFile as createNodeFile } from "../../node/platform/createFile";
import { getDefaultSerializer } from "../../serializer";
import { IErrorHelper } from "../../defs";
import * as exposureFetchModule from "../../http-fetch-tunnel.resource";
import { TunnelError } from "../../globals/resources/tunnel/protocol";

type ExposureFetchState = {
  lastCfg?: any;
  task: jest.Mock;
  event: jest.Mock;
  eventWithResult: jest.Mock;
};

interface TestGlobal {
  fetch?: typeof fetch;
}

const testGlobal = globalThis as unknown as TestGlobal;

const buildExposureFetchMock = () => {
  const state: ExposureFetchState = {
    task: jest.fn(async (_id: string, _input: any) => "JSON-OK"),
    event: jest.fn(async (_id: string, _payload?: any) => {}),
    eventWithResult: jest.fn(async (_id: string, _payload?: any) => ({
      ok: true,
    })),
    lastCfg: undefined,
  };
  const factory = jest.fn((cfg: any) => {
    state.lastCfg = cfg;
    return {
      task: state.task,
      event: state.event,
      eventWithResult: state.eventWithResult,
    };
  });
  return { factory, state };
};

describe("http-client (universal)", () => {
  const baseUrl = "http://127.0.0.1:7070/__runner";
  let exposureFactory: jest.Mock;
  let exposureState: ExposureFetchState;

  beforeEach(() => {
    jest.clearAllMocks();
    const built = buildExposureFetchMock();
    exposureFactory = built.factory;
    exposureState = built.state;
    jest
      .spyOn(exposureFetchModule, "createExposureFetch")
      .mockImplementation(exposureFactory as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("JSON fallback uses exposure fetch", async () => {
    const client = createHttpClient({
      baseUrl,
      serializer: getDefaultSerializer(),
    });
    const result = await client.task("t.json", { a: 1 });
    expect(result).toBe("JSON-OK");
    expect(exposureState.lastCfg?.baseUrl).toBe(baseUrl.replace(/\/$/, ""));
    expect(exposureState.task).toBeDefined();
  });

  it("event delegates to exposure fetch event", async () => {
    const client = createHttpClient({
      baseUrl,
      serializer: getDefaultSerializer(),
    });
    await client.event("e.hello", { x: true });
    expect(exposureState.event).toHaveBeenCalledTimes(1);
    expect(exposureState.event.mock.calls[0][0]).toBe("e.hello");
  });

  it("eventWithResult delegates to exposure fetch eventWithResult", async () => {
    const client = createHttpClient({
      baseUrl,
      serializer: getDefaultSerializer(),
    });
    expect(typeof client.eventWithResult).toBe("function");
    const out = await client.eventWithResult!("e.ret", { x: true });
    expect(exposureState.eventWithResult).toHaveBeenCalledTimes(1);
    expect(exposureState.eventWithResult.mock.calls[0][0]).toBe("e.ret");
    expect(out).toEqual({ ok: true });
  });

  it("eventWithResult throws when underlying exposure fetch lacks support", async () => {
    exposureFactory.mockImplementationOnce((_cfg: any) => {
      return { task: jest.fn(), event: jest.fn() };
    });
    const client = createHttpClient({
      baseUrl,
      serializer: getDefaultSerializer(),
    });
    await expect(client.eventWithResult!("e.nope", { a: 1 })).rejects.toThrow(
      /eventWithResult not available/i,
    );
  });

  it("eventWithResult: rethrows typed app error via errorRegistry when TunnelError carries id+data", async () => {
    exposureState.eventWithResult.mockImplementationOnce(async () => {
      throw new TunnelError("INTERNAL_ERROR", "boom", undefined, {
        id: "tests.errors.evret",
        data: { code: 9, message: "evret" },
      });
    });
    const helper = {
      id: "tests.errors.evret",
      throw: (data: any) => {
        throw new Error("typed-evret:" + String(data?.code));
      },
      is: () => false,
      toString: () => "",
    } as any;
    const client = createHttpClient({
      baseUrl,
      serializer: getDefaultSerializer(),
      errorRegistry: new Map([["tests.errors.evret", helper]]),
    });
    await expect(client.eventWithResult!("e.ret", { a: 1 })).rejects.toThrow(
      /typed-evret:9/,
    );
  });

  it("browser multipart uses FormData and onRequest sees auth header", async () => {
    const blob = new Blob([new Uint8Array(Buffer.from("abc"))], {
      type: "text/plain",
    });
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
      } as unknown as Response;
    });
    const onRequest = jest.fn();
    const client = createHttpClient({
      baseUrl,
      fetchImpl: fetchMock as unknown as typeof fetch,
      auth: { token: "tok" },
      onRequest,
      serializer: getDefaultSerializer(),
      contexts: [
        {
          id: "ctx.web",
          use: () => ({ a: 1 }),
          serialize: (v: any) => JSON.stringify(v),
          parse: (s: string) => JSON.parse(s),
          provide: (v: any, fn: any) => fn(),
          require: () => ({}) as any,
        } as unknown as any,
      ],
    });
    const r = await client.task("t.upload.web", { file });
    expect(r).toBe("UP");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(calls[0].headers["x-runner-token"]).toBe("tok");
    expect(typeof calls[0].headers["x-runner-context"]).toBe("string");
  });

  it("browser multipart uses default filename when meta.name missing", async () => {
    const blob = new Blob([new Uint8Array(Buffer.from("abc"))], {
      type: "application/octet-stream",
    });
    // Intentionally pass meta without name to exercise default filename branch
    const file = createWebFile({} as any, blob, "FDEF");
    const fetchMock = jest.fn(
      async (url: any, init?: any) =>
        ({
          text: async () =>
            getDefaultSerializer().stringify({ ok: true, result: "DEF" }),
        }) as any,
    );
    const client = createHttpClient({
      baseUrl,
      fetchImpl: fetchMock as any,
      serializer: getDefaultSerializer(),
    });
    const r = await client.task("t.upload.def", { file } as any);
    expect(r).toBe("DEF");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("browser multipart rethrows typed app error via errorRegistry", async () => {
    const blob = new Blob([Buffer.from("abc") as any], { type: "text/plain" });
    const file = createWebFile(
      { name: "a.txt", type: "text/plain" },
      blob,
      "FERR",
    );
    const serializer = getDefaultSerializer();
    const fetchMock = jest.fn(async (url: any, init?: any) => {
      const env = {
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "boom",
          id: "tests.errors.web",
          data: { code: 11, message: "boom" },
        },
      };
      return { text: async () => serializer.stringify(env) } as any;
    });
    const helper = {
      id: "tests.errors.web",
      throw: (data: any) => {
        throw new Error("typed-web:" + String(data?.code));
      },
      is: () => false,
      toString: () => "",
    } as unknown as IErrorHelper<{ code: number; message: string }>;
    const client = createHttpClient({
      baseUrl,
      fetchImpl: fetchMock as any,
      serializer: getDefaultSerializer(),
      errorRegistry: new Map([["tests.errors.web", helper]]),
    });
    await expect(client.task("t.upload.err", { file } as any)).rejects.toThrow(
      /typed-web:11/,
    );
  });

  it("event: rethrows typed app error via errorRegistry when TunnelError carries id+data", async () => {
    exposureState.event.mockImplementationOnce(async () => {
      throw new TunnelError("INTERNAL_ERROR", "boom", undefined, {
        id: "tests.errors.ev",
        data: { code: 8, message: "ev" },
      });
    });
    const helper = {
      id: "tests.errors.ev",
      throw: (data: any) => {
        throw new Error("typed-ev:" + String(data?.code));
      },
      is: () => false,
      toString: () => "",
    } as any;
    const client = createHttpClient({
      baseUrl,
      serializer: getDefaultSerializer(),
      errorRegistry: new Map([["tests.errors.ev", helper]]),
    });
    await expect(client.event("e.1", { a: 1 })).rejects.toThrow(/typed-ev:8/);
  });

  it("JSON fallback rethrows TunnelError when no registry present", async () => {
    exposureState.task.mockImplementationOnce(async () => {
      throw new TunnelError("INTERNAL_ERROR", "json-raw");
    });
    const client = createHttpClient({
      baseUrl,
      serializer: getDefaultSerializer(),
    });
    await expect(client.task("t.json.raw", { a: 1 } as any)).rejects.toThrow(
      /json-raw/,
    );
  });

  it("event rethrows TunnelError when no registry present", async () => {
    exposureState.event.mockImplementationOnce(async () => {
      throw new TunnelError("INTERNAL_ERROR", "ev-raw");
    });
    const client = createHttpClient({
      baseUrl,
      serializer: getDefaultSerializer(),
    });
    await expect(client.event("e.raw", { a: 1 } as any)).rejects.toThrow(
      /ev-raw/,
    );
  });

  it("throws helpful error when Node File sentinel present", async () => {
    const client = createHttpClient({
      baseUrl,
      serializer: getDefaultSerializer(),
    });
    const nodeFile = createNodeFile(
      { name: "nf.bin" },
      { buffer: Buffer.from([1]) },
      "NF_ERR",
    );
    await expect(
      client.task("t.node.file", { f: nodeFile } as any),
    ).rejects.toThrow(
      /createHttpClient \(universal\) detected Node file input/i,
    );
  });

  it("throws helpful error when input is a Node Readable stream", async () => {
    const client = createHttpClient({
      baseUrl,
      serializer: getDefaultSerializer(),
    });
    const stream = Readable.from([Buffer.from("data")]);
    await expect(client.task("t.duplex", stream)).rejects.toThrow(
      /cannot send a Node stream/i,
    );
  });

  it("falls back to global fetch when fetchImpl not provided (web multipart)", async () => {
    const origFetch = testGlobal.fetch;
    testGlobal.fetch = jest.fn(async (_url: any, _init?: any) => ({
      text: async () =>
        getDefaultSerializer().stringify({ ok: true, result: "GUP" }),
    })) as unknown as typeof fetch;
    try {
      const blob = new Blob([Buffer.from("abc") as any], {
        type: "text/plain",
      });
      const file = createWebFile(
        { name: "a.txt", type: "text/plain" },
        blob,
        "F3",
      );
      const client = createHttpClient({
        baseUrl,
        auth: { token: "tk" },
        serializer: getDefaultSerializer(),
      });
      const r = await client.task("t.upload.web2", { file } as any);
      expect(r).toBe("GUP");
      expect(testGlobal.fetch).toHaveBeenCalledTimes(1);
    } finally {
      testGlobal.fetch = origFetch;
    }
  });

  it("throws on empty baseUrl", () => {
    expect(() =>
      createHttpClient({
        baseUrl: "" as any,
        serializer: getDefaultSerializer(),
      } as any),
    ).toThrow();
  });

  it("rethrows typed app error via errorRegistry when TunnelError carries id+data", async () => {
    // Make the mocked exposure fetch throw a TunnelError
    exposureState.task.mockImplementationOnce(async () => {
      throw new TunnelError("INTERNAL_ERROR", "boom", undefined, {
        id: "tests.errors.app",
        data: { code: 5, message: "boom" },
      });
    });
    const helper = {
      id: "tests.errors.app",
      throw: (data: any) => {
        throw new Error("typed:" + String(data?.code));
      },
      is: () => false,
      toString: () => "",
    } as any;
    const client = createHttpClient({
      baseUrl,
      serializer: getDefaultSerializer(),
      errorRegistry: new Map([["tests.errors.app", helper]]),
    });
    await expect(client.task("t.json", { a: 1 } as any)).rejects.toThrow(
      /typed:5/,
    );
  });
});
