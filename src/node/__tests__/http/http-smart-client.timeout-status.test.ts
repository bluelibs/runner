import * as http from "http";
import { Readable, Writable } from "stream";
import { createHttpSmartClient } from "../../http/http-smart-client.model";
import { Serializer } from "../../../serializer";
import { createNodeFile } from "../../files";

function asIncoming(
  res: Readable,
  headers: Record<string, string>,
  statusCode?: number,
  statusMessage?: string,
): http.IncomingMessage {
  (res as any).headers = headers;
  (res as any).statusCode = statusCode;
  (res as any).statusMessage = statusMessage;
  return res as any as http.IncomingMessage;
}

function makeSink(): Writable {
  return new Writable({
    write(_chunk, _encoding, next) {
      next();
    },
    final(next) {
      next();
    },
  });
}

function makeTimeoutSink(): Writable {
  const sink = makeSink() as Writable & {
    destroy: (error?: Error) => Writable;
  };
  sink.destroy = (error?: Error) => {
    if (error) {
      setImmediate(() => sink.emit("error", error));
    }
    return sink;
  };
  return sink;
}

describe("createHttpSmartClient - timeout and status handling", () => {
  const baseUrl = "http://127.0.0.1:2222/__runner";
  const serializer = new Serializer();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("JSON path rejects with REQUEST_TIMEOUT", async () => {
    jest.spyOn(http, "request").mockImplementation((_opts: any, _cb: any) => {
      const sink = makeTimeoutSink();
      setImmediate(() => sink.emit("timeout"));
      return sink as any;
    }) as any;

    const client = createHttpSmartClient({ baseUrl, serializer, timeoutMs: 5 });
    await expect(client.task("t.json", { a: 1 } as any)).rejects.toMatchObject({
      code: "REQUEST_TIMEOUT",
      httpCode: 408,
    });
  });

  it("JSON path timeout also works when timeoutMs is not configured", async () => {
    jest.spyOn(http, "request").mockImplementation((_opts: any, _cb: any) => {
      const sink = makeTimeoutSink();
      setImmediate(() => sink.emit("timeout"));
      return sink as any;
    }) as any;

    const client = createHttpSmartClient({ baseUrl, serializer });
    await expect(client.task("t.json", { a: 1 } as any)).rejects.toMatchObject({
      code: "REQUEST_TIMEOUT",
      httpCode: 408,
    });
  });

  it("multipart path rejects with REQUEST_TIMEOUT", async () => {
    jest.spyOn(http, "request").mockImplementation((_opts: any, _cb: any) => {
      const sink = makeTimeoutSink();
      setImmediate(() => sink.emit("timeout"));
      return sink as any;
    }) as any;

    const client = createHttpSmartClient({ baseUrl, serializer, timeoutMs: 5 });
    const input = {
      file: createNodeFile(
        { name: "a.bin" },
        { buffer: Buffer.from([1]) },
        "F1",
      ),
    };
    await expect(client.task("t.upload", input as any)).rejects.toMatchObject({
      code: "REQUEST_TIMEOUT",
      httpCode: 408,
    });
  });

  it("octet path rejects with REQUEST_TIMEOUT", async () => {
    jest.spyOn(http, "request").mockImplementation((_opts: any, _cb: any) => {
      const sink = makeTimeoutSink();
      setImmediate(() => sink.emit("timeout"));
      return sink as any;
    }) as any;

    const client = createHttpSmartClient({ baseUrl, serializer, timeoutMs: 5 });
    await expect(
      client.task("t.duplex", Readable.from([Buffer.from("abc")])),
    ).rejects.toMatchObject({
      code: "REQUEST_TIMEOUT",
      httpCode: 408,
    });
  });

  it("JSON path handles response stream errors", async () => {
    jest.spyOn(http, "request").mockImplementation((_opts: any, cb: any) => {
      const res = new Readable({ read() {} });
      const incoming = asIncoming(
        res,
        { "content-type": "application/json" },
        200,
      );
      cb(incoming);
      setImmediate(() => incoming.emit("error", new Error("response-broke")));
      return makeSink() as any;
    }) as any;

    const client = createHttpSmartClient({ baseUrl, serializer });
    await expect(client.event("ev.id", { a: 1 } as any)).rejects.toThrow(
      /response-broke/,
    );
  });

  it("JSON path converts malformed 502 JSON into HTTP_ERROR", async () => {
    jest.spyOn(http, "request").mockImplementation((_opts: any, cb: any) => {
      const res = Readable.from(["<html>bad gateway</html>"]);
      cb(
        asIncoming(
          res,
          { "content-type": "application/json" },
          502,
          "Bad Gateway",
        ),
      );
      return makeSink() as any;
    }) as any;

    const client = createHttpSmartClient({ baseUrl, serializer });
    await expect(client.task("t.json", { a: 1 } as any)).rejects.toMatchObject({
      code: "HTTP_ERROR",
      httpCode: 502,
    });
  });

  it("JSON path converts empty 500 responses into HTTP_ERROR", async () => {
    jest.spyOn(http, "request").mockImplementation((_opts: any, cb: any) => {
      const res = Readable.from([]);
      cb(
        asIncoming(
          res,
          { "content-type": "application/json" },
          500,
          "Internal Server Error",
        ),
      );
      return makeSink() as any;
    }) as any;

    const client = createHttpSmartClient({ baseUrl, serializer });
    await expect(client.task("t.json", { a: 1 } as any)).rejects.toMatchObject({
      code: "HTTP_ERROR",
      httpCode: 500,
    });
  });

  it("JSON path handles empty 500 responses without statusMessage/content-type", async () => {
    jest.spyOn(http, "request").mockImplementation(((
      _opts: unknown,
      cb: (res: http.IncomingMessage) => void,
    ) => {
      const res = Readable.from([]);
      cb(asIncoming(res, {}, 500));
      return makeSink() as unknown as http.ClientRequest;
    }) as unknown as typeof http.request);

    const client = createHttpSmartClient({ baseUrl, serializer });
    await expect(client.task("t.json", { a: 1 })).rejects.toThrow(
      /Tunnel HTTP 500/,
    );
  });

  it("JSON path handles malformed 500 responses without statusMessage/content-type", async () => {
    jest.spyOn(http, "request").mockImplementation(((
      _opts: unknown,
      cb: (res: http.IncomingMessage) => void,
    ) => {
      const res = Readable.from(["<html>bad gateway</html>"]);
      cb(asIncoming(res, {}, 500));
      return makeSink() as unknown as http.ClientRequest;
    }) as unknown as typeof http.request);

    const client = createHttpSmartClient({ baseUrl, serializer });
    await expect(client.task("t.json", { a: 1 })).rejects.toThrow(
      /Tunnel HTTP 500/,
    );
  });

  it("JSON path keeps serializer parse errors for successful 2xx responses", async () => {
    jest.spyOn(http, "request").mockImplementation((_opts: any, cb: any) => {
      const res = Readable.from(["not-json"]);
      cb(asIncoming(res, { "content-type": "application/json" }, 200, "OK"));
      return makeSink() as any;
    }) as any;

    const client = createHttpSmartClient({ baseUrl, serializer });
    await expect(client.task("t.json", { a: 1 } as any)).rejects.toThrow();
  });

  it("JSON path wraps non-Error request errors", async () => {
    jest.spyOn(http, "request").mockImplementation((_opts: any, _cb: any) => {
      const sink = makeSink();
      setImmediate(() => sink.emit("error", "boom"));
      return sink as any;
    }) as any;

    const client = createHttpSmartClient({ baseUrl, serializer });
    await expect(client.task("t.json", { a: 1 } as any)).rejects.toThrow(
      /boom/,
    );
  });

  it("JSON path ignores duplicate end/error events after settling", async () => {
    jest.spyOn(http, "request").mockImplementation((_opts: any, cb: any) => {
      const res = new Readable({ read() {} });
      const body = serializer.stringify({ ok: true, result: 7 });
      const incoming = asIncoming(
        res,
        { "content-type": "application/json" },
        200,
      );
      cb(incoming);
      setImmediate(() => {
        incoming.emit("data", body);
        incoming.emit("end");
        incoming.emit("end");
        incoming.emit("error", new Error("late-error"));
      });
      return makeSink() as any;
    }) as any;

    const client = createHttpSmartClient({ baseUrl, serializer });
    await expect(client.task("t.json", { a: 1 } as any)).resolves.toBe(7);
  });

  it("multipart path rejects non-JSON 502 responses", async () => {
    jest.spyOn(http, "request").mockImplementation((_opts: any, cb: any) => {
      const res = Readable.from(["<html>bad gateway</html>"]);
      cb(asIncoming(res, { "content-type": "text/html" }, 502, "Bad Gateway"));
      return makeSink() as any;
    }) as any;

    const client = createHttpSmartClient({ baseUrl, serializer });
    const input = {
      file: createNodeFile(
        { name: "x.bin" },
        { buffer: Buffer.from([1]) },
        "F2",
      ),
    };
    await expect(client.task("t.upload", input as any)).rejects.toMatchObject({
      code: "HTTP_ERROR",
      httpCode: 502,
    });
  });

  it("multipart path converts empty JSON 500 responses into HTTP_ERROR", async () => {
    jest.spyOn(http, "request").mockImplementation((_opts: any, cb: any) => {
      const res = Readable.from([]);
      cb(
        asIncoming(
          res,
          { "content-type": "application/json" },
          500,
          "Internal Server Error",
        ),
      );
      return makeSink() as any;
    }) as any;

    const client = createHttpSmartClient({ baseUrl, serializer });
    const input = {
      file: createNodeFile(
        { name: "x.bin" },
        { buffer: Buffer.from([1]) },
        "F3",
      ),
    };
    await expect(client.task("t.upload", input as any)).rejects.toMatchObject({
      code: "HTTP_ERROR",
      httpCode: 500,
    });
  });

  it("multipart path converts malformed JSON 502 responses into HTTP_ERROR", async () => {
    jest.spyOn(http, "request").mockImplementation((_opts: any, cb: any) => {
      const res = Readable.from(["<html>bad</html>"]);
      cb(
        asIncoming(
          res,
          { "content-type": "application/json" },
          502,
          "Bad Gateway",
        ),
      );
      return makeSink() as any;
    }) as any;

    const client = createHttpSmartClient({ baseUrl, serializer });
    const input = {
      file: createNodeFile(
        { name: "x.bin" },
        { buffer: Buffer.from([1]) },
        "F4",
      ),
    };
    await expect(client.task("t.upload", input as any)).rejects.toMatchObject({
      code: "HTTP_ERROR",
      httpCode: 502,
    });
  });

  it("multipart request ignores late duplicate callback/error notifications", async () => {
    jest.spyOn(http, "request").mockImplementation((_opts: any, cb: any) => {
      const sink = makeSink();
      const body = serializer.stringify({ ok: true, result: 21 });
      const first = asIncoming(
        Readable.from([body]),
        { "content-type": "application/json" },
        200,
        "OK",
      );
      const second = asIncoming(
        Readable.from([body]),
        { "content-type": "application/json" },
        200,
        "OK",
      );
      cb(first);
      setImmediate(() => {
        cb(second);
        sink.emit("error", new Error("late-error"));
      });
      return sink as any;
    }) as any;

    const client = createHttpSmartClient({ baseUrl, serializer });
    const input = {
      file: createNodeFile(
        { name: "x.bin" },
        { buffer: Buffer.from([1]) },
        "F5",
      ),
    };
    await expect(client.task("t.upload", input as any)).resolves.toBe(21);
  });

  it("multipart path wraps non-Error request errors", async () => {
    jest.spyOn(http, "request").mockImplementation((_opts: any, _cb: any) => {
      const sink = makeSink();
      setImmediate(() => sink.emit("error", "boom"));
      return sink as any;
    }) as any;

    const client = createHttpSmartClient({ baseUrl, serializer });
    const input = {
      file: createNodeFile(
        { name: "x.bin" },
        { buffer: Buffer.from([1]) },
        "F6",
      ),
    };
    await expect(client.task("t.upload", input as any)).rejects.toThrow(/boom/);
  });

  it("octet path rejects non-JSON 503 responses", async () => {
    jest.spyOn(http, "request").mockImplementation((_opts: any, cb: any) => {
      const res = Readable.from(["service unavailable"]);
      cb(
        asIncoming(
          res,
          { "content-type": "text/plain" },
          503,
          "Service Unavailable",
        ),
      );
      return makeSink() as any;
    }) as any;

    const client = createHttpSmartClient({ baseUrl, serializer });
    await expect(
      client.task("t.duplex", Readable.from([Buffer.from("abc")])),
    ).rejects.toMatchObject({
      code: "HTTP_ERROR",
      httpCode: 503,
    });
  });

  it("octet path accepts JSON envelope responses", async () => {
    jest.spyOn(http, "request").mockImplementation((_opts: any, cb: any) => {
      const body = serializer.stringify({ ok: true, result: 99 });
      const res = Readable.from([body]);
      cb(asIncoming(res, { "content-type": "application/json" }, 200, "OK"));
      return makeSink() as any;
    }) as any;

    const client = createHttpSmartClient({ baseUrl, serializer });
    await expect(
      client.task("t.duplex", Readable.from([Buffer.from("abc")])),
    ).resolves.toBe(99);
  });
});
