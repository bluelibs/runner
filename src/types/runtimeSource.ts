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
};

export const runtimeSource = {
  runtime(id: string): RuntimeCallSource {
    return { kind: RuntimeCallSourceKind.Runtime, id };
  },
  resource(id: string): RuntimeCallSource {
    return { kind: RuntimeCallSourceKind.Resource, id };
  },
  task(id: string): RuntimeCallSource {
    return { kind: RuntimeCallSourceKind.Task, id };
  },
  hook(id: string): RuntimeCallSource {
    return { kind: RuntimeCallSourceKind.Hook, id };
  },
  middleware(id: string): RuntimeCallSource {
    return { kind: RuntimeCallSourceKind.Middleware, id };
  },
} as const;
