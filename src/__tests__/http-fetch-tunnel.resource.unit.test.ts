import { createExposureFetch } from "../http-fetch-tunnel.resource";
import { EJSON, type Serializer } from "../globals/resources/tunnel/serializer";

describe("http-fetch-tunnel.resource (unit)", () => {
  it("createExposureFetch: throws when baseUrl is empty or '/'", () => {
    expect(() => createExposureFetch({ baseUrl: "/" } as any)).toThrow(
      /requires baseUrl/,
    );
    expect(() => createExposureFetch({ baseUrl: "" } as any)).toThrow(
      /requires baseUrl/,
    );
  });

  it("createExposureFetch: throws when fetch is missing and no fetchImpl provided", () => {
    const original = (globalThis as any).fetch;
    (globalThis as any).fetch = undefined as any;
    try {
      expect(() => createExposureFetch({ baseUrl: "http://x" } as any)).toThrow(
        /fetch is not available/i,
      );
    } finally {
      (globalThis as any).fetch = original;
    }
  });

  it("createExposureFetch: task() uses timeout branch (sets AbortController) and succeeds", async () => {
    const calls: Array<{ url: string; init: any }> = [];
    const stubFetch: typeof fetch = (async (url: any, init: any) => {
      calls.push({ url, init });
      return {
        text: async () => JSON.stringify({ ok: true, result: 42 }),
      } as any;
    }) as any;

    const client = createExposureFetch({
      baseUrl: "http://api",
      timeoutMs: 5,
      fetchImpl: stubFetch,
      auth: { token: "T" },
    });
    const out = await client.task("t.id", { a: 1 });
    expect(out).toBe(42);
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("http://api/task/t.id");
    expect(calls[0].init.method).toBe("POST");
    // AbortController branch should have attached a signal
    expect(calls[0].init.signal).toBeDefined();
    // Header name is defaulted to x-runner-token
    expect(calls[0].init.headers["x-runner-token"]).toBe("T");
  });

  it("createExposureFetch: event() throws with message and with default fallback", async () => {
    // First, with explicit error message
    const fetchErrMsg: typeof fetch = (async () => ({
      text: async () =>
        JSON.stringify({ ok: false, error: { message: "boom" } }),
    })) as any;
    const c1 = createExposureFetch({
      baseUrl: "http://api",
      fetchImpl: fetchErrMsg,
    });
    await expect(c1.event("e.id", { x: 1 })).rejects.toThrow(/boom/);

    // Then, with default message fallback
    const fetchNoMsg: typeof fetch = (async () => ({
      text: async () => JSON.stringify({ ok: false }),
    })) as any;
    const c2 = createExposureFetch({
      baseUrl: "http://api",
      fetchImpl: fetchNoMsg,
    });
    await expect(c2.event("e.id", { y: 1 })).rejects.toThrow(
      /Tunnel event error/,
    );
  });

  it("createExposureFetch: event() throws when server returns empty response body", async () => {
    const fetchEmpty: typeof fetch = (async () => ({
      text: async () => "",
    })) as any;
    const c = createExposureFetch({
      baseUrl: "http://api",
      fetchImpl: fetchEmpty,
    });
    await expect(c.event("e.id", { y: 2 })).rejects.toThrow(
      /Tunnel event error/,
    );
  });

  it("createExposureFetch: task() error branch uses default message when missing", async () => {
    const fetchNoMsg: typeof fetch = (async () => ({
      text: async () => JSON.stringify({ ok: false }),
    })) as any;
    const c = createExposureFetch({
      baseUrl: "http://api",
      fetchImpl: fetchNoMsg,
    });
    await expect(c.task("t.id", { z: 1 })).rejects.toThrow(/Tunnel task error/);
  });

  it("createExposureFetch: strips trailing slash in baseUrl for task()", async () => {
    const calls: Array<{ url: string; init: any }> = [];
    const stubFetch: typeof fetch = (async (url: any, init: any) => {
      calls.push({ url, init });
      return {
        text: async () => JSON.stringify({ ok: true, result: "ok" }),
      } as any;
    }) as any;

    const client = createExposureFetch({
      baseUrl: "http://api/",
      fetchImpl: stubFetch,
    });
    await client.task("t.id");
    expect(calls[0].url).toBe("http://api/task/t.id");
  });

  it("createExposureFetch: defaults to Runner EJSON serializer for requests and responses", async () => {
    const seen: Array<{ url: string; init: any }> = [];
    const requestDate = new Date("2024-03-01T02:03:04.005Z");
    const responseDate = new Date("2024-03-02T03:04:05.006Z");

    const fetchImpl: typeof fetch = (async (url: any, init: any) => {
      seen.push({ url, init });
      const envelope = { ok: true, result: { seenAt: responseDate } };
      return {
        text: async () => EJSON.stringify(envelope),
      } as any;
    }) as any;

    const client = createExposureFetch({ baseUrl: "http://api", fetchImpl });
    const result = await client.task<{ seenAt: Date }, { seenAt: Date }>("task.id", {
      seenAt: requestDate,
    });

    expect(seen).toHaveLength(1);
    expect(typeof seen[0].init.body).toBe("string");
    expect(seen[0].init.body).toBe(
      EJSON.stringify({ input: { seenAt: requestDate } }),
    );
    expect(result.seenAt).toBeInstanceOf(Date);
    expect(result.seenAt.getTime()).toBe(responseDate.getTime());
  });

  it("createExposureFetch: honors a custom serializer when provided", async () => {
    const stringify = jest.fn((value: unknown) =>
      JSON.stringify({ wrapped: value }),
    );
    const parse = jest.fn((text: string) => JSON.parse(text).wrapped);
    const serializer: Serializer = { stringify, parse };

    const fetchImpl: typeof fetch = (async (_url: any, init: any) => {
      expect(init.body).toBe(JSON.stringify({ wrapped: { input: { foo: "bar" } } }));
      return {
        text: async () => JSON.stringify({ wrapped: { ok: true, result: 99 } }),
      } as any;
    }) as any;

    const client = createExposureFetch({
      baseUrl: "http://api",
      fetchImpl,
      serializer,
    });

    const out = await client.task<{ foo: string }, number>("task.id", { foo: "bar" });

    expect(out).toBe(99);
    expect(stringify).toHaveBeenCalledWith({ input: { foo: "bar" } });
    expect(parse).toHaveBeenCalledWith(
      JSON.stringify({ wrapped: { ok: true, result: 99 } }),
    );
  });

});
