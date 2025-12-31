import { createExposureFetch } from "../http-fetch-tunnel.resource";
import { getDefaultSerializer } from "../serializer";

describe("createExposureFetch - context header and typed rethrow", () => {
  const baseUrl = "http://127.0.0.1:8080/__runner";

  it("adds x-runner-context header and rethrows typed when registry provided", async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const serializer = getDefaultSerializer();
    const fetchImpl = jest.fn(async (url: any, init?: any) => {
      calls.push({ url: String(url), headers: init?.headers ?? {} });
      const env = {
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "boom",
          id: "tests.errors.app",
          data: { code: 3, message: "X" },
        },
      };
      return { text: async () => serializer.stringify(env) } as any;
    });

    const contexts = [
      {
        id: "ctx.demo",
        use: () => ({ a: 1 }),
        serialize: (v: any) => JSON.stringify(v),
        parse: (s: string) => JSON.parse(s),
        provide: (v: any, fn: any) => fn(),
        require: () => ({}) as any,
      },
    ];
    const helper = {
      id: "tests.errors.app",
      throw: (data: any) => {
        throw new Error("typed:" + String(data?.code));
      },
      is: () => false,
      toString: () => "",
    } as any;

    const client = createExposureFetch({
      baseUrl,
      serializer,
      fetchImpl: fetchImpl as any,
      contexts: contexts as any,
      errorRegistry: new Map([["tests.errors.app", helper]]),
    });

    await expect(client.task("t.id", { a: 1 } as any)).rejects.toThrow(
      /typed:3/,
    );
    // Also test event path typed rethrow
    await expect(client.event("e.id", { x: 1 } as any)).rejects.toThrow(
      /typed:3/,
    );
    // Verify context header added
    const hdr = calls[0]?.headers?.["x-runner-context"];
    expect(typeof hdr).toBe("string");
    const map = serializer.parse<Record<string, string>>(hdr!);
    expect(typeof map["ctx.demo"]).toBe("string");
    expect(JSON.parse(map["ctx.demo"]).a).toBe(1);
  });

  it("omits x-runner-context header when contexts are provided but inactive", async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const serializer = getDefaultSerializer();
    const fetchImpl = jest.fn(async (url: any, init?: any) => {
      calls.push({ url: String(url), headers: init?.headers ?? {} });
      const env = { ok: true, result: 1 };
      return { text: async () => serializer.stringify(env) } as any;
    });
    const contexts = [
      {
        id: "ctx.none",
        use: () => {
          throw new Error("no ctx");
        },
        serialize: (v: any) => JSON.stringify(v),
        parse: (s: string) => JSON.parse(s),
        provide: (v: any, fn: any) => fn(),
        require: () => ({}) as any,
      },
    ];
    const client = createExposureFetch({
      baseUrl,
      serializer,
      fetchImpl: fetchImpl as any,
      contexts: contexts as any,
    });
    await client.task("t.none", { a: 1 } as any);
    expect(calls[0].headers["x-runner-context"]).toBeUndefined();
  });
});
