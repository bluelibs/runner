import { createHttpClient } from "../../http-client";
import { createWebFile } from "../../platform/createWebFile";
import { Serializer } from "../../serializer";
import { defineError } from "../../definers/defineError";

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
      serializer: new Serializer(),
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
        text: async () => new Serializer().stringify({ ok: true, result: 5 }),
        headers: { get: () => "text/plain" },
      }) as any;
    const client = createHttpClient({
      baseUrl,
      fetchImpl: fetchMock as any,
      serializer: new Serializer(),
    });
    const r = await client.task("t.nonjson", { file } as any);
    expect(r).toBe(5);
  });

  it("rethrows typed errors via error registry helper when mapping exists", async () => {
    const AppError = defineError<{ code: string; message: string }>({
      id: "tests.http-client.mapped.error",
      format: (data) => `${data.code}:${data.message}`,
    });
    const fetchMock = async () => {
      throw {
        id: AppError.id,
        data: { code: "E_REGISTRY", message: "mapped" },
      };
    };
    const client = createHttpClient({
      baseUrl,
      fetchImpl: fetchMock as any,
      serializer: new Serializer(),
      errorRegistry: new Map([[AppError.id, AppError]]),
    });

    await expect(
      client.task("t.error.registry", {} as any),
    ).rejects.toMatchObject({
      id: AppError.id,
      data: { code: "E_REGISTRY", message: "mapped" },
    });
  });

  it("falls back to original thrown typed error when registry has no helper", async () => {
    const thrown = {
      id: "tests.http-client.unmapped.error",
      data: { reason: "no-helper" },
    };
    const fetchMock = async () => {
      throw thrown;
    };
    const client = createHttpClient({
      baseUrl,
      fetchImpl: fetchMock as any,
      serializer: new Serializer(),
      errorRegistry: new Map(),
    });

    await expect(client.task("t.error.unmapped", {} as any)).rejects.toBe(
      thrown,
    );
  });
});
