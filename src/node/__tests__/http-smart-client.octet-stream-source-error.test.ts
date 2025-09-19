import * as http from "http";
import { Readable, Writable } from "stream";
import { createHttpSmartClient } from "../http-smart-client.node";

describe("createHttpSmartClient - octet-stream source error", () => {
  const baseUrl = "http://127.0.0.1:7777/__runner";

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("propagates source stream error via req.destroy() → promise rejects", async () => {
    // Use a real Writable so Readable.pipe(req) works and unpipe is supported
    const req: any = new Writable({ write(_c,_e,n){ n(); } });
    req.setTimeout = () => req;

    // http.request mock wires callback with a dummy IncomingMessage and returns req
    jest.spyOn(http, "request").mockImplementation((opts: any, cb: any) => {
      // supply a trivial IncomingMessage so code can attach listeners if needed
      const res = new Readable({ read() {} });
      (res as any).headers = { "content-type": "application/octet-stream" };
      setImmediate(() => cb(res as any));
      return req;
    }) as any;

    const client = createHttpSmartClient({ baseUrl });
    const src = new Readable({ read() {} });
    const p = client.task("duplex", src as any);
    // Trigger the source error which should call req.destroy(err) and reject the promise
    setImmediate(() => src.emit("error", new Error("boom")));
    await expect(p).rejects.toBeTruthy();
  });
});
