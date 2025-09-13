import { defineResource } from "../../define";
import { run } from "../../run";
import { httpFetchTunnel, createExposureFetch } from "../../http-fetch-tunnel.resource";

describe("httpFetchTunnel & createExposureFetch - additional coverage", () => {
  it("normalizes baseUrl and serializes bodies (postJson lines)", async () => {
    const calls: Array<{ url: string; body: any; headers: Record<string, string> }> = [];
    const fetchMock = async (url: any, init?: any) => {
      const bodyStr = String(init?.body ?? "");
      const parsed = bodyStr ? JSON.parse(bodyStr) : undefined;
      calls.push({ url: String(url), body: parsed, headers: init?.headers ?? {} });
      return {
        text: async () => JSON.stringify({ ok: true, result: 7 }),
      } as any;
    };

    const client = createExposureFetch({ baseUrl: "http://example.test/__runner/", fetchImpl: fetchMock as any, timeoutMs: 1 });
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

    const client = createExposureFetch({ baseUrl: "http://example.test/__runner", fetchImpl: fetchAbort as any, timeoutMs: 1 });
    await expect(client.task("t1", {})).rejects.toThrow(/aborted/);
  });

  it("logs and rethrows on tunnel run/emit errors; swallows logger.error failures", async () => {
    const fetchErrorMock = async (_url: any, _init?: any) => {
      return { text: async () => JSON.stringify({ ok: false, error: { message: "X" } }) } as any;
    };

    const tunnel = httpFetchTunnel.with({ baseUrl: "http://example.test/__runner", fetchImpl: fetchErrorMock as any });
    const app = defineResource({ id: "fetch.tunnel.cov.app", register: [tunnel] });
    const rr = await run(app);
    // Force logger.error to throw to cover inner try/catch
    (rr.logger as any).error = () => { throw new Error("logger-fail"); };

    const runner = await rr.getResourceValue(tunnel.resource as any);
    await expect(runner.run({ id: "tid" } as any, {})).rejects.toThrow(/X/);
    await expect(runner.emit({ id: "eid", data: {} } as any)).rejects.toThrow(/X/);

    await rr.dispose();
  });

  it("throws when fetchImpl is not a function", () => {
    expect(() => createExposureFetch({ baseUrl: "http://example.test/__runner", fetchImpl: 123 as any })).toThrow(
      /global fetch is not available/i,
    );
  });

  it("runs/emit successfully via tunnel and uses custom auth header", async () => {
    const seen: Array<{ url: string; headers: Record<string, string>; body: any }> = [];
    const fetchOk = async (url: any, init?: any) => {
      const bodyStr = String(init?.body ?? "");
      const parsed = bodyStr ? JSON.parse(bodyStr) : undefined;
      seen.push({ url: String(url), headers: init?.headers ?? {}, body: parsed });
      return { text: async () => JSON.stringify({ ok: true, result: 9 }) } as any;
    };
    const tunnel = httpFetchTunnel.with({
      baseUrl: "http://example.test/__runner/",
      fetchImpl: fetchOk as any,
      auth: { header: "Authorization", token: "Bearer ABC" },
    });
    const app = defineResource({ id: "fetch.tunnel.cov.ok", register: [tunnel] });
    const rr = await run(app);
    const runner = await rr.getResourceValue(tunnel.resource as any);
    const out = await runner.run({ id: "sum" } as any, { a: 1 } as any);
    expect(out).toBe(9);
    await runner.emit({ id: "ping", data: { x: 1 } } as any);
    expect(seen[0].headers["authorization"]).toBe("Bearer ABC");
    expect(seen[1].headers["authorization"]).toBe("Bearer ABC");
    await rr.dispose();
  });

  it("uses global fetch when fetchImpl is omitted", async () => {
    const original = (globalThis as any).fetch;
    try {
      (globalThis as any).fetch = async (_url: any, _init?: any) => ({ text: async () => JSON.stringify({ ok: true, result: 3 }) }) as any;
      const tunnel = httpFetchTunnel.with({ baseUrl: "http://example.test/__runner" });
      const app = defineResource({ id: "fetch.tunnel.cov.global", register: [tunnel] });
      const rr = await run(app);
      const runner = await rr.getResourceValue(tunnel.resource as any);
      const out = await runner.run({ id: "tid" } as any, {});
      expect(out).toBe(3);
      await rr.dispose();
    } finally {
      (globalThis as any).fetch = original;
    }
  });

  it("treats empty response body as error with default messages (task/event)", async () => {
    const emptyBodyFetch = async (_url: any, _init?: any) => ({ text: async () => "" }) as any;
    const client = createExposureFetch({ baseUrl: "http://example.test/__runner", fetchImpl: emptyBodyFetch as any });
    await expect(client.task("tid" as any, {})).rejects.toThrow(/Tunnel task error/);
    await expect(client.event("eid" as any, {})).rejects.toThrow(/Tunnel event error/);
  });

  it("throws when baseUrl is missing", () => {
    expect(() => createExposureFetch({ baseUrl: "" as any, fetchImpl: (async () => ({ text: async () => "{}" }) as any) as any })).toThrow(
      /requires baseUrl/i,
    );
  });

  it("rethrows non-Error via normalizeError for run and emit", async () => {
    const fetchReject = async (_url: any, _init?: any) => {
      return Promise.reject("nope");
    };
    const tunnel = httpFetchTunnel.with({ baseUrl: "http://example.test/__runner", fetchImpl: fetchReject as any });
    const app = defineResource({ id: "fetch.tunnel.cov.nonerror", register: [tunnel] });
    const rr = await run(app);
    (rr.logger as any).error = () => { /* swallow */ };
    const runner = await rr.getResourceValue(tunnel.resource as any);
    await expect(runner.run({ id: "tid" } as any, {})).rejects.toThrow(/nope/);
    await expect(runner.emit({ id: "eid", data: {} } as any)).rejects.toThrow(/nope/);
    await rr.dispose();
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
