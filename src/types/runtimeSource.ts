export const RuntimeCallSourceKind = {
  Runtime: "runtime",
  Resource: "resource",
  Task: "task",
  Hook: "hook",
  Middleware: "middleware",
} as const;

export type RuntimeCallSourceKind =
  (typeof RuntimeCallSourceKind)[keyof typeof RuntimeCallSourceKind];

export type RuntimeCallSource = {
  kind: RuntimeCallSourceKind;
  id: string;
  path?: string;
};

export const runtimeSource = {
  runtime(id: string, path: string = id): RuntimeCallSource {
    return {
      kind: RuntimeCallSourceKind.Runtime,
      id,
      path,
    };
  },
  resource(id: string, path: string = id): RuntimeCallSource {
    return {
      kind: RuntimeCallSourceKind.Resource,
      id,
      path,
    };
  },
  task(id: string, path: string = id): RuntimeCallSource {
    return {
      kind: RuntimeCallSourceKind.Task,
      id,
      path,
    };
  },
  hook(id: string, path: string = id): RuntimeCallSource {
    return {
      kind: RuntimeCallSourceKind.Hook,
      id,
      path,
    };
  },
  middleware(id: string, path: string = id): RuntimeCallSource {
    return {
      kind: RuntimeCallSourceKind.Middleware,
      id,
      path,
    };
  },
} as const;
