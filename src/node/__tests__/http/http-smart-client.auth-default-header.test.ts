import * as http from "http";
import { Readable, Writable } from "stream";
import { createHttpSmartClient } from "../../http/http-smart-client.model";
import { getDefaultSerializer } from "../../../serializer";

function asIncoming(
  res: Readable,
  headers: Record<string, string>,
): http.IncomingMessage {
  (res as any).headers = headers;
  return res as any as http.IncomingMessage;
}

describe("createHttpSmartClient - auth default header", () => {
  const baseUrl = "http://127.0.0.1:5555/__runner";
  const serializer = getDefaultSerializer();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("sets x-runner-token when auth.token provided without custom header", async () => {
    const reqSpy = jest
      .spyOn(http, "request")
      .mockImplementation((opts: any, cb: any) => {
        const env = { ok: true, result: 1 };
        const res = Readable.from([
          Buffer.from(serializer.stringify(env), "utf8"),
        ]);
        cb(asIncoming(res, { "content-type": "application/json" }));
        // Ensure header is set with default name, lower-cased
        expect((opts.headers || {})["x-runner-token"]).toBe("secret");
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
      auth: { token: "secret" },
      serializer,
    });
    const out = await client.task("json", { a: 1 } as any);
    expect(out).toBe(1);
    expect(reqSpy).toHaveBeenCalled();
  });
});
