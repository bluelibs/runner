import * as http from "http";
import { PassThrough, Writable } from "stream";
import { Serializer } from "../../../serializer";
import { createNodeFile } from "../../files";
import { createHttpSmartClient } from "../../http/http-smart-client.model";

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

function jsonResponse() {
  return Object.assign(new PassThrough(), {
    headers: { "content-type": "application/json" },
    statusCode: 200,
  });
}

type Respond = (response: ReturnType<typeof jsonResponse>) => void;

function mockRequest(makeRequest: (respond: Respond) => Writable) {
  const request = (_options: http.RequestOptions, respond: Respond) =>
    makeRequest(respond);
  return jest
    .spyOn(http, "request")
    .mockImplementation(request as unknown as typeof http.request);
}

describe("createHttpSmartClient request lifecycle", () => {
  const baseUrl = "http://127.0.0.1:7777/__runner";
  const serializer = new Serializer();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("observes a raw source error immediately when no request hook is configured", async () => {
    mockRequest(
      () =>
        new Writable({
          write(_chunk, _encoding, done) {
            done();
          },
        }),
    );
    const client = createHttpSmartClient({ baseUrl, serializer });
    const source = new PassThrough();
    const failure = new Error("source read failed");
    // Keep the fixture safe even if the client regresses and misses this event.
    const guard = jest.fn();
    source.on("error", guard);

    let observed = false;
    const task = new Promise<unknown>((resolve) => {
      setImmediate(() => {
        const result = client.task("upload", source);
        observed = source.listenerCount("error") > 1;
        source.destroy(failure);
        resolve(result);
      });
    });

    await expect(task).rejects.toBe(failure);
    expect(observed).toBe(true);
    expect(guard).toHaveBeenCalledWith(failure);
  });

  it("rejects a source error during a request hook before opening the request", async () => {
    const request = mockRequest(() => new PassThrough());
    const client = createHttpSmartClient({
      baseUrl,
      serializer,
      onRequest: nextTurn,
    });
    const source = new PassThrough();
    const failure = new Error("source read failed during hook");
    source.on("error", jest.fn());

    const task = client.task("upload", source);
    source.destroy(failure);

    await expect(task).rejects.toBe(failure);
    expect(request).not.toHaveBeenCalled();
    expect(source.listenerCount("error")).toBe(1);
  });

  it("removes the source listener when the request hook rejects", async () => {
    const request = mockRequest(() => new PassThrough());
    const failure = new Error("hook failed");
    const client = createHttpSmartClient({
      baseUrl,
      serializer,
      onRequest: () => Promise.reject(failure),
    });
    const source = new PassThrough();

    await expect(client.task("upload", source)).rejects.toBe(failure);
    expect(request).not.toHaveBeenCalled();
    expect(source.listenerCount("error")).toBe(0);
  });

  it("keeps the multipart timeout active while reading the response body", async () => {
    const response = jsonResponse();
    const responseError = new Error(
      "response closed before the body completed",
    );
    const request = new Writable({
      autoDestroy: false,
      write(_chunk, _encoding, done) {
        done();
      },
      final(done) {
        done();
      },
      destroy(error, done) {
        response.destroy(responseError);
        done(error);
      },
    });
    mockRequest((respond) => {
      request.once("finish", () => respond(response));
      return request;
    });
    const client = createHttpSmartClient({
      baseUrl,
      serializer,
      timeoutMs: 20,
    });
    const file = createNodeFile(
      { name: "input.txt" },
      {
        buffer: Buffer.from("upload"),
      },
    );

    const task = client.task("upload", { file });
    await Promise.all([
      expect(task).rejects.toBe(responseError),
      nextTurn().then(() => {
        request.emit("timeout");
        if (!response.destroyed) {
          response.end(serializer.stringify({ ok: true }));
        }
      }),
    ]);

    expect(request.listenerCount("timeout")).toBe(0);
  });

  it("serializes each JSON call before the caller reuses its input", async () => {
    const sent: number[] = [];
    mockRequest((respond) => {
      const response = jsonResponse();
      return new Writable({
        write(chunk, _encoding, done) {
          const body = serializer.parse(chunk.toString()) as {
            input: { version: number };
          };
          sent.push(body.input.version);
          done();
        },
        final(done) {
          done();
          setImmediate(() => {
            respond(response);
            response.end(serializer.stringify({ ok: true }));
          });
        },
      });
    });

    const client = createHttpSmartClient({ baseUrl, serializer });
    const input = { version: 1 };
    const first = client.task("write", input);
    input.version = 2;
    const second = client.task("write", input);

    await Promise.all([first, second]);
    expect(sent).toEqual([1, 2]);
  });
});
