import * as http from "http";
import { Readable, Writable } from "stream";
import { createHttpMixedClient } from "../http-mixed-client";
import { getDefaultSerializer } from "../../serializer";
import { createNodeFile } from "../files";

function asIncoming(
  res: Readable,
  headers: Record<string, string>,
): http.IncomingMessage {
  (res as unknown as { headers: Record<string, string> }).headers = headers;
  return res as unknown as http.IncomingMessage;
}

describe("createMixedHttpClient (unit)", () => {
  const baseUrl = "http://127.0.0.1:7777/__runner";

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("JSON path: uses fetch client for plain inputs", async () => {
    const calls: Array<{
      url: string;
      headers: Record<string, string>;
      body: any;
    }> = [];
    const fetchMock = async (url: RequestInfo | URL, init?: RequestInit) => {
      const bodyStr = String(init?.body ?? "");
      calls.push({
        url: String(url),
        headers: (init?.headers as Record<string, string>) ?? {},
        body: JSON.parse(bodyStr),
      });
      return {
        text: async () =>
          getDefaultSerializer().stringify({ ok: true, result: 42 }),
      } as unknown as Response;
    };

    const client = createHttpMixedClient({
      baseUrl,
      fetchImpl: fetchMock,
      serializer: getDefaultSerializer(),
    });
    const out = await client.task<{ a: number }, number>("my.task", { a: 1 });
    expect(out).toBe(42);
    // Ensure we did not attempt to use Node http.request
    const httpReqSpy = jest.spyOn(http, "request");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${baseUrl}/task/my.task`);
    expect(httpReqSpy).not.toHaveBeenCalled();
  });

  it("Readable input: delegates to Smart client and returns a stream", async () => {
    const reqSpy = jest
      .spyOn(http, "request")
      .mockImplementation((_opts: unknown, cb: unknown) => {
        const callback = cb as (res: http.IncomingMessage) => void;
        const res = Readable.from([Buffer.from("STREAM", "utf8")]);
        const im = asIncoming(res, { "content-type": "text/plain" });
        callback(im);
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
      });

    const client = createHttpMixedClient({
      baseUrl,
      serializer: getDefaultSerializer(),
    });
    const input = Readable.from("hello");
    const out = (await client.task("duplex", input)) as Readable;
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      out
        .on("data", (c: any) =>
          chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))),
        )
        .on("end", () => resolve())
        .on("error", reject);
    });
    expect(
      Buffer.concat(chunks as unknown as Uint8Array[]).toString("utf8"),
    ).toBe("STREAM");
    expect(reqSpy).toHaveBeenCalled();
  });

  it("Node File sentinel: delegates to Smart client (multipart)", async () => {
    const reqSpy = jest
      .spyOn(http, "request")
      .mockImplementation((_opts: unknown, cb: unknown) => {
        const callback = cb as (res: http.IncomingMessage) => void;
        const env = { ok: true, result: "OK" };
        const body = Buffer.from(getDefaultSerializer().stringify(env), "utf8");
        const res = Readable.from([body]); // Correction: was [body] in previous view, but let's check carefully.
        // Wait, original was:
        // const res = Readable.from([body]);
        // The previous tool output showed I replaced it with... nothing changed in body logic, just indentation.
        // But my tool call above replaced lines 98-116.
        // Let's use the content I know is there.
        const im = asIncoming(res, { "content-type": "application/json" });
        callback(im);
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
      });

    const client = createHttpMixedClient({
      baseUrl,
      serializer: getDefaultSerializer(),
    });
    const input = {
      file: createNodeFile(
        { name: "a.txt" },
        { stream: Readable.from("abc") },
        "F1",
      ),
    } as const;
    const out = await client.task("upload", input);
    expect(out).toBe("OK");
    expect(reqSpy).toHaveBeenCalled();
  });

  it("Array + nested object sentinel: Smart client path is used", async () => {
    const reqSpy = jest
      .spyOn(http, "request")
      .mockImplementation((_opts: unknown, cb: unknown) => {
        const callback = cb as (res: http.IncomingMessage) => void;
        const env = { ok: true, result: "OK2" };
        const body = Buffer.from(getDefaultSerializer().stringify(env), "utf8");
        const res = Readable.from([body]);
        const im = asIncoming(res, { "content-type": "application/json" });
        callback(im);
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
      });

    const client = createHttpMixedClient({
      baseUrl,
      serializer: getDefaultSerializer(),
    });
    const input = {
      arr: [
        {
          nested: createNodeFile(
            { name: "n.bin" },
            { buffer: Buffer.from([1, 2, 3]) },
            "FN",
          ),
        },
      ],
    } as const;
    const out = await client.task("upload", input);
    expect(out).toBe("OK2");
    expect(reqSpy).toHaveBeenCalled();
  });

  it("event(): always uses JSON path", async () => {
    const calls: Array<{ url: string; body: any }> = [];
    const fetchMock = async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init?.body ?? "")),
      });
      return {
        text: async () =>
          getDefaultSerializer().stringify({ ok: true, result: undefined }),
      } as unknown as Response;
    };

    const client = createHttpMixedClient({
      baseUrl,
      fetchImpl: fetchMock,
      serializer: getDefaultSerializer(),
    });
    await client.event("log", { x: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${baseUrl}/event/log`);
  });

  it("eventWithResult(): uses JSON path and returns result", async () => {
    const calls: Array<{ url: string; body: any }> = [];
    const fetchMock = async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(url),
        body: getDefaultSerializer().parse(String(init?.body ?? "")),
      });
      return {
        text: async () =>
          getDefaultSerializer().stringify({ ok: true, result: { x: 2 } }),
      } as unknown as Response;
    };

    const client = createHttpMixedClient({
      baseUrl,
      fetchImpl: fetchMock,
      serializer: getDefaultSerializer(),
    });

    expect(typeof client.eventWithResult).toBe("function");
    const out = await client.eventWithResult!("log", { x: 1 });
    expect(out).toEqual({ x: 2 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${baseUrl}/event/log`);
    expect(calls[0].body).toEqual({ payload: { x: 1 }, returnPayload: true });
  });

  it("throws when baseUrl is empty", () => {
    expect(() =>
      createHttpMixedClient({
        baseUrl: "" as unknown as string, // Force invalid url to validation
        serializer: getDefaultSerializer(),
      } as any),
    ).toThrow();
  });

  it("Invalid Node File sentinel (id not string): stays on JSON path", async () => {
    const calls: Array<{ url: string; body: any }> = [];
    const fetchMock = async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init?.body ?? "")),
      });
      return {
        text: async () =>
          getDefaultSerializer().stringify({ ok: true, result: 9 }),
      } as unknown as Response;
    };

    const client = createHttpMixedClient({
      baseUrl,
      fetchImpl: fetchMock,
      serializer: getDefaultSerializer(),
    });

    const httpReqSpy = jest.spyOn(http, "request");
    const out = await client.task("my.task", {
      file: { $runnerFile: "File", id: 123, _node: { buffer: "x" } },
    } as unknown as { file: unknown });

    expect(out).toBe(9);
    expect(calls).toHaveLength(1);
    expect(httpReqSpy).not.toHaveBeenCalled();
  });

  it("Invalid Node File sentinel (_node not object): stays on JSON path", async () => {
    const calls: Array<{ url: string; body: any }> = [];
    const fetchMock = async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init?.body ?? "")),
      });
      return {
        text: async () =>
          getDefaultSerializer().stringify({ ok: true, result: 10 }),
      } as unknown as Response;
    };

    const client = createHttpMixedClient({
      baseUrl,
      fetchImpl: fetchMock,
      serializer: getDefaultSerializer(),
    });

    const httpReqSpy = jest.spyOn(http, "request");
    const out = await client.task("my.task", {
      file: { $runnerFile: "File", id: "F1", _node: null },
    } as unknown as { file: unknown });

    expect(out).toBe(10);
    expect(calls).toHaveLength(1);
    expect(httpReqSpy).not.toHaveBeenCalled();
  });

  it("Primitive inputs stay on JSON path", async () => {
    const calls: Array<{ url: string; body: any }> = [];
    const fetchMock = async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init?.body ?? "")),
      });
      return {
        text: async () =>
          getDefaultSerializer().stringify({ ok: true, result: 11 }),
      } as unknown as Response;
    };

    const client = createHttpMixedClient({
      baseUrl,
      fetchImpl: fetchMock,
      serializer: getDefaultSerializer(),
    });

    const httpReqSpy = jest.spyOn(http, "request");
    const out = await client.task("my.task", 1);

    expect(out).toBe(11);
    expect(calls).toHaveLength(1);
    expect(httpReqSpy).not.toHaveBeenCalled();
  });
});
