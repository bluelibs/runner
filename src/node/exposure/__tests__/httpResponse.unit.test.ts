import { Readable } from "node:stream";
import {
  respondJson,
  jsonErrorResponse,
  jsonOkResponse,
  respondStream,
} from "../httpResponse";

enum SecurityHeaderName {
  ContentTypeOptions = "x-content-type-options",
  FrameOptions = "x-frame-options",
}

enum SecurityHeaderValue {
  NoSniff = "nosniff",
  Deny = "DENY",
}

describe("httpResponse helpers", () => {
  it("respondJson writes JSON when response not ended", () => {
    let status = 0;
    let body = Buffer.alloc(0);
    const headers: Record<string, string> = {};
    const res: any = {
      writableEnded: false,
      statusCode: 0,
      setHeader(k: string, v: string) {
        headers[k.toLowerCase()] = v;
      },
      end(buf?: any) {
        status = this.statusCode;
        if (buf) body = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf));
        this.writableEnded = true;
      },
    };
    respondJson(res, jsonOkResponse({ a: 1 }));
    expect(status).toBe(200);
    const out = JSON.parse(body.toString("utf8"));
    expect(out.ok).toBe(true);
    expect(out.a).toBe(1);
    expect(headers[SecurityHeaderName.ContentTypeOptions]).toBe(
      SecurityHeaderValue.NoSniff,
    );
    expect(headers[SecurityHeaderName.FrameOptions]).toBe(
      SecurityHeaderValue.Deny,
    );
  });

  it("respondJson returns early when already ended", () => {
    let ended = false;
    const res: any = {
      writableEnded: true,
      setHeader() {},
      end() {
        ended = true;
      },
    };
    respondJson(res, jsonOkResponse());
    expect(ended).toBe(false);
  });

  it("jsonErrorResponse includes code when provided and omits when absent", () => {
    const withCode = jsonErrorResponse(400, "Bad", "BAD");
    const without = jsonErrorResponse(400, "Bad");
    expect((withCode.body as any).error.code).toBe("BAD");
    expect((without.body as any).error.code).toBeUndefined();
  });

  it("jsonErrorResponse merges extra fields into error payload", () => {
    const res = jsonErrorResponse(500, "Oops", "INTERNAL_ERROR", {
      id: "tests.errors.app",
      data: { code: 1, message: "Oops" },
    });
    const err = (res.body as any).error;
    expect(err.id).toBe("tests.errors.app");
    expect(err.data).toEqual({ code: 1, message: "Oops" });
  });

  it("respondStream pipes a plain Readable with defaults", () => {
    let ended = false;
    const chunks: Buffer[] = [];
    const headers: Record<string, string> = {};
    const res: any = {
      writableEnded: false,
      statusCode: 0,
      setHeader(k: string, v: string) {
        headers[k.toLowerCase()] = v;
      },
      write(b: any) {
        chunks.push(Buffer.isBuffer(b) ? b : Buffer.from(String(b)));
      },
      end(b?: any) {
        if (b) this.write(b);
        this.writableEnded = true;
        ended = true;
      },
    };
    const r = new Readable({
      read() {
        this.push(Buffer.from("ab", "utf8"));
        this.push(null);
      },
    });
    respondStream(res, r);
    expect(headers["content-type"]).toMatch(/application\/octet-stream/i);
    expect(headers[SecurityHeaderName.ContentTypeOptions]).toBe(
      SecurityHeaderValue.NoSniff,
    );
    expect(headers[SecurityHeaderName.FrameOptions]).toBe(
      SecurityHeaderValue.Deny,
    );
    expect(Buffer.concat(chunks as Uint8Array[]).toString("utf8")).toBe("ab");
    expect(ended).toBe(true);
  });

  it("respondStream pipes a StreamingResponse wrapper and respects headers", () => {
    let ended = false;
    const chunks: Buffer[] = [];
    const headers: Record<string, string> = {};
    const res: any = {
      writableEnded: false,
      statusCode: 0,
      setHeader(k: string, v: string) {
        headers[k.toLowerCase()] = v;
      },
      write(b: any) {
        chunks.push(Buffer.isBuffer(b) ? b : Buffer.from(String(b)));
      },
      end(b?: any) {
        if (b) this.write(b);
        this.writableEnded = true;
        ended = true;
      },
    };
    const r = new Readable({
      read() {
        this.push("x");
        this.push(null);
      },
    });
    respondStream(res, {
      stream: r,
      contentType: "text/plain",
      headers: { "x-demo": "1" },
    });
    expect(headers["content-type"]).toMatch(/text\/plain/i);
    expect(headers["x-demo"]).toBe("1");
    expect(Buffer.concat(chunks as Uint8Array[]).toString("utf8")).toBe("x");
    expect(ended).toBe(true);
  });

  it("respondStream uses pipe when response supports listeners", () => {
    const pipeSpy = jest.fn();
    const res: any = {
      writableEnded: false,
      statusCode: 0,
      headers: {} as Record<string, string>,
      setHeader(k: string, v: string) {
        this.headers[k.toLowerCase()] = v;
      },
      on: jest.fn(),
      end: jest.fn(),
    };
    const stream: any = { pipe: pipeSpy };
    respondStream(res, stream as any);
    expect(pipeSpy).toHaveBeenCalledTimes(1);
    expect(pipeSpy).toHaveBeenCalledWith(res);
    expect(res.end).not.toHaveBeenCalled();
  });

  it("respondStream drains async chunks and cleans up listeners", async () => {
    const chunks: Buffer[] = [];
    const res: any = {
      writableEnded: false,
      statusCode: 0,
      headers: {} as Record<string, string>,
      setHeader(k: string, v: string) {
        this.headers[k.toLowerCase()] = v;
      },
      write(payload: any) {
        chunks.push(
          Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload)),
        );
      },
      end() {
        this.writableEnded = true;
      },
    };
    const stream = new Readable({ read() {} });
    respondStream(res, stream);
    expect(stream.listenerCount("data")).toBeGreaterThan(0);
    stream.push("hello");
    stream.push(null);
    await new Promise((resolve) => setImmediate(resolve));
    expect(res.writableEnded).toBe(true);
    expect(Buffer.concat(chunks as Uint8Array[]).toString("utf8")).toBe(
      "hello",
    );
    expect(stream.listenerCount("data")).toBe(0);
  });

  it("respondStream applies status override for streaming wrapper", () => {
    const res: any = {
      writableEnded: false,
      statusCode: 0,
      headers: {} as Record<string, string>,
      setHeader(k: string, v: string) {
        this.headers[k.toLowerCase()] = v;
      },
      write() {},
      end() {
        this.writableEnded = true;
      },
    };
    const stream = new Readable({ read() {} });
    respondStream(res, {
      stream,
      status: 202,
      contentType: "text/plain",
    });
    expect(res.statusCode).toBe(202);
  });

  it("respondStream falls back to removeListener when .off is unavailable", async () => {
    const chunks: Buffer[] = [];
    const res: any = {
      writableEnded: false,
      statusCode: 0,
      headers: {} as Record<string, string>,
      setHeader(k: string, v: string) {
        this.headers[k.toLowerCase()] = v;
      },
      write(payload: any) {
        chunks.push(
          Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload)),
        );
      },
      end() {
        this.writableEnded = true;
      },
    };
    const stream = new Readable({ read() {} });
    const removeListenerSpy = jest.spyOn(stream, "removeListener");
    (stream as any).off = undefined;
    respondStream(res, stream);
    stream.push("hi");
    stream.push(null);
    await new Promise((resolve) => setImmediate(resolve));
    expect(res.writableEnded).toBe(true);
    expect(Buffer.concat(chunks as Uint8Array[]).toString("utf8")).toBe("hi");
    expect(removeListenerSpy).toHaveBeenCalledWith(
      "data",
      expect.any(Function),
    );
  });
  it("respondStream ends response on stream error", async () => {
    const res: any = {
      writableEnded: false,
      statusCode: 0,
      headers: {} as Record<string, string>,
      setHeader(k: string, v: string) {
        this.headers[k.toLowerCase()] = v;
      },
      write() {},
      end() {
        this.writableEnded = true;
      },
    };
    const stream = new Readable({ read() {} });
    respondStream(res, stream);
    stream.emit("error", new Error("boom"));
    await new Promise((resolve) => setImmediate(resolve));
    expect(res.writableEnded).toBe(true);
  });

  it("respondStream returns early when already ended", () => {
    const res: any = {
      writableEnded: true,
      setHeader() {},
      end() {},
      write() {},
    };
    const r = new Readable({
      read() {
        this.push(null);
      },
    });
    respondStream(res, r);
    expect(res.writableEnded).toBe(true);
  });
});
