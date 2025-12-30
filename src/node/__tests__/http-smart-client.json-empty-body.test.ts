import * as http from "http";
import { Readable, Writable } from "stream";
import { createHttpSmartClient } from "../http-smart-client.model";
import { EJSON, getDefaultSerializer } from "../../globals/resources/tunnel/serializer";

function asIncoming(
  res: Readable,
  headers: Record<string, string>,
): http.IncomingMessage {
  (res as any).headers = headers;
  return res as any as http.IncomingMessage;
}

describe("createHttpSmartClient - JSON empty body path", () => {
  const baseUrl = "http://127.0.0.1:4444/__runner";

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("JSON fallback with empty body triggers default error", async () => {
    jest.spyOn(http, "request").mockImplementation((_opts: any, cb: any) => {
      // Respond with no data at all
      const res = new Readable({
        read() {
          this.push(null);
        },
      });
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

    const client = createHttpSmartClient({ baseUrl, serializer: getDefaultSerializer() });
    await expect(client.task("x", { a: 1 } as any)).rejects.toThrow(
      /Tunnel task error/,
    );
  });
});
