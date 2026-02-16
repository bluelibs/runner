import { createExposureFetch } from "../../http-fetch-tunnel.resource";
import { Serializer } from "../../serializer";
import { IErrorHelper } from "../../defs";

describe("http-fetch-tunnel.resource - HTTP status handling", () => {
  it("throws HTTP_ERROR when non-2xx response body is not serializer-parsable", async () => {
    const fetchImpl: typeof fetch = (async () =>
      ({
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
        headers: { get: () => "text/html" },
        text: async () => "<html>bad gateway</html>",
      }) as unknown as Response) as unknown as typeof fetch;

    const client = createExposureFetch({
      baseUrl: "http://api",
      fetchImpl,
      serializer: new Serializer(),
    });

    await expect(client.task("t.id", { a: 1 })).rejects.toMatchObject({
      code: "HTTP_ERROR",
      httpCode: 502,
    });
  });

  it("throws HTTP_ERROR when non-2xx response body is empty", async () => {
    const fetchImpl: typeof fetch = (async () =>
      ({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        headers: { get: () => "text/plain" },
        text: async () => "",
      }) as unknown as Response) as unknown as typeof fetch;

    const client = createExposureFetch({
      baseUrl: "http://api",
      fetchImpl,
      serializer: new Serializer(),
    });

    await expect(client.event("e.id", { x: 1 })).rejects.toMatchObject({
      code: "HTTP_ERROR",
      httpCode: 503,
    });
  });

  it("uses fallback HTTP message when non-2xx statusText is missing", async () => {
    const fetchImpl: typeof fetch = (async () =>
      ({
        ok: false,
        status: 504,
        headers: { get: () => "text/plain" },
        text: async () => "<html>gateway timeout</html>",
      }) as unknown as Response) as unknown as typeof fetch;

    const client = createExposureFetch({
      baseUrl: "http://api",
      fetchImpl,
      serializer: new Serializer(),
    });

    await expect(client.task("t.id", { a: 1 })).rejects.toThrow(
      /Tunnel HTTP 504/,
    );
  });

  it("handles missing statusText and null content-type in empty error responses", async () => {
    const fetchImpl: typeof fetch = (async () =>
      ({
        ok: false,
        status: 500,
        headers: { get: () => null },
        text: async () => "",
      }) as unknown as Response) as unknown as typeof fetch;

    const client = createExposureFetch({
      baseUrl: "http://api",
      fetchImpl,
      serializer: new Serializer(),
    });

    await expect(client.event("e.id", { x: 1 })).rejects.toThrow(
      /Tunnel HTTP 500/,
    );
  });

  it("rethrows serializer parse errors for successful 2xx malformed payloads", async () => {
    const fetchImpl: typeof fetch = (async () =>
      ({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => "application/json" },
        text: async () => "not-json",
      }) as unknown as Response) as unknown as typeof fetch;

    const client = createExposureFetch({
      baseUrl: "http://api",
      fetchImpl,
      serializer: new Serializer(),
    });

    await expect(client.task("t.id", { a: 1 })).rejects.toThrow();
  });

  it("keeps typed-envelope behavior for non-2xx JSON responses", async () => {
    const serializer = new Serializer();
    const fetchImpl: typeof fetch = (async () =>
      ({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        headers: { get: () => "application/json" },
        text: async () =>
          serializer.stringify({
            ok: false,
            error: {
              code: "INTERNAL_ERROR",
              message: "boom",
              id: "tests.errors.status",
              data: { code: 17 },
            },
          }),
      }) as unknown as Response) as unknown as typeof fetch;

    const helper = {
      id: "tests.errors.status",
      throw: (data: any) => {
        throw new Error("typed-status:" + String(data?.code));
      },
      is: () => false,
      toString: () => "",
    } as unknown as IErrorHelper<any>;

    const client = createExposureFetch({
      baseUrl: "http://api",
      fetchImpl,
      serializer,
      errorRegistry: new Map([["tests.errors.status", helper]]),
    });

    await expect(client.task("t.id", { a: 1 })).rejects.toThrow(
      /typed-status:17/,
    );
  });
});
