import { createExposureFetch } from "../../http-fetch-remote-lane.resource";
import { Serializer } from "../../serializer";

function abortingFetch(): typeof fetch {
  return ((_url: unknown, init: { signal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const error = new Error("The operation was aborted.");
        error.name = "AbortError";
        reject(error);
      });
    })) as unknown as typeof fetch;
}

describe("http-fetch-remote-lane.resource - timeout vs abort", () => {
  it("throws TIMEOUT when the client's own timeout aborts the request", async () => {
    const client = createExposureFetch({
      baseUrl: "http://api",
      fetchImpl: abortingFetch(),
      serializer: new Serializer(),
      timeoutMs: 5,
    });

    await expect(client.task("t.id", { a: 1 })).rejects.toMatchObject({
      code: "TIMEOUT",
      name: "RemoteLaneTransportError",
    });
  });

  it("rethrows the raw abort instead of masking a user abort as TIMEOUT", async () => {
    const client = createExposureFetch({
      baseUrl: "http://api",
      fetchImpl: abortingFetch(),
      serializer: new Serializer(),
    });

    const controller = new AbortController();
    const pending = client.task(
      "t.id",
      { a: 1 },
      {
        signal: controller.signal,
      },
    );

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await expect(pending).rejects.not.toMatchObject({ code: "TIMEOUT" });
  });
});
