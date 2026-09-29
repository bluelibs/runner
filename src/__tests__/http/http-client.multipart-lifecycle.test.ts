import { createHttpClient } from "../../http-client";
import { createWebFile } from "../../platform/createWebFile";
import { Serializer } from "../../serializer";
import { RemoteLaneTransportError } from "../../remote-lanes/http/protocol";

describe("universal multipart request lifecycle", () => {
  afterEach(() => jest.useRealTimers());
  const input = () => ({
    file: createWebFile({ name: "test.txt" }, new Blob(["test"])),
  });
  const baseConfig = {
    baseUrl: "https://example.test",
    serializer: new Serializer(),
  };

  const waitingFetch: typeof fetch = async (_url, options) =>
    new Promise((_resolve, reject) => {
      const signal = options?.signal;
      const abort = () => reject(new DOMException("aborted", "AbortError"));
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });

  it("aborts uploads at timeoutMs and clears the timer", async () => {
    jest.useFakeTimers();
    const client = createHttpClient({
      ...baseConfig,
      timeoutMs: 10,
      fetchImpl: waitingFetch,
    });
    const pending = client.task("upload", input());
    const rejection = pending.catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(10);
    await expect(rejection).resolves.toMatchObject({
      code: "TIMEOUT",
      details: { timeoutMs: 10 },
    });
    expect(jest.getTimerCount()).toBe(0);
  });

  it("preserves caller cancellation rather than reporting a client timeout", async () => {
    const controller = new AbortController();
    const client = createHttpClient({
      ...baseConfig,
      timeoutMs: 10_000,
      fetchImpl: waitingFetch,
    });
    const pending = client.task("upload", input(), {
      signal: controller.signal,
    });
    const rejection = pending.catch((error: unknown) => error);
    controller.abort();
    await expect(rejection).resolves.toMatchObject({ name: "AbortError" });
  });

  it("classifies multipart gateway errors and preserves Retry-After", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("overloaded", {
        status: 503,
        headers: { "Retry-After": "2" },
      });
    const client = createHttpClient({ ...baseConfig, fetchImpl });
    await expect(client.task("upload", input())).rejects.toMatchObject({
      code: "HTTP_ERROR",
      httpCode: 503,
      retryAfterMs: 2000,
    });
  });

  it("normalizes request failures and cleans up a successful upload timeout", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("connection reset");
    };
    const client = createHttpClient({ ...baseConfig, fetchImpl });
    await expect(client.task("upload", input())).rejects.toBeInstanceOf(
      RemoteLaneTransportError,
    );
    jest.useFakeTimers();
    const success: typeof fetch = async () =>
      new Response('{"ok":true,"result":"uploaded"}');
    await expect(
      createHttpClient({
        ...baseConfig,
        timeoutMs: 10,
        fetchImpl: success,
      }).task("upload", input()),
    ).resolves.toBe("uploaded");
    expect(jest.getTimerCount()).toBe(0);
  });
});
