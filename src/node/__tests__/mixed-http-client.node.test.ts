import * as http from "http";
import { Readable, Writable } from "stream";
import { createHttpMixedClient } from "../http-mixed-client";
import { EJSON } from "../../globals/resources/tunnel/serializer";
import { getDefaultSerializer } from "../../globals/resources/tunnel/serializer";
import { createNodeFile } from "../files";

function asIncoming(
  res: Readable,
  headers: Record<string, string>,
): http.IncomingMessage {
  (res as any).headers = headers;
  return res as any as http.IncomingMessage;
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
    const fetchMock = async (url: any, init?: any) => {
      const bodyStr = String(init?.body ?? "");
      calls.push({
        url: String(url),
        headers: init?.headers ?? {},
        body: JSON.parse(bodyStr),
      });
      return {
        text: async () =>
          getDefaultSerializer().stringify({ ok: true, result: 42 }),
      } as any;
    };

    const client = createHttpMixedClient({
      baseUrl,
      fetchImpl: fetchMock as any,
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
      .mockImplementation((opts: any, cb: any) => {
        const res = Readable.from([Buffer.from("STREAM", "utf8")]);
        const im = asIncoming(res, { "content-type": "text/plain" });
        cb(im);
        const sink = new Writable({
          write(_c, _e, n) {
            n();
          },
          final(n) {
            n();
          },
        }) as any;
        sink.on = (_: any, __: any) => sink;
        sink.setTimeout = () => sink;
        sink.destroy = () => undefined;
        return sink;
      }) as any;

    const client = createHttpMixedClient({ baseUrl, serializer: getDefaultSerializer() });
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
    expect(Buffer.concat(chunks).toString("utf8")).toBe("STREAM");
    expect(reqSpy).toHaveBeenCalled();
  });

  it("Node File sentinel: delegates to Smart client (multipart)", async () => {
    const reqSpy = jest
      .spyOn(http, "request")
      .mockImplementation((opts: any, cb: any) => {
        const env = { ok: true, result: "OK" };
        const body = Buffer.from(getDefaultSerializer().stringify(env), "utf8");
        const res = Readable.from([body]);
        const im = asIncoming(res, { "content-type": "application/json" });
        cb(im);
        const sink = new Writable({
          write(_c, _e, n) {
            n();
          },
          final(n) {
            n();
          },
        }) as any;
        sink.on = (_: any, __: any) => sink;
        sink.setTimeout = () => sink;
        sink.destroy = () => undefined;
        return sink;
      }) as any;

    const client = createHttpMixedClient({ baseUrl, serializer: getDefaultSerializer() });
    const input = {
      file: createNodeFile(
        { name: "a.txt" },
        { stream: Readable.from("abc") },
        "F1",
      ),
    } as const;
    const out = await client.task("upload", input as any);
    expect(out).toBe("OK");
    expect(reqSpy).toHaveBeenCalled();
  });

  it("Array + nested object sentinel: Smart client path is used", async () => {
    const reqSpy = jest
      .spyOn(http, "request")
      .mockImplementation((opts: any, cb: any) => {
        const env = { ok: true, result: "OK2" };
        const body = Buffer.from(getDefaultSerializer().stringify(env), "utf8");
        const res = Readable.from([body]);
        const im = asIncoming(res, { "content-type": "application/json" });
        cb(im);
        const sink = new Writable({
          write(_c, _e, n) {
            n();
          },
          final(n) {
            n();
          },
        }) as any;
        sink.on = (_: any, __: any) => sink;
        sink.setTimeout = () => sink;
        sink.destroy = () => undefined;
        return sink;
      }) as any;

    const client = createHttpMixedClient({ baseUrl, serializer: getDefaultSerializer() });
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
    const out = await client.task("upload", input as any);
    expect(out).toBe("OK2");
    expect(reqSpy).toHaveBeenCalled();
  });

  it("event(): always uses JSON path", async () => {
    const calls: Array<{ url: string; body: any }> = [];
    const fetchMock = async (url: any, init?: any) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init?.body ?? "")),
      });
      return {
        text: async () =>
          getDefaultSerializer().stringify({ ok: true, result: undefined }),
      } as any;
    };

    const client = createHttpMixedClient({
      baseUrl,
      fetchImpl: fetchMock as any,
      serializer: getDefaultSerializer(),
    });
    await client.event("log", { x: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${baseUrl}/event/log`);
  });

  it("eventWithResult(): uses JSON path and returns result", async () => {
    const calls: Array<{ url: string; body: any }> = [];
    const fetchMock = async (url: any, init?: any) => {
      calls.push({
        url: String(url),
        body: getDefaultSerializer().parse(String(init?.body ?? "")),
      });
      return {
        text: async () =>
          getDefaultSerializer().stringify({ ok: true, result: { x: 2 } }),
      } as any;
    };

    const client = createHttpMixedClient({
      baseUrl,
      fetchImpl: fetchMock as any,
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
      createHttpMixedClient({ baseUrl: "" as any, serializer: getDefaultSerializer() } as any),
    ).toThrow();
  });
});
