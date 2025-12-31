import { createHttpClient } from "../http-client";
import { createWebFile } from "../platform/createWebFile";
import { getDefaultSerializer } from "../serializer";

describe("http-client branches coverage", () => {
  const baseUrl = "http://127.0.0.1:7070/__runner";

  it("postMultipartBrowser: empty response yields undefined envelope and assertOkEnvelope throws", async () => {
    const blob = new Blob([Buffer.from("abc")], { type: "text/plain" });
    const file = createWebFile(
      { name: "a.txt", type: "text/plain" },
      blob,
      "FE1",
    );
    const fetchMock = async () => ({ text: async () => "" }) as any;
    const client = createHttpClient({
      baseUrl,
      fetchImpl: fetchMock as any,
      serializer: getDefaultSerializer(),
    });
    await expect(client.task("t.empty", { file } as any)).rejects.toBeTruthy();
  });

  it("postMultipartBrowser: non-json content-type still parsed by text path", async () => {
    const blob = new Blob([Buffer.from("x")], {
      type: "application/octet-stream",
    });
    const file = createWebFile({ name: "b.bin" }, blob, "FE2");
    const fetchMock = async () =>
      ({
        text: async () =>
          getDefaultSerializer().stringify({ ok: true, result: 5 }),
        headers: { get: () => "text/plain" },
      }) as any;
    const client = createHttpClient({
      baseUrl,
      fetchImpl: fetchMock as any,
      serializer: getDefaultSerializer(),
    });
    const r = await client.task("t.nonjson", { file } as any);
    expect(r).toBe(5);
  });
});
