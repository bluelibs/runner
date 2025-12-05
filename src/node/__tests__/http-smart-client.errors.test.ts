import * as http from "http";
import { Readable, Writable } from "stream";
import { createHttpSmartClient } from "../http-smart-client.model";
import { createHttpMixedClient } from "../http-mixed-client";
import { getDefaultSerializer } from "../../globals/resources/tunnel/serializer";
import { createNodeFile } from "../files";

function asIncoming(
  res: Readable,
  headers: Record<string, string>,
): http.IncomingMessage {
  (res as any).headers = headers;
  return res as any as http.IncomingMessage;
}

function makeSink(): any {
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
}

describe("http smart/mixed client typed errors", () => {
  const baseUrl = "http://127.0.0.1:3333/__runner";
  const serializer = getDefaultSerializer();
  const helper = {
    id: "tests.errors.node",
    throw: (data: any) => {
      throw new Error("typed:" + String(data?.code));
    },
    is: () => false,
    toString: () => "",
  } as any;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rethrows typed app error via errorRegistry on JSON path", async () => {
    const reqSpy = jest
      .spyOn(http, "request")
      .mockImplementation((opts: any, cb: any) => {
        const env = {
          ok: false,
          error: {
            code: "INTERNAL_ERROR",
            message: "boom",
            id: helper.id,
            data: { code: 7 },
          },
        };
        const body = serializer.stringify(env);
        const res = Readable.from([body]);
        cb(asIncoming(res, { "content-type": "application/json" }));
        return makeSink();
      }) as any;

    const client = createHttpSmartClient({
      baseUrl,
      serializer,
      errorRegistry: new Map([[helper.id, helper]]),
    });

    await expect(client.task("t.json", { a: 1 } as any)).rejects.toThrow(
      /typed:7/,
    );
    expect(reqSpy).toHaveBeenCalled();
  });

  it("rethrows typed app error via errorRegistry on smart path (mixed client)", async () => {
    const reqSpy = jest
      .spyOn(http, "request")
      .mockImplementation((opts: any, cb: any) => {
        const env = {
          ok: false,
          error: {
            code: "INTERNAL_ERROR",
            message: "boom",
            id: helper.id,
            data: { code: 11 },
          },
        };
        const body = serializer.stringify(env);
        const res = Readable.from([body]);
        cb(asIncoming(res, { "content-type": "application/json" }));
        return makeSink();
      }) as any;

    const client = createHttpMixedClient({
      baseUrl,
      serializer,
      errorRegistry: new Map([[helper.id, helper]]),
    });
    const file = createNodeFile(
      { name: "a.bin" },
      { buffer: Buffer.from("x") },
      "ERRF",
    );

    await expect(client.task("upload", { file } as any)).rejects.toThrow(
      /typed:11/,
    );
    expect(reqSpy).toHaveBeenCalled();
  });

  it("rethrows typed app error via errorRegistry on event path", async () => {
    const reqSpy = jest
      .spyOn(http, "request")
      .mockImplementation((opts: any, cb: any) => {
        const env = {
          ok: false,
          error: {
            code: "INTERNAL_ERROR",
            message: "boom",
            id: helper.id,
            data: { code: 21 },
          },
        };
        const body = serializer.stringify(env);
        const res = Readable.from([body]);
        cb(asIncoming(res, { "content-type": "application/json" }));
        return makeSink();
      }) as any;

    const client = createHttpSmartClient({
      baseUrl,
      serializer,
      errorRegistry: new Map([[helper.id, helper]]),
    });

    await expect(client.event("ev", { n: 1 } as any)).rejects.toThrow(
      /typed:21/,
    );
    expect(reqSpy).toHaveBeenCalled();
  });
});
