import * as exposureFetchModule from "../../../http-fetch-tunnel.resource";
import { createHttpMixedClient } from "../../http/http-mixed-client";
import { getDefaultSerializer } from "../../../serializer";

describe("createMixedHttpClient (unit) - eventWithResult missing", () => {
  beforeEach(() => {
    jest
      .spyOn(exposureFetchModule, "createExposureFetch")
      .mockReturnValue({
        task: jest.fn(async () => undefined),
        event: jest.fn(async () => undefined),
        // Intentionally omit eventWithResult to cover guard branch in mixed client
      } as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("throws when underlying fetch client does not support eventWithResult", async () => {
    const client = createHttpMixedClient({
      baseUrl: "http://127.0.0.1:7777/__runner",
      serializer: getDefaultSerializer(),
    });

    await expect(
      client.eventWithResult!("e.id", { x: 1 } as any),
    ).rejects.toThrow(/eventWithResult not available/i);
  });
});
