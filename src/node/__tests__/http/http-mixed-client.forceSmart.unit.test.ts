import * as http from "http";
import { Readable, Writable } from "stream";
import { createHttpMixedClient } from "../../http/http-mixed-client";
import { Serializer } from "../../../serializer";

function asIncoming(
  res: Readable,
  headers: Record<string, string>,
): http.IncomingMessage {
  (res as unknown as { headers: Record<string, string> }).headers = headers;
  return res as unknown as http.IncomingMessage;
}

function makeSink(): http.ClientRequest {
  const sink = new Writable({
    write(_c, _e, n) {
      n();
    },
    final(n) {
      n();
    },
  }) as unknown as http.ClientRequest;

  (sink as unknown as { on: any }).on = (_: any, __: any) => sink;
  (sink as unknown as { setTimeout: any }).setTimeout = () => sink;
  (sink as unknown as { destroy: any }).destroy = () => undefined;
  return sink;
}

describe("createHttpMixedClient.forceSmart (unit)", () => {
  const baseUrl = "http://127.0.0.1:7777/__runner";
  const serializer = new Serializer();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("forceSmart: true routes plain JSON inputs through Smart client", async () => {
    const reqSpy = jest
      .spyOn(http, "request")
      .mockImplementation((_opts: unknown, cb: unknown) => {
        const callback = cb as (res: http.IncomingMessage) => void;
        const env = { ok: true, result: 42 };
        const body = Buffer.from(serializer.stringify(env), "utf8");
        callback(
          asIncoming(Readable.from([body]), {
            "content-type": "application/json",
          }),
        );
        return makeSink();
      });

    const fetchMock = jest.fn(async () => {
      throw new Error("fetch path should not be used");
    });

    const client = createHttpMixedClient({
      baseUrl,
      serializer,
      fetchImpl: fetchMock as unknown as typeof fetch,
      forceSmart: true,
    });

    const out = await client.task("plain.task", { a: 1 });
    expect(out).toBe(42);
    expect(reqSpy).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forceSmart predicate routes only selected task ids through Smart", async () => {
    const reqSpy = jest
      .spyOn(http, "request")
      .mockImplementation((_opts: unknown, cb: unknown) => {
        const callback = cb as (res: http.IncomingMessage) => void;
        const env = { ok: true, result: 99 };
        const body = Buffer.from(serializer.stringify(env), "utf8");
        callback(
          asIncoming(Readable.from([body]), {
            "content-type": "application/json",
          }),
        );
        return makeSink();
      });

    const fetchMock = jest.fn(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        expect(String(url)).toContain("/task/plain.task");
        expect(init?.method).toBe("POST");
        return {
          text: async () => serializer.stringify({ ok: true, result: 11 }),
        } as unknown as Response;
      },
    );

    const client = createHttpMixedClient({
      baseUrl,
      serializer,
      fetchImpl: fetchMock as unknown as typeof fetch,
      forceSmart: ({ id }) => id === "stream.task",
    });

    await expect(client.task("plain.task", { a: 1 })).resolves.toBe(11);
    await expect(client.task("stream.task", { a: 1 })).resolves.toBe(99);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(reqSpy).toHaveBeenCalledTimes(1);
  });
});
