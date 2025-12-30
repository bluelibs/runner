import { createExposureFetch } from "../../http-fetch-tunnel.resource";
import { EJSON } from "../../globals/resources/tunnel/serializer";

describe("httpFetchTunnel & createExposureFetch - additional coverage", () => {
  it("normalizes baseUrl and serializes bodies (postJson lines)", async () => {
    const calls: Array<{
      url: string;
      body: any;
      headers: Record<string, string>;
    }> = [];
    const fetchMock = async (url: any, init?: any) => {
      const bodyStr = String(init?.body ?? "");
      const parsed = bodyStr ? JSON.parse(bodyStr) : undefined;
      calls.push({
        url: String(url),
        body: parsed,
        headers: init?.headers ?? {},
      });
      return {
        text: async () => JSON.stringify({ ok: true, result: 7 }),
      } as any;
    };

    const client = createExposureFetch({
      baseUrl: "http://example.test/__runner/",
      fetchImpl: fetchMock as any,
      timeoutMs: 1,
      serializer: EJSON,
    });
    // task with defined input
    const r = await client.task<{ a: number }, number>("t1", { a: 1 });
    expect(r).toBe(7);
    // event with undefined payload
    await client.event("e1");

    expect(calls.length).toBe(2);
    // Base URL trimmed, no double slash
    expect(calls[0].url).toBe("http://example.test/__runner/task/t1");
    // postJson used JSON.stringify(body ?? {}): both have bodies
    expect(calls[0].body).toEqual({ input: { a: 1 } });
    expect(calls[1].url).toBe("http://example.test/__runner/event/e1");
    expect(calls[1].body).toEqual({ payload: undefined });
  });

  it("triggers timeout abort path in postJson (function coverage)", async () => {
    const fetchAbort = async (_url: any, init?: any) => {
      return await new Promise((_, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        if (signal?.aborted) {
          reject(new Error("aborted"));
        } else if (signal) {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }
      });
    };

    const client = createExposureFetch({
      baseUrl: "http://example.test/__runner",
      fetchImpl: fetchAbort as any,
      timeoutMs: 1,
      serializer: EJSON,
    });
    await expect(client.task("t1", {})).rejects.toThrow(/aborted/);
  });

  it("throws when fetchImpl is not a function", () => {
    expect(() =>
      createExposureFetch({
        baseUrl: "http://example.test/__runner",
        fetchImpl: 123 as any,
        serializer: EJSON,
      }),
    ).toThrow(/global fetch is not available/i);
  });

  it("treats empty response body as error with default messages (task/event)", async () => {
    const emptyBodyFetch = async (_url: any, _init?: any) =>
      ({ text: async () => "" }) as any;
    const client = createExposureFetch({
      baseUrl: "http://example.test/__runner",
      fetchImpl: emptyBodyFetch as any,
      serializer: EJSON,
    });
    await expect(client.task("tid" as any, {})).rejects.toThrow(
      /Tunnel task error/,
    );
    await expect(client.event("eid" as any, {})).rejects.toThrow(
      /Tunnel event error/,
    );
  });

  it("throws when baseUrl is missing", () => {
    expect(() =>
      createExposureFetch({
        baseUrl: "" as any,
        fetchImpl: (async () => ({ text: async () => "{}" }) as any) as any,
        serializer: EJSON,
      }),
    ).toThrow(/requires baseUrl/i);
  });

  it("normalizeError exports and works standalone", async () => {
    const { normalizeError } = await import("../../http-fetch-tunnel.resource");
    const e1 = normalizeError(new Error("boom"));
    expect(e1).toBeInstanceOf(Error);
    expect(e1.message).toBe("boom");
    const e2 = normalizeError("x");
    expect(e2.message).toBe("x");
    const e3 = normalizeError(undefined);
    expect(e3.message).toBe("undefined");
  });
});
