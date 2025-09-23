import * as http from "http";
import { Readable, Writable } from "stream";
import { createHttpSmartClient } from "../http-smart-client.model";
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

describe("createHttpSmartClient (unit)", () => {
  const baseUrl = "http://127.0.0.1:1234/__runner";
  const client = createHttpSmartClient({ baseUrl, serializer: EJSON });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("JSON: posts JSON and parses ok envelope", async () => {
    const spy = jest
      .spyOn(http, "request")
      .mockImplementation((opts: any, cb: any) => {
        // Fake response with JSON content type
        const env = { ok: true, result: 5 };
        const body = Buffer.from(getDefaultSerializer().stringify(env), "utf8");
        const res = Readable.from([body]);
        const im = asIncoming(res, {
          "content-type": "application/json; charset=utf-8",
        });
        // Node's http.request calls callback synchronously in our mock
        cb(im);
        const req = new Writable({
          write(_chunk, _enc, next) {
            next();
          },
          final(cb2) {
            cb2();
          },
        }) as any;
        req.on = (_: any, __: any) => req;
        req.setTimeout = () => req;
        req.end = () => undefined;
        req.destroy = () => undefined;
        return req;
      }) as any;

    const out = await client.task("x", { a: 2, b: 3 } as any);
    expect(out).toBe(5);
    expect(spy).toHaveBeenCalled();
  });

  it("JSON: invokes onRequest hook with headers", async () => {
    const onRequest = jest.fn();
    jest.spyOn(http, "request").mockImplementation((opts: any, cb: any) => {
      const env = { ok: true, result: 1 };
      const body = Buffer.from(getDefaultSerializer().stringify(env), "utf8");
      const res = Readable.from([body]);
      cb(asIncoming(res, { "content-type": "application/json" }));
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
    const c = createHttpSmartClient({ baseUrl, onRequest, serializer: EJSON });
    const out = await c.task("x", { v: 1 } as any);
    expect(out).toBe(1);
    expect(onRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: expect.any(String),
        headers: expect.any(Object),
      }),
    );
  });

  it("multipart: detects File sentinel and returns JSON result", async () => {
    const spy = jest
      .spyOn(http, "request")
      .mockImplementation((opts: any, cb: any) => {
        const env = { ok: true, result: "OK" };
        const body = Buffer.from(getDefaultSerializer().stringify(env), "utf8");
        const res = Readable.from([body]);
        const im = asIncoming(res, { "content-type": "application/json" });
        cb(im);
        const sink = new Writable({
          write(_chunk, _enc, next) {
            next();
          },
          final(cb2) {
            cb2();
          },
        }) as any;
        sink.on = (_: any, __: any) => sink;
        sink.setTimeout = () => sink;
        sink.destroy = () => undefined;
        return sink;
      }) as any;

    const input = {
      file: createNodeFile(
        { name: "a.txt" },
        { stream: Readable.from("abc") },
        "F1",
      ),
    } as const;
    const out = await client.task("upload", input as any);
    expect(out).toBe("OK");
    expect(spy).toHaveBeenCalled();
  });

  it("multipart (buffer): covers buffer branch in encoder", async () => {
    const spy = jest
      .spyOn(http, "request")
      .mockImplementation((opts: any, cb: any) => {
        const env = { ok: true, result: "BUF" };
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

    const input = {
      file: createNodeFile(
        { name: "a.bin", type: "application/octet-stream" },
        { buffer: Buffer.from([1, 2, 3]) },
        "F2",
      ),
    } as const;
    const out = await client.task("upload", input as any);
    expect(out).toBe("BUF");
    expect(spy).toHaveBeenCalled();
  });

  it("multipart (streaming response): returns Readable when server streams", async () => {
    const spy = jest
      .spyOn(http, "request")
      .mockImplementation((opts: any, cb: any) => {
        const res = new Readable({
          read() {
            this.push(Buffer.from("STREAM", "utf8"));
            this.push(null);
          },
        });
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

    const input = {
      file: createNodeFile(
        { name: "a.txt" },
        { stream: Readable.from("x") },
        "F3",
      ),
    } as const;
    const out = (await client.task("upload", input as any)) as Readable;
    const buf = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      out.on("data", (c: any) =>
        chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))),
      );
      out.on("end", () =>
        resolve(Buffer.concat(chunks as readonly Uint8Array[])),
      );
      out.on("error", reject);
    });
    expect(buf.toString("utf8")).toBe("STREAM");
    expect(spy).toHaveBeenCalled();
  });

  it("parseMaybeJsonResponse error path: rejects when JSON parsing fails", async () => {
    jest.spyOn(http, "request").mockImplementation((opts: any, cb: any) => {
      const res = Readable.from([Buffer.from("not-json", "utf8")]);
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

    const input = {
      file: createNodeFile(
        { name: "a.txt" },
        { stream: Readable.from("x") },
        "F4",
      ),
    } as const;
    await expect(client.task("upload", input as any)).rejects.toBeTruthy();
  });

  it("event(): posts JSON envelope and validates ok", async () => {
    const spy = jest
      .spyOn(http, "request")
      .mockImplementation((opts: any, cb: any) => {
        const env = { ok: true, result: undefined };
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
    await client.event("evt", { p: 1 });
    expect(spy).toHaveBeenCalled();
  });

  it("uses https.request when baseUrl is https and includes auth header", async () => {
    const httpsReqSpy = jest
      .spyOn(require("https"), "request")
      .mockImplementation((opts: any, cb: any) => {
        const env = { ok: true, result: 7 };
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
        // verify header passed
        expect(String((opts.headers || {})["x-token"])).toBe("secret");
        return sink;
      }) as any;
    const c = createHttpSmartClient({
      baseUrl: "https://127.0.0.1/__runner",
      auth: { header: "x-token", token: "secret" },
      serializer: EJSON,
    });
    const out = await c.task("sum", { a: 3, b: 4 } as any);
    expect(out).toBe(7);
    expect(httpsReqSpy).toHaveBeenCalled();
  });

  it("parseMaybeJsonResponse: rejects when response emits error", async () => {
    jest.spyOn(http, "request").mockImplementation((opts: any, cb: any) => {
      const res = new Readable({
        read() {
          /* no data */
        },
      });
      const im = asIncoming(res, { "content-type": "application/json" });
      // Defer emit to next tick so Promise wiring is in place
      process.nextTick(() => {
        (im as any).emit("error", new Error("bad"));
      });
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
    const input = {
      file: createNodeFile({ name: "x" }, { stream: Readable.from("x") }, "F5"),
    } as const;
    await expect(client.task("upload", input as any)).rejects.toBeTruthy();
  });

  it("createHttpSmartClient throws on empty baseUrl", () => {
    expect(() =>
      createHttpSmartClient({ baseUrl: "" as any, serializer: EJSON } as any),
    ).toThrow();
  });
  it("octet-stream: when input is Readable, returns response stream", async () => {
    const spy = jest
      .spyOn(http, "request")
      .mockImplementation((opts: any, cb: any) => {
        const res = new Readable({
          read() {
            this.push(Buffer.from("HELLO", "utf8"));
            this.push(null);
          },
        });
        const im = asIncoming(res, {});
        cb(im);
        const sink = new Writable({
          write(_chunk, _enc, next) {
            next();
          },
          final(cb2) {
            cb2();
          },
        }) as any;
        sink.on = (_: any, __: any) => sink;
        sink.setTimeout = () => sink;
        sink.destroy = () => undefined;
        return sink;
      }) as any;

    const input = Readable.from("ignored");
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
    expect(Buffer.concat(chunks).toString("utf8")).toBe("HELLO");
    expect(spy).toHaveBeenCalled();
  });

  it("octet-stream: propagates request error (req.on('error'))", async () => {
    jest.spyOn(http, "request").mockImplementation((_opts: any, _cb: any) => {
      const sink = new Writable({
        write(_c, _e, n) {
          n();
        },
        final(n) {
          n();
        },
      }) as any;
      // minimal EventEmitter API
      sink.on = (event: string, handler: any) => {
        if (event === "error") setImmediate(() => handler(new Error("boom")));
        return sink;
      };
      sink.setTimeout = () => sink;
      sink.destroy = () => undefined;
      return sink;
    }) as any;
    const input = Readable.from("ignored");
    await expect(client.task("duplex", input)).rejects.toBeTruthy();
  });

  it("onRequest is invoked for multipart and octet-stream", async () => {
    const onRequest = jest.fn();
    // multipart path
    jest.spyOn(http, "request").mockImplementationOnce((opts: any, cb: any) => {
      const env = { ok: true, result: "OK" };
      const body = Buffer.from(getDefaultSerializer().stringify(env), "utf8");
      const res = Readable.from([body]);
      cb(asIncoming(res, { "content-type": "application/json" }));
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
    const c = createHttpSmartClient({ baseUrl, onRequest, serializer: EJSON });
    await c.task("upload", {
      file: createNodeFile({ name: "x" }, { stream: Readable.from("x") }, "Fz"),
    } as any);

    // octet-stream path
    jest.spyOn(http, "request").mockImplementationOnce((opts: any, cb: any) => {
      const res = Readable.from([Buffer.from("x")]);
      cb(asIncoming(res, {}));
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
    await c.task("duplex", Readable.from("x"));
    expect(onRequest).toHaveBeenCalledTimes(2);
  });
});
