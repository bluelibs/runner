import { createExposureFetch } from "../../http-fetch-tunnel.resource";
import { Serializer } from "../../serializer";

describe("http-fetch-tunnel.resource onRequest hook", () => {
  it("invokes onRequest with url and headers", async () => {
    const seen: any[] = [];
    const fetchImpl: typeof fetch = (async (url: any, init?: any) => {
      // respond ok envelope
      return {
        text: async () => JSON.stringify({ ok: true, result: 11 }),
      } as any;
    }) as any;
    const onRequest = async (ctx: {
      url: string;
      headers: Record<string, string>;
    }) => {
      seen.push(ctx);
    };

    const client = createExposureFetch({
      baseUrl: "http://example.test/__runner",
      fetchImpl,
      onRequest,
      serializer: new Serializer(),
    });
    const r = await client.task("tid", { x: 1 });
    expect(r).toBe(11);
    expect(seen.length).toBe(1);
    expect(seen[0].url).toContain("/task/");
    expect(seen[0].headers["content-type"]).toContain("application/json");
  });
});
