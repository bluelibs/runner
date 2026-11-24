import type { RpcLaneRequestOptions } from "../../defs";
import { createExposureFetch } from "../../http-fetch-remote-lane.resource";
import { RemoteLaneTransportError } from "../../remote-lanes/http/protocol";
import { defineInternalRequestMetadata } from "../../remote-lanes/http/requestMetadata";
import { createRetryingRpcLaneCommunicator } from "../../remote-lanes/retry";
import { Serializer } from "../../serializer";

describe("HTTP request metadata", () => {
  it("uses the same signed body on every attempt while giving custom callers fresh options", async () => {
    const serializer = new Serializer();
    const payload = { text: "ă🙂" };
    const body = serializer.stringify({ input: payload });
    const response = serializer.stringify({ ok: true, result: 42 });
    const stringify = jest.spyOn(serializer, "stringify");
    const fetchImpl = jest.fn(
      async (_url: Parameters<typeof fetch>[0], _init?: RequestInit) =>
        new Response(response),
    );
    const fetchClient = createExposureFetch({
      baseUrl: "https://example.test/runner",
      serializer,
      fetchImpl,
    });
    const seen: RpcLaneRequestOptions[] = [];
    const communicator = createRetryingRpcLaneCommunicator(
      {
        task: async (id, input, options) => {
          expect(input).toBe(payload);
          const attempt = options!;
          expect(attempt.headers).toEqual({ authorization: "Bearer signed" });
          expect(Object.getOwnPropertySymbols(attempt)).toEqual([]);
          seen.push(attempt);
          const result = await fetchClient.task(id, input, attempt);
          if (seen.length === 1) {
            attempt.headers = {};
            throw new RemoteLaneTransportError("NETWORK_ERROR", "retry me");
          }
          return result;
        },
      },
      { maxAttempts: 2, delayMs: 0, totalTimeoutMs: 5_000 },
    );

    const options = { headers: { authorization: "Bearer signed" } };
    defineInternalRequestMetadata(options, {
      kind: "task",
      id: "task",
      payload,
      serialized: { serializer, body },
    });

    await expect(communicator.task!("task", payload, options)).resolves.toBe(
      42,
    );
    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]);
    expect(stringify).not.toHaveBeenCalled();
    expect(fetchImpl.mock.calls.map(([, init]) => init?.body)).toEqual([
      body,
      body,
    ]);

    await fetchClient.task("other-task", payload, options);
    await fetchClient.task("task", { text: "changed" }, options);
    expect(stringify).toHaveBeenCalledTimes(2);
  });
});
