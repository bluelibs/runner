import {
  buildAsyncContextHeader,
  resolveLaneAsyncContextAllowList,
  resolveLaneAsyncContextPolicy,
  resolveRegistryAsyncContextIds,
  withSerializedAsyncContexts,
} from "../../remote-lanes/asyncContextAllowlist";
import { r } from "../../..";
import { EventManager } from "../../../models/EventManager";
import { runtimeSource } from "../../../types/runtimeSource";
import { LockableMap } from "../../../tools/LockableMap";

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

  it("preserves canonical and public ids when the registry key differs from the public context id", () => {
    const serializer = {
      stringify: (value: unknown) => JSON.stringify(value),
    } as any;
    const context = {
      id: "ctx.public",
      use: () => ({ ok: true }),
      serialize: (value: unknown) => JSON.stringify(value),
    } as any;

    const header = buildAsyncContextHeader({
      allowList: ["app.asyncContexts.ctx.public"],
      registry: new Map([["app.asyncContexts.ctx.public", context]]),
      serializer,
    });

    expect(JSON.parse(header!)).toEqual({
      "app.asyncContexts.ctx.public": JSON.stringify({ ok: true }),
      "ctx.public": JSON.stringify({ ok: true }),
    });
  });

  it("does not resolve allowlist ids by suffix matching", () => {
    const registry = new Map([
      ["app.asyncContexts.trace", { id: "app.asyncContexts.trace" }],
      ["app.asyncContexts.auth", { id: "app.asyncContexts.auth" }],
      ["other.asyncContexts.trace", { id: "other.asyncContexts.trace" }],
    ]);

    expect(resolveRegistryAsyncContextIds(registry as any, ["auth"])).toEqual([
      "auth",
    ]);
    expect(resolveRegistryAsyncContextIds(registry as any, ["trace"])).toEqual([
      "trace",
    ]);
  });

  it("resolves allowlist ids against actual stored keys when lookup aliases exist", () => {
    const registry = new LockableMap<string, { id: string }>("asyncContexts");
    registry.set("app.asyncContexts.trace", {
      id: "trace",
    });
    registry.setLookupResolver((requestedId) =>
      requestedId === "trace" ? "app.asyncContexts.trace" : undefined,
    );

    expect(resolveRegistryAsyncContextIds(registry as any, ["trace"])).toEqual([
      "app.asyncContexts.trace",
    ]);
  });

  it("falls back to requested ids when alias lookup cannot be mapped back to a stored key", () => {
    const resolvedContext = {
      id: "trace",
    };
    const registry = {
      keys: function* () {
        yield "app.asyncContexts.other";
      },
      get: (id: string) =>
        id === "trace"
          ? resolvedContext
          : id === "app.asyncContexts.other"
            ? { id: "other" }
            : undefined,
    };

    expect(resolveRegistryAsyncContextIds(registry as any, ["trace"])).toEqual([
      "trace",
    ]);
  });

  it("hydrates serialized async contexts while tolerating malformed input", async () => {
    const serializer = {
      stringify: (value: unknown) => JSON.stringify(value),
      parse: (value: string) => JSON.parse(value),
    } as any;
    const provide = jest.fn(
      async (_value: unknown, fn: () => Promise<unknown>) => await fn(),
    );
    const context = {
      id: "ctx.allowed",
      parse: (value: string) => JSON.parse(value),
      provide,
    } as any;
    const blockedProvide = jest.fn();
    const blockedContext = {
      id: "ctx.blocked",
      parse: (value: string) => JSON.parse(value),
      provide: blockedProvide,
    } as any;
    const registry = new Map([
      [context.id, context],
      [blockedContext.id, blockedContext],
    ]);

    const result = await withSerializedAsyncContexts({
      serializedContexts: JSON.stringify({
        [context.id]: JSON.stringify({ value: "A" }),
        [blockedContext.id]: JSON.stringify({ value: "B" }),
      }),
      registry,
      serializer,
      fn: async () => "ok",
      allowedAsyncContextIds: [context.id],
    });

    expect(result).toBe("ok");
    expect(provide).toHaveBeenCalledTimes(1);
    expect(blockedProvide).not.toHaveBeenCalled();

    await expect(
      withSerializedAsyncContexts({
        serializedContexts: "{bad-json}",
        registry,
        serializer,
        fn: async () => "fallback",
      }),
    ).resolves.toBe("fallback");
  });

  it("rehydrates real async contexts when allowed ids are present", async () => {
    const context = r
      .asyncContext<{ value: string }>("tests-allowlist-real-context")
      .build();
    const serializer = {
      parse: (value: string) => JSON.parse(value),
    } as any;

    const result = await withSerializedAsyncContexts({
      serializedContexts: JSON.stringify({
        [context.id]: context.serialize({ value: "A" }),
      }),
      registry: new Map([[context.id, context]]) as any,
      serializer,
      fn: async () => context.use().value,
      allowedAsyncContextIds: [context.id],
    });

    expect(result).toBe("A");
  });

  it("keeps hydrated contexts visible through EventManager listener execution", async () => {
    const context = r
      .asyncContext<{ value: string }>("tests-allowlist-event-manager-context")
      .build();
    const event = r.event("tests-allowlist-event-manager-event").build();
    const eventManager = new EventManager();
    const serializer = {
      parse: (value: string) => JSON.parse(value),
    } as any;
    let seen = "missing";

    eventManager.addListener(event, async () => {
      seen = context.use().value;
    });

    await withSerializedAsyncContexts({
      serializedContexts: JSON.stringify({
        [context.id]: context.serialize({ value: "A" }),
        ["app.asyncContexts.tests-allowlist-event-manager-context"]:
          context.serialize({ value: "A" }),
      }),
      registry: new Map([
        ["app.asyncContexts.tests-allowlist-event-manager-context", context],
      ]) as any,
      serializer,
      fn: async () =>
        await eventManager.emit(
          event,
          undefined,
          runtimeSource.runtime("test"),
        ),
      allowedAsyncContextIds: [
        "app.asyncContexts.tests-allowlist-event-manager-context",
      ],
    });

    expect(seen).toBe("A");
  });
});
