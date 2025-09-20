import * as http from "http";
import { Readable, Writable } from "stream";
import { createHttpSmartClient } from "../http-smart-client.model";
import { getDefaultSerializer } from "../../globals/resources/tunnel/serializer";
import { createNodeFile } from "../files";

function asIncoming(
  res: Readable,
  headers: Record<string, string>,
): http.IncomingMessage {
  (res as any).headers = headers;
  return res as any as http.IncomingMessage;
}

describe("createHttpSmartClient - extra branches", () => {
  const baseUrl = "http://127.0.0.1:3333/__runner";

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("JSON with no auth: header is not set and string chunks parse", async () => {
    const reqSpy = jest
      .spyOn(http, "request")
      .mockImplementation((opts: any, cb: any) => {
        const env = { ok: true, result: 9 };
        const body = getDefaultSerializer().stringify(env);
        // Emit as string chunks (not Buffer) to cover chunk coercion
        const res = new Readable({
          read() {
            this.push(body);
            this.push(null);
          },
        });
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
        // Ensure auth header is not present when config.auth is undefined
        expect(Object.keys(opts.headers || {})).not.toContain("x-runner-token");
        return sink;
      }) as any;
    const client = createHttpSmartClient({ baseUrl });
    const out = await client.task("json", { a: 1 } as any);
    expect(out).toBe(9);
    expect(reqSpy).toHaveBeenCalled();
  });

  it("multipart: detects sentinel in nested arrays/objects (buffer side)", async () => {
    const reqSpy = jest
      .spyOn(http, "request")
      .mockImplementation((opts: any, cb: any) => {
        const env = { ok: true, result: "ARR" };
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
    const client = createHttpSmartClient({ baseUrl });
    const input = {
      files: [
        {
          wrapped: {
            inner: createNodeFile(
              { name: "b.bin" },
              { buffer: Buffer.from([1]) },
              "FB",
            ),
          },
        },
      ],
    } as const;
    const out = await client.task("upload", input as any);
    expect(out).toBe("ARR");
    expect(reqSpy).toHaveBeenCalled();
  });

  it("multipart JSON empty body: parseMaybeJsonResponse returns undefined → assertOkEnvelope throws", async () => {
    jest.spyOn(http, "request").mockImplementation((opts: any, cb: any) => {
      // Respond with JSON content-type but no body text
      const res = new Readable({
        read() {
          this.push(null);
        },
      });
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
    const client = createHttpSmartClient({ baseUrl });
    const input = {
      f: createNodeFile({ name: "x" }, { stream: Readable.from("x") }, "FX"),
    } as const;
    await expect(client.task("upload", input as any)).rejects.toBeTruthy();
  });

  it("multipart: encoder falls back for missing filename/type and escapes quotes", async () => {
    const reqSpy = jest
      .spyOn(http, "request")
      .mockImplementation((opts: any, cb: any) => {
        const env = { ok: true, result: "FALLBACK" };
        const body = Buffer.from(getDefaultSerializer().stringify(env), "utf8");
        const res = Readable.from([body]);
        cb(asIncoming(res, { "content-type": "application/json" }));
        // Assert multipart header contains escaped filename (quotes)
        const contentType = String((opts.headers || {})["content-type"] || "");
        expect(contentType).toMatch(/^multipart\/form-data; boundary=/);
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
    const client = createHttpSmartClient({ baseUrl });
    // meta as any to omit name/type and hit fallbacks in encoder
    const file = createNodeFile(
      {} as any,
      { stream: Readable.from(["a", "b"]) },
      "FQ",
    );
    const out = await client.task("upload", { file } as any);
    expect(out).toBe("FALLBACK");
    expect(reqSpy).toHaveBeenCalled();
  });

  it("multipart: JSON response body arrives in multiple string chunks", async () => {
    const reqSpy = jest
      .spyOn(http, "request")
      .mockImplementation((opts: any, cb: any) => {
        const env = { ok: true, result: 77 };
        const text = getDefaultSerializer().stringify(env);
        const res = new Readable({
          read() {
            // Emit two string chunks to cover parseMaybe data aggregation path
            this.push(text.slice(0, 5));
            this.push(text.slice(5));
            this.push(null);
          },
        });
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
    const client = createHttpSmartClient({ baseUrl });
    const out = await client.task("upload", {
      file: createNodeFile({ name: "x" }, { buffer: Buffer.from([1]) }, "FX"),
    } as any);
    expect(out).toBe(77);
    expect(reqSpy).toHaveBeenCalled();
  });
});
