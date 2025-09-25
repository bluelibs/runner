import * as http from "http";
import { Readable, Writable } from "stream";
import { createHttpSmartClient } from "../http-smart-client.model";
import { EJSON } from "../../globals/resources/tunnel/serializer";

describe("createHttpSmartClient - octet-stream source error", () => {
  const baseUrl = "http://127.0.0.1:7777/__runner";

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("propagates source stream error via req.destroy() → promise rejects", async () => {
    // Use a real Writable so Readable.pipe(req) works and unpipe is supported
    const req: any = new Writable({
      write(_c, _e, n) {
        n();
      },
    });
    req.setTimeout = () => req;

    // http.request mock wires callback with a dummy IncomingMessage and returns req
    jest.spyOn(http, "request").mockImplementation((opts: any, cb: any) => {
      // supply a trivial IncomingMessage so code can attach listeners if needed
      const res = new Readable({ read() {} });
      (res as any).headers = { "content-type": "application/octet-stream" };
      setImmediate(() => cb(res as any));
      return req;
    }) as any;

    const client = createHttpSmartClient({ baseUrl, serializer: EJSON });
    const src = new Readable({ read() {} });
    const p = client.task("duplex", src as any);
    // Trigger the source error which should call req.destroy(err) and reject the promise
    setImmediate(() => src.emit("error", new Error("boom")));
    await expect(p).rejects.toBeTruthy();
  });

  it("adds x-runner-context header for octet-stream when contexts are provided", async () => {
    const captured: any[] = [];
    jest.spyOn(http, "request").mockImplementation((opts: any, cb: any) => {
      captured.push(opts.headers);
      const res = new Readable({ read() {} });
      (res as any).headers = { "content-type": "application/octet-stream" };
      setImmediate(() => cb(res as any));
      // Writable sink
      const sink: any = new (require("stream").Writable)({
        write(_c: any, _e: any, n: any) {
          n();
        },
      });
      sink.setTimeout = () => sink;
      sink.on = (_: any, __: any) => sink;
      sink.destroy = () => undefined;
      return sink;
    }) as any;

    const contexts = [
      {
        id: "ctx.os",
        use: () => ({ z: 9 }),
        serialize: (v: any) => JSON.stringify(v),
        parse: (s: string) => JSON.parse(s),
        provide: (v: any, fn: any) => fn(),
        require: () => ({} as any),
      },
    ];
    const client = createHttpSmartClient({
      baseUrl,
      serializer: EJSON,
      contexts: contexts as any,
    });
    const src = new Readable({ read() { this.push(null); } });
    const out = await client.task("duplex.ctx", src as any);
    expect(out).toBeDefined();
    const hdrs = captured[0] as Record<string, string>;
    expect(typeof hdrs["x-runner-context"]).toBe("string");
  });
});
