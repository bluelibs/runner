import * as http from "http";
import { Readable, Writable } from "stream";
import { createHttpSmartClient } from "../../http/http-smart-client.model";
import { RemoteLaneTransportError } from "../../../remote-lanes/http/protocol";
import { Serializer } from "../../../serializer";
import { createNodeFile } from "../../files";

function connectionRefused(): Error {
  return Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:80"), {
    code: "ECONNREFUSED",
  });
}

function failingSink(error: unknown): Writable {
  const sink = new Writable({
    write(_chunk, _encoding, next) {
      next();
    },
    final(next) {
      next();
    },
  });
  setImmediate(() => sink.emit("error", error));
  return sink;
}

describe("createHttpSmartClient - network errors", () => {
  const baseUrl = "http://127.0.0.1:6666/__runner";
  const serializer = new Serializer();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("JSON path wraps request errors as NETWORK_ERRORs", async () => {
    const failure = connectionRefused();
    jest.spyOn(http, "request").mockImplementation((_opts: any, _cb: any) => {
      return failingSink(failure) as any;
    }) as any;

    const client = createHttpSmartClient({ baseUrl, serializer });
    const signal = new AbortController().signal;
    try {
      await client.task("t.json", { a: 1 } as any, { signal });
      fail("should reject");
    } catch (error) {
      expect(error).toBeInstanceOf(RemoteLaneTransportError);
      expect(error).toMatchObject({
        code: "NETWORK_ERROR",
        message: expect.stringContaining("ECONNREFUSED"),
      });
      expect(
        (error as RemoteLaneTransportError).details as { cause: unknown },
      ).toEqual({ cause: failure });
    }
  });

  it("JSON path wraps response stream errors as NETWORK_ERRORs", async () => {
    jest.spyOn(http, "request").mockImplementation((_opts: any, cb: any) => {
      const res = new Readable({ read() {} });
      (res as any).headers = { "content-type": "application/json" };
      (res as any).statusCode = 200;
      cb(res as any as http.IncomingMessage);
      setImmediate(() => res.emit("error", new Error("response-broke")));
      return new Writable({
        write(_chunk, _encoding, next) {
          next();
        },
      }) as any;
    }) as any;

    const client = createHttpSmartClient({ baseUrl, serializer });
    const signal = new AbortController().signal;
    await expect(
      client.event("ev.id", { a: 1 } as any, { signal }),
    ).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      message: expect.stringContaining("response-broke"),
    });
  });

  it("multipart path wraps request errors as NETWORK_ERRORs", async () => {
    jest.spyOn(http, "request").mockImplementation((_opts: any, _cb: any) => {
      return failingSink(connectionRefused()) as any;
    }) as any;

    const client = createHttpSmartClient({ baseUrl, serializer });
    const input = {
      file: createNodeFile(
        { name: "x.bin" },
        { buffer: Buffer.from([1]) },
        "F1",
      ),
    };
    const signal = new AbortController().signal;
    await expect(
      client.task("t.upload", input as any, { signal }),
    ).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
  });

  it("octet path wraps request errors as NETWORK_ERRORs", async () => {
    jest.spyOn(http, "request").mockImplementation((_opts: any, _cb: any) => {
      return failingSink(connectionRefused()) as any;
    }) as any;

    const client = createHttpSmartClient({ baseUrl, serializer });
    const signal = new AbortController().signal;
    await expect(
      client.task("t.duplex", Readable.from([Buffer.from("abc")]), { signal }),
    ).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
  });
});
