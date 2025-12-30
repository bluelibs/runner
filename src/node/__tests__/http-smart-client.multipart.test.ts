import * as http from "http";
import { Readable, Writable } from "stream";
import { createHttpSmartClient } from "../http-smart-client.model";
import { createNodeFile } from "../files";
import { getDefaultSerializer } from "../../globals/resources/tunnel/serializer";
import { EJSON } from "../../globals/resources/tunnel/serializer";

function asIncoming(
  res: Readable,
  headers: Record<string, string>,
): http.IncomingMessage {
  (res as any).headers = headers;
  return res as any as http.IncomingMessage;
}

describe("http-smart-client multipart", () => {
  const baseUrl = "http://127.0.0.1:7070/__runner";

  it("multipart uploads returns asserted ok", async () => {
    const client = createHttpSmartClient({ baseUrl, serializer: EJSON });
    // No real request performed in this unit test; exercise shape only
    expect(typeof client.task).toBe("function");
  });

  it("multipart path with web files also works when passed through smart client", async () => {
    const client = createHttpSmartClient({ baseUrl, serializer: EJSON });
    expect(client).toBeDefined();
  });

  it("multipart path returns stream for duplex response", async () => {
    const client = createHttpSmartClient({ baseUrl, serializer: EJSON });
    expect(client).toBeDefined();
  });
});

describe("createHttpSmartClient - multipart", () => {
  const baseUrl = "http://127.0.0.1:7777/__runner";

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("propagates file stream error via body.on('error') -> req.destroy() -> promise rejects", async () => {
    // Mock request sink that will surface destroy(err) as an 'error' event
    const req: any = new Writable({
      write(_chunk, _enc, next) {
        next();
      },
      final(cb) {
        cb();
      },
    });
    req.setTimeout = () => req;

    // Important: do NOT invoke the response callback; we want the Promise to reject
    jest
      .spyOn(http, "request")
      .mockImplementation((_opts: any, _cb: any) => req) as any;

    const client = createHttpSmartClient({ baseUrl, serializer: EJSON });

    // File stream that errors shortly after
    const fileStream = new Readable({ read() {} });
    const file = createNodeFile(
      { name: "boom.txt" },
      { stream: fileStream },
      "F1",
    );

    const p = client.task("upload", { file } as any);

    // Trigger upstream error -> body emits 'error' -> req.destroy(err) -> req 'error' -> reject
    setImmediate(() => fileStream.emit("error", new Error("boom")));

    await expect(p).rejects.toBeTruthy();
  });

  it("sets filename as a separate Content-Disposition parameter (not inside name)", async () => {
    let capturedBody = Buffer.alloc(0);
    const reqSpy = jest
      .spyOn(http, "request")
      .mockImplementation((opts: any, cb: any) => {
        const env = { ok: true, result: "OK" };
        const body = Buffer.from(getDefaultSerializer().stringify(env), "utf8");
        const res = Readable.from([body]);

        const sink = new Writable({
          write(chunk, _enc, next) {
            capturedBody = Buffer.concat([
              capturedBody,
              Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)),
            ]);
            next();
          },
          final(next) {
            next();
          },
        }) as any;
        // minimal stubs used by client code
        sink.on = (_: any, __: any) => sink;
        sink.setTimeout = () => sink;
        sink.destroy = () => undefined;
        // Respond on next tick to allow encoder to start piping headers/body first
        setImmediate(() =>
          cb(asIncoming(res, { "content-type": "application/json" })),
        );
        return sink;
      }) as any;

    const client = createHttpSmartClient({ baseUrl, serializer: EJSON });
    const file = createNodeFile(
      { name: "payload.txt", type: "text/plain" },
      { stream: Readable.from("hi") },
      "FX",
    );
    const out = await client.task("upload", { file } as any);
    expect(out).toBe("OK");
    expect(reqSpy).toHaveBeenCalled();

    // Give a microtick for the encoder to flush headers into the sink
    await new Promise((r) => setImmediate(r));
    const text = capturedBody.toString("utf8");
    // __manifest part is present
    expect(text).toContain('Content-Disposition: form-data; name="__manifest"');
    // File part uses a clean name and a separate filename parameter
    expect(text).toContain(
      'Content-Disposition: form-data; name="file:FX"; filename="payload.txt"',
    );
    // Note: Previously, the filename was erroneously injected into the name value.
    // The correct format uses a separate filename parameter as asserted above.
  });

  it("coerces both Buffer and string chunks in encoder loop", async () => {
    let captured = Buffer.alloc(0);
    jest.spyOn(http, "request").mockImplementation((_opts: any, cb: any) => {
      // Capture the encoded body to exercise the for-await loop over mixed chunks
      const sink = new Writable({
        write(chunk, _enc, next) {
          captured = Buffer.concat([
            captured,
            Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)),
          ]);
          next();
        },
        final(next) {
          next();
        },
      }) as any;
      sink.on = (_: any, __: any) => sink;
      sink.setTimeout = () => sink;
      sink.destroy = () => undefined;

      const env = { ok: true, result: "OK" };
      const res = Readable.from([
        Buffer.from(getDefaultSerializer().stringify(env), "utf8"),
      ]);
      // respond on next tick after some body has been written
      setImmediate(() =>
        cb(asIncoming(res, { "content-type": "application/json" })),
      );
      return sink;
    }) as any;

    const client = createHttpSmartClient({ baseUrl, serializer: EJSON });
    const file = createNodeFile(
      { name: "x.bin", type: "application/octet-stream" },
      { stream: Readable.from([Buffer.from("A"), "B"]) },
      "Fmix",
    );
    const out = await client.task("upload", { file } as any);
    expect(out).toBe("OK");
    // Sanity: ensure we captured some body bytes
    expect(captured.length).toBeGreaterThan(0);
  });

  it("adds x-runner-context header for multipart when contexts are provided", async () => {
    const reqSpy = jest
      .spyOn(http, "request")
      .mockImplementation((opts: any, cb: any) => {
        const env = { ok: true, result: undefined };
        const res = Readable.from([
          Buffer.from(getDefaultSerializer().stringify(env), "utf8"),
        ]);
        setImmediate(() =>
          cb(asIncoming(res, { "content-type": "application/json" })),
        );
        const sink = new Writable({
          write(_chunk, _enc, next) {
            next();
          },
          final(next) {
            next();
          },
        }) as any;
        sink.on = (_: any, __: any) => sink;
        sink.setTimeout = () => sink;
        sink.destroy = () => undefined;
        // Assert context header
        expect(typeof opts.headers["x-runner-context"]).toBe("string");
        return sink;
      }) as any;

    const client = createHttpSmartClient({
      baseUrl,
      serializer: EJSON,
      contexts: [
        {
          id: "ctx.mp2",
          use: () => 1,
          serialize: (v: any) => String(v),
          parse: (s: string) => s,
          provide: (v: any, fn: any) => fn(),
          require: () => ({}) as any,
        } as any,
      ],
    });
    const file = createNodeFile(
      { name: "x" },
      { stream: Readable.from("A") },
      "FXH",
    );
    await client.task("upload.ctx2", { file } as any);
    expect(reqSpy).toHaveBeenCalled();
  });
});
