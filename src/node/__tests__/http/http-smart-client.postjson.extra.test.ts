import * as http from "http";
import { Readable, Writable } from "stream";
import { createHttpSmartClient } from "../../http/http-smart-client.model";
import { getDefaultSerializer } from "../../../serializer";
import { createNodeFile } from "../../files";

function asIncoming(
  res: Readable,
  headers: Record<string, string>,
): http.IncomingMessage {
  (res as any).headers = headers;
  return res as any as http.IncomingMessage;
}

describe("createHttpSmartClient - postJson extra coverage", () => {
  const baseUrl = "http://127.0.0.1:9999/__runner";

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("event(): aggregates mixed string+buffer chunks as JSON", async () => {
    jest.spyOn(http, "request").mockImplementation((opts: any, cb: any) => {
      const payload = getDefaultSerializer().stringify({
        ok: true,
        result: undefined,
      });
      const res = new Readable({
        read() {
          // mix string and Buffer chunks
          this.push(payload.slice(0, 5));
          this.push(Buffer.from(payload.slice(5), "utf8"));
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
    const client = createHttpSmartClient({
      baseUrl,
      serializer: getDefaultSerializer(),
    });
    await expect(client.event("evt", { a: 1 } as any)).resolves.toBeUndefined();
  });

  it("multipart: parseMaybeJsonResponse aggregates mixed chunks", async () => {
    jest.spyOn(http, "request").mockImplementation((opts: any, cb: any) => {
      const env = { ok: true, result: 123 };
      const text = getDefaultSerializer().stringify(env);
      const res = new Readable({
        read() {
          // emit Buffer then string
          this.push(Buffer.from(text.slice(0, 3), "utf8"));
          this.push(text.slice(3));
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
    const client = createHttpSmartClient({
      baseUrl,
      serializer: getDefaultSerializer(),
    });
    const out = await client.task("upload", {
      file: createNodeFile({ name: "x" }, { buffer: Buffer.from([1]) }, "FX"),
    } as any);
    expect(out).toBe(123);
  });

  it("adds x-runner-context header when contexts provided (JSON path)", async () => {
    const captured: any[] = [];
    jest.spyOn(http, "request").mockImplementation((opts: any, cb: any) => {
      // Capture headers for assertion
      captured.push(opts.headers);
      const payload = getDefaultSerializer().stringify({
        ok: true,
        result: 42,
      });
      const res = new Readable({
        read() {
          this.push(payload);
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

    const contexts = [
      {
        id: "ctx.demo",
        use: () => ({ k: 1 }),
        serialize: (v: any) => JSON.stringify(v),
        parse: (s: string) => JSON.parse(s),
        provide: (v: any, fn: any) => fn(),
        require: () => ({}) as any,
      },
    ];
    const client = createHttpSmartClient({
      baseUrl,
      serializer: getDefaultSerializer(),
      contexts: contexts as any,
    });
    const out = await client.task("t.json", { a: 1 } as any);
    expect(out).toBe(42);
    const hdrs = captured[0] as Record<string, string>;
    expect(typeof hdrs["x-runner-context"]).toBe("string");
    const map = getDefaultSerializer().parse<Record<string, string>>(
      hdrs["x-runner-context"],
    );
    expect(JSON.parse(map["ctx.demo"]).k).toBe(1);
  });
});
