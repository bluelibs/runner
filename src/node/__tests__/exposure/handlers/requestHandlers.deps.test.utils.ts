import {
  createMockRuntimeSource,
  resolveMockDefinitionId,
} from "../../../../__tests__/test-utils/createMockRuntimeSource";

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
      hasDefinition(reference: unknown) {
        const resolved = resolveMockDefinitionId(reference);
        return typeof resolved === "string" && this.hasId(resolved);
      },
      hasId(id: string) {
        return (
          this.tasks.has(id) ||
          this.events.has(id) ||
          this.errors.has(id) ||
          this.asyncContexts.has(id)
        );
      },
      findIdByDefinition(reference: unknown) {
        return resolveMockDefinitionId(reference) ?? String(reference);
      },
      createRuntimeSource: createMockRuntimeSource,
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
