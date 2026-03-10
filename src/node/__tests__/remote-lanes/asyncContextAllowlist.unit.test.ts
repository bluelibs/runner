import {
  buildAsyncContextHeader,
  resolveLaneAsyncContextAllowList,
  resolveLaneAsyncContextPolicy,
} from "../../remote-lanes/asyncContextAllowlist";

describe("asyncContext allowlist helpers", () => {
  it("resolves lane allowlist from explicit refs and legacy flags", () => {
    expect(resolveLaneAsyncContextAllowList({})).toEqual([]);
    expect(
      resolveLaneAsyncContextAllowList({ legacyAllowAsyncContext: true }),
    ).toBeUndefined();

    const contextRef = { id: "ctx-object" } as any;
    expect(
      resolveLaneAsyncContextAllowList({
        laneAsyncContexts: [
          "ctx.string",
          "",
          contextRef,
          { id: "" } as any,
          contextRef,
        ],
      }),
    ).toEqual(["ctx.string", "ctx-object"]);

    expect(
      resolveLaneAsyncContextPolicy({
        laneAsyncContexts: ["ctx.allowed"],
      }),
    ).toEqual({
      allowList: ["ctx.allowed"],
      allowAsyncContext: true,
    });
    expect(resolveLaneAsyncContextPolicy({})).toEqual({
      allowList: [],
      allowAsyncContext: false,
    });
    expect(
      resolveLaneAsyncContextPolicy({ legacyAllowAsyncContext: true }),
    ).toEqual({
      allowList: undefined,
      allowAsyncContext: true,
    });
  });

  it("builds context header for allowlisted/all contexts and skips unavailable ones", () => {
    const serializer = {
      stringify: (value: unknown) => JSON.stringify(value),
    } as any;
    const goodCtx = {
      id: "ctx-good",
      use: () => ({ ok: true }),
      serialize: (value: unknown) => JSON.stringify(value),
    } as any;
    const badCtx = {
      id: "ctx-bad",
      use: () => {
        throw new Error("missing");
      },
      serialize: (value: unknown) => JSON.stringify(value),
    } as any;
    const registry = new Map([
      [goodCtx.id, goodCtx],
      [badCtx.id, badCtx],
    ]);

    const allHeader = buildAsyncContextHeader({
      allowList: undefined,
      registry,
      serializer,
    });
    const allMap = JSON.parse(allHeader!);
    expect(allMap[goodCtx.id]).toBe(JSON.stringify({ ok: true }));
    expect(allMap[badCtx.id]).toBeUndefined();

    const allowlistedHeader = buildAsyncContextHeader({
      allowList: ["ctx.missing", goodCtx.id],
      registry,
      serializer,
    });
    const allowlistedMap = JSON.parse(allowlistedHeader!);
    expect(allowlistedMap[goodCtx.id]).toBe(JSON.stringify({ ok: true }));
    expect(allowlistedMap["ctx.missing"]).toBeUndefined();

    expect(
      buildAsyncContextHeader({
        allowList: [],
        registry: new Map(),
        serializer,
      }),
    ).toBeUndefined();
  });
});
