import { tunnels } from "../index";
import { EJSON, getDefaultSerializer } from "../../resources/tunnel/serializer";

describe("globals.tunnels index", () => {
  it("http.createClient forwards url to createExposureFetch and returns a client", async () => {
    // Use a fake fetch that returns { ok: true, result: 1 } for task
    const fetchImpl: typeof fetch = (async (_input: any, _init?: any) => {
      return new Response(JSON.stringify({ ok: true, result: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }) as any;
    }) as any;

    const client = tunnels.http.createClient({
      url: "http://x/__runner",
      fetchImpl,
      serializer: getDefaultSerializer(),
    });
    expect(typeof client.task).toBe("function");
    expect(typeof client.event).toBe("function");
    // Exercise a simple call to ensure the object works
    const res = await client.task("t.id", {});
    expect(res).toBe(1);
  });
});
