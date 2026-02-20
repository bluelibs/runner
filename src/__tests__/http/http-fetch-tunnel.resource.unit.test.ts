import { createExposureFetch } from "../../http-fetch-tunnel.resource";
import { Serializer } from "../../serializer";
import { IErrorHelper } from "../../defs";
import { createMessageError } from "../../errors";

describe("http-fetch-tunnel.resource (unit)", () => {
  it("createExposureFetch: throws when baseUrl is empty or '/'", () => {
    // @ts-expect-error
    expect(() => createExposureFetch({ baseUrl: "/" })).toThrow(
      /requires baseUrl/,
    );
    // @ts-expect-error
    expect(() => createExposureFetch({ baseUrl: "" })).toThrow(
      /requires baseUrl/,
    );
  });

  it("createExposureFetch: throws when fetch is missing and no fetchImpl provided", () => {
    const original = globalThis.fetch;
    // @ts-expect-error
    globalThis.fetch = undefined;
    try {
      // @ts-expect-error
      expect(() => createExposureFetch({ baseUrl: "http://x" })).toThrow(
        /fetch is not available/i,
      );
    } finally {
      globalThis.fetch = original;
    }
  });

  it("createExposureFetch: task() uses timeout branch (sets AbortController) and succeeds", async () => {
    const calls: Array<{ url: string; init: any }> = [];
    const stubFetch: typeof fetch = (async (url: any, init: any) => {
      calls.push({ url, init });
      return {
        text: async () => JSON.stringify({ ok: true, result: 42 }),
      } as Response;
    }) as unknown as typeof fetch;

    const client = createExposureFetch({
      baseUrl: "http://api",
      timeoutMs: 5,
      fetchImpl: stubFetch,
      auth: { token: "T" },
      serializer: new Serializer(),
    });
    const out = await client.task("t.id", { a: 1 });
    expect(out).toBe(42);
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("http://api/task/t.id");
    expect(calls[0].init.method).toBe("POST");
    // AbortController branch should have attached a signal
    expect(calls[0].init.signal).toBeDefined();
    // Redirects are blocked to avoid forwarding auth headers.
    expect(calls[0].init.redirect).toBe("error");
    // Header name is defaulted to x-runner-token
    expect(calls[0].init.headers["x-runner-token"]).toBe("T");
  });

  it("createExposureFetch: event() throws with message and with default fallback", async () => {
    // First, with explicit error message
    const fetchErrMsg: typeof fetch = (async () => ({
      text: async () =>
        JSON.stringify({ ok: false, error: { message: "boom" } }),
    })) as unknown as typeof fetch;
    const c1 = createExposureFetch({
      baseUrl: "http://api",
      fetchImpl: fetchErrMsg,
      serializer: new Serializer(),
    });
    await expect(c1.event("e.id", { x: 1 })).rejects.toThrow(/boom/);

    // Then, with default message fallback
    const fetchNoMsg: typeof fetch = (async () => ({
      text: async () => JSON.stringify({ ok: false }),
    })) as unknown as typeof fetch;
    const c2 = createExposureFetch({
      baseUrl: "http://api",
      fetchImpl: fetchNoMsg,
      serializer: new Serializer(),
    });
    await expect(c2.event("e.id", { y: 1 })).rejects.toThrow(
      /Tunnel event error/,
    );
  });

  it("createExposureFetch: event() throws when server returns empty response body", async () => {
    const fetchEmpty: typeof fetch = (async () => ({
      text: async () => "",
    })) as unknown as typeof fetch;
    const c = createExposureFetch({
      baseUrl: "http://api",
      fetchImpl: fetchEmpty,
      serializer: new Serializer(),
    });
    await expect(c.event("e.id", { y: 2 })).rejects.toThrow(
      /Tunnel event error/,
    );
  });

  it("createExposureFetch: eventWithResult() posts returnPayload and returns result", async () => {
    const serializer = new Serializer();
    const calls: Array<{ url: string; init: any; body: any }> = [];
    const fetchImpl: typeof fetch = (async (url: any, init: any) => {
      const parsed = serializer.parse<any>(String(init?.body ?? ""));
      calls.push({ url: String(url), init, body: parsed });
      return {
        text: async () => serializer.stringify({ ok: true, result: { x: 2 } }),
      } as Response;
    }) as unknown as typeof fetch;

    const c = createExposureFetch({
      baseUrl: "http://api",
      fetchImpl,
      serializer,
    });

    expect(typeof c.eventWithResult).toBe("function");
    const out = await c.eventWithResult!("e.id", { x: 1 });
    expect(out).toEqual({ x: 2 });
    expect(calls[0].url).toBe("http://api/event/e.id");
    expect(calls[0].body).toEqual({ payload: { x: 1 }, returnPayload: true });
  });

  it("createExposureFetch: eventWithResult() throws when server is ok but omits result", async () => {
    const serializer = new Serializer();
    const fetchImpl: typeof fetch = (async () => ({
      text: async () => serializer.stringify({ ok: true }),
    })) as unknown as typeof fetch;
    const c = createExposureFetch({
      baseUrl: "http://api",
      fetchImpl,
      serializer,
    });

    await expect(c.eventWithResult!("e.id", { x: 1 })).rejects.toThrow(
      /did not include result/i,
    );
  });

  it("createExposureFetch: eventWithResult() rethrows typed app errors via errorRegistry", async () => {
    const serializer = new Serializer();
    const fetchImpl: typeof fetch = (async () => ({
      text: async () =>
        serializer.stringify({
          ok: false,
          error: {
            code: "INTERNAL_ERROR",
            message: "boom",
            id: "tests.errors.evr",
            data: { code: 12 },
          },
        }),
    })) as unknown as typeof fetch;

    const helper = {
      id: "tests.errors.evr",
      throw: (data: any) => {
        throw createMessageError("typed-evr:" + String(data?.code));
      },
      is: () => false,
      toString: () => "",
    } as unknown as IErrorHelper<any>;

    const c = createExposureFetch({
      baseUrl: "http://api",
      fetchImpl,
      serializer,
      errorRegistry: new Map([["tests.errors.evr", helper]]),
    });

    await expect(c.eventWithResult!("e.id", { x: 1 })).rejects.toThrow(
      /typed-evr:12/,
    );
  });

  it("createExposureFetch: eventWithResult() rethrows TunnelError when no typed mapping is present", async () => {
    const serializer = new Serializer();
    const fetchImpl: typeof fetch = (async () => ({
      text: async () => serializer.stringify({ ok: false }),
    })) as unknown as typeof fetch;
    const c = createExposureFetch({
      baseUrl: "http://api",
      fetchImpl,
      serializer,
    });

    await expect(c.eventWithResult!("e.id", { x: 1 })).rejects.toThrow(
      /Tunnel event error/,
    );
  });

  it("createExposureFetch: task() error branch uses default message when missing", async () => {
    const fetchNoMsg: typeof fetch = (async () => ({
      text: async () => JSON.stringify({ ok: false }),
    })) as unknown as typeof fetch;
    const c = createExposureFetch({
      baseUrl: "http://api",
      fetchImpl: fetchNoMsg,
      serializer: new Serializer(),
    });
    await expect(c.task("t.id", { z: 1 })).rejects.toThrow(/Tunnel task error/);
  });

  it("createExposureFetch: strips trailing slash in baseUrl for task()", async () => {
    const calls: Array<{ url: string; init: any }> = [];
    const stubFetch: typeof fetch = (async (url: any, init: any) => {
      calls.push({ url, init });
      return {
        text: async () => JSON.stringify({ ok: true, result: "ok" }),
      } as Response;
    }) as unknown as typeof fetch;

    const client = createExposureFetch({
      baseUrl: "http://api/",
      fetchImpl: stubFetch,
      serializer: new Serializer(),
    });
    await client.task("t.id");
    expect(calls[0].url).toBe("http://api/task/t.id");
  });

  it("createExposureFetch: defaults to Serializer for requests and responses", async () => {
    const seen: Array<{ url: string; init: any }> = [];
    const requestDate = new Date("2024-03-01T02:03:04.005Z");
    const responseDate = new Date("2024-03-02T03:04:05.006Z");
    const serializer = new Serializer();

    const fetchImpl: typeof fetch = (async (url: any, init: any) => {
      seen.push({ url, init });
      const envelope = { ok: true, result: { seenAt: responseDate } };
      return {
        text: async () => serializer.stringify(envelope),
      } as Response;
    }) as unknown as typeof fetch;

    const client = createExposureFetch({
      baseUrl: "http://api",
      fetchImpl,
      serializer,
    });
    const result = await client.task<{ seenAt: Date }, { seenAt: Date }>(
      "task.id",
      {
        seenAt: requestDate,
      },
    );

    expect(seen).toHaveLength(1);
    expect(typeof seen[0].init.body).toBe("string");
    // Verify the request body can be deserialized correctly
    const parsedRequest = serializer.parse<{ input: { seenAt: Date } }>(
      seen[0].init.body,
    );
    expect(parsedRequest.input.seenAt).toBeInstanceOf(Date);
    expect(parsedRequest.input.seenAt.getTime()).toBe(requestDate.getTime());
    // Verify the response was deserialized correctly
    expect(result.seenAt).toBeInstanceOf(Date);
    expect(result.seenAt.getTime()).toBe(responseDate.getTime());
  });

  it("createExposureFetch: honors a custom serializer when provided", async () => {
    const serializer = new Serializer();
    const stringify = jest
      .spyOn(serializer, "stringify")
      .mockImplementation((value: unknown) =>
        JSON.stringify({ wrapped: value }),
      );
    const parse = jest
      .spyOn(serializer, "parse")
      .mockImplementation((text: string) => JSON.parse(text).wrapped);
    jest.spyOn(serializer, "addType");

    const fetchImpl: typeof fetch = (async (_url: any, init: any) => {
      expect(init.body).toBe(
        JSON.stringify({ wrapped: { input: { foo: "bar" } } }),
      );
      return {
        text: async () => JSON.stringify({ wrapped: { ok: true, result: 99 } }),
      } as Response;
    }) as unknown as typeof fetch;

    const client = createExposureFetch({
      baseUrl: "http://api",
      fetchImpl,
      serializer,
    });

    const out = await client.task<{ foo: string }, number>("task.id", {
      foo: "bar",
    });

    expect(out).toBe(99);
    expect(stringify).toHaveBeenCalledWith({ input: { foo: "bar" } });
    expect(parse).toHaveBeenCalledWith(
      JSON.stringify({ wrapped: { ok: true, result: 99 } }),
    );
  });
});
