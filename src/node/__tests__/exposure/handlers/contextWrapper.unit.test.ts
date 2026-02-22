import {
  withExposureContext,
  withUserContexts,
} from "../../../exposure/handlers/contextWrapper";
import { useExposureContext } from "../../../exposure/requestContext";

describe("contextWrapper", () => {
  it("withExposureContext handles array context header and bad per-context parse", async () => {
    const goodCtx = {
      id: "ctx.good",
      parse: (value: string) => JSON.parse(value),
      provide: async (_value: unknown, fn: () => Promise<string>) => fn(),
    };
    const badCtx = {
      id: "ctx.bad",
      parse: () => {
        throw new Error("bad parse");
      },
      provide: async (_value: unknown, fn: () => Promise<string>) => fn(),
    };

    const req = {
      headers: {
        "x-runner-context": [
          JSON.stringify({
            [goodCtx.id]: JSON.stringify({ ok: true }),
            [badCtx.id]: "oops",
          }),
        ],
      },
      method: "POST",
      url: undefined,
    } as any;
    const res = {} as any;
    const controller = new AbortController();

    const result = await withExposureContext(
      req,
      res,
      controller,
      {
        store: {
          asyncContexts: new Map([
            [goodCtx.id, goodCtx],
            [badCtx.id, badCtx],
          ]),
        } as any,
        router: { basePath: "/__runner" },
        serializer: { parse: (text: string) => JSON.parse(text) } as any,
      },
      async () => {
        const exposure = useExposureContext();
        return `${exposure.basePath}:${exposure.url.pathname}`;
      },
    );

    expect(result).toBe("/__runner:/");
  });

  it("withUserContexts skips hydration when allowAsyncContext is false", async () => {
    const parseSpy = jest.fn((value: string) => JSON.parse(value));
    const provideSpy = jest.fn(
      async (_value: unknown, fn: () => Promise<string>) => fn(),
    );
    const ctx = {
      id: "ctx.disabled",
      parse: parseSpy,
      provide: provideSpy,
    };

    const req = {
      headers: {
        "x-runner-context": JSON.stringify({
          [ctx.id]: JSON.stringify({ fromHeader: true }),
        }),
      },
    } as any;

    const out = await withUserContexts(
      req,
      {
        store: { asyncContexts: new Map([[ctx.id, ctx]]) } as any,
        serializer: { parse: (text: string) => JSON.parse(text) } as any,
      },
      async () => "ok",
      { allowAsyncContext: false },
    );

    expect(out).toBe("ok");
    expect(parseSpy).not.toHaveBeenCalled();
    expect(provideSpy).not.toHaveBeenCalled();
  });

  it("ignores non-string context values during hydration for both wrappers", async () => {
    const parseSpy = jest.fn((value: string) => JSON.parse(value));
    const provideSpy = jest.fn(
      async (_value: unknown, fn: () => Promise<string>) => fn(),
    );
    const ctx = {
      id: "ctx.non-string",
      parse: parseSpy,
      provide: provideSpy,
    };

    const serializer = { parse: (text: string) => JSON.parse(text) } as any;

    const reqA = {
      headers: {
        "x-runner-context": JSON.stringify({ [ctx.id]: { not: "a string" } }),
      },
      method: "POST",
      url: "/x",
    } as any;
    const resA = {} as any;
    const controller = new AbortController();

    await withExposureContext(
      reqA,
      resA,
      controller,
      {
        store: { asyncContexts: new Map([[ctx.id, ctx]]) } as any,
        router: { basePath: "/__runner" },
        serializer,
      },
      async () => "ok-a",
    );

    const reqB = {
      headers: {
        "x-runner-context": JSON.stringify({ [ctx.id]: 123 }),
      },
    } as any;
    const out = await withUserContexts(
      reqB,
      {
        store: { asyncContexts: new Map([[ctx.id, ctx]]) } as any,
        serializer,
      },
      async () => "ok-b",
    );

    expect(out).toBe("ok-b");
    expect(parseSpy).not.toHaveBeenCalled();
    expect(provideSpy).not.toHaveBeenCalled();
  });
});
