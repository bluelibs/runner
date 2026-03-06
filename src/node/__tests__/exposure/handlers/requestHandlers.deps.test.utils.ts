type AnyRecord = Record<string, unknown>;

export function createRequestHandlersDeps(
  serializer: {
    stringify: (value: unknown) => string;
    parse: <T>(text: string) => T;
  },
  overrides: AnyRecord = {},
): any {
  const base: any = {
    store: {
      tasks: new Map(),
      events: new Map(),
      errors: new Map(),
      asyncContexts: new Map(),
      resolveDefinitionId: (reference: unknown) =>
        typeof reference === "string"
          ? reference
          : (reference as { id?: string })?.id,
      toPublicId: (reference: unknown) =>
        typeof reference === "string"
          ? reference
          : ((reference as { id?: string })?.id ?? String(reference)),
    },
    taskRunner: { run: async () => undefined },
    eventManager: {
      emit: async () => undefined,
      emitWithResult: async () => undefined,
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    authenticator: async () => ({ ok: true }),
    allowList: { ensureTask: () => null, ensureEvent: () => null },
    router: {
      basePath: "/api",
      extract: () => null,
      isUnderBase: () => true,
    },
    cors: undefined,
    serializer,
  };

  return {
    ...base,
    ...overrides,
    store: { ...base.store, ...(overrides as any).store },
    taskRunner: { ...base.taskRunner, ...(overrides as any).taskRunner },
    eventManager: { ...base.eventManager, ...(overrides as any).eventManager },
    logger: { ...base.logger, ...(overrides as any).logger },
    allowList: { ...base.allowList, ...(overrides as any).allowList },
    router: { ...base.router, ...(overrides as any).router },
  };
}
