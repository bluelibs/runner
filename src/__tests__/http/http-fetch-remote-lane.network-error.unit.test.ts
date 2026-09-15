import { createExposureFetch } from "../../http-fetch-remote-lane.resource";
import { RemoteLaneTransportError } from "../../remote-lanes/http/protocol";
import { Serializer } from "../../serializer";

describe("http-fetch-remote-lane.resource - network errors", () => {
  it("wraps fetch rejections as retryable NETWORK_ERRORs", async () => {
    const failure = new TypeError("fetch failed");
    const client = createExposureFetch({
      baseUrl: "http://api",
      fetchImpl: (() => Promise.reject(failure)) as unknown as typeof fetch,
      serializer: new Serializer(),
    });

    try {
      await client.task("t.id", { a: 1 });
      fail("should reject");
    } catch (error) {
      expect(error).toBeInstanceOf(RemoteLaneTransportError);
      expect(error).toMatchObject({
        code: "NETWORK_ERROR",
        name: "RemoteLaneTransportError",
        message: "fetch failed",
      });
      expect((error as RemoteLaneTransportError).details).toEqual({
        cause: failure,
      });
    }
  });

  it("wraps fetch rejections when a timeout is configured but did not fire", async () => {
    const client = createExposureFetch({
      baseUrl: "http://api",
      fetchImpl: (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
      serializer: new Serializer(),
      timeoutMs: 1000,
    });

    await expect(client.task("t.id", { a: 1 })).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
  });

  it("passes typed transport errors from fetchImpl through untouched", async () => {
    const typed = new RemoteLaneTransportError("HTTP_ERROR", "bad gateway", {
      statusCode: 502,
    });
    const client = createExposureFetch({
      baseUrl: "http://api",
      fetchImpl: (() => Promise.reject(typed)) as unknown as typeof fetch,
      serializer: new Serializer(),
    });

    try {
      await client.task("t.id", { a: 1 });
      fail("should reject");
    } catch (error) {
      expect(error).toBe(typed);
    }
  });

  it("maps body-phase aborts after the client timeout to TIMEOUT", async () => {
    const fetchImpl = (async (
      _url: unknown,
      init: { signal?: AbortSignal },
    ) => ({
      text: () =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const error = new Error("The operation was aborted.");
            error.name = "AbortError";
            reject(error);
          });
        }),
    })) as unknown as typeof fetch;
    const client = createExposureFetch({
      baseUrl: "http://api",
      fetchImpl,
      serializer: new Serializer(),
      timeoutMs: 5,
    });

    await expect(client.task("t.id", { a: 1 })).rejects.toMatchObject({
      code: "TIMEOUT",
      name: "RemoteLaneTransportError",
    });
  });
});
