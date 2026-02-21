import { r } from "../..";
import {
  defineEvent,
  defineResource,
  defineResourceMiddleware,
  defineTag,
  defineTask,
  defineTaskMiddleware,
} from "../../define";

const isObjectLike = (value: unknown): value is object | Function =>
  (typeof value === "object" && value !== null) || typeof value === "function";

function expectDeepFrozen(value: unknown, seen = new WeakSet<object>()): void {
  if (!isObjectLike(value)) {
    return;
  }

  const objectValue = value as object;
  if (seen.has(objectValue)) {
    return;
  }
  seen.add(objectValue);

  expect(Object.isFrozen(objectValue)).toBe(true);

  for (const key of Reflect.ownKeys(objectValue)) {
    const descriptor = Object.getOwnPropertyDescriptor(objectValue, key);
    if (!descriptor) {
      continue;
    }
    if ("value" in descriptor) {
      expectDeepFrozen(descriptor.value, seen);
      continue;
    }
    if (descriptor.get) {
      expectDeepFrozen(descriptor.get, seen);
    }
    if (descriptor.set) {
      expectDeepFrozen(descriptor.set, seen);
    }
  }
}

describe("Build lockdown", () => {
  it("deep-freezes fluent .build() outputs", () => {
    const lockTag = r.tag("tests.lock.tag").build();
    const lockTagWithConfig = r
      .tag<{ nested?: { values: number[] } }>("tests.lock.tag.config")
      .config({ nested: { values: [1, 2, 3] } })
      .build();

    const lockTaskMiddleware = r.middleware
      .task("tests.lock.task.middleware")
      .tags([lockTag])
      .run(async ({ next, task }) => next(task.input))
      .build();

    const lockResourceMiddleware = r.middleware
      .resource("tests.lock.resource.middleware")
      .tags([lockTag])
      .run(async ({ next }) => next())
      .build();

    const lockEvent = r.event("tests.lock.event").tags([lockTag]).build();

    const lockHook = r
      .hook("tests.lock.hook")
      .on(lockEvent)
      .tags([lockTag])
      .run(async () => {})
      .build();

    const lockTask = r
      .task("tests.lock.task")
      .tags([lockTag])
      .middleware([lockTaskMiddleware])
      .run(async () => "ok")
      .build();

    const lockResource = r
      .resource("tests.lock.resource")
      .tags([lockTag])
      .middleware([lockResourceMiddleware])
      .register([lockTask, lockHook, lockEvent])
      .build();

    const lockError = r
      .error<{ code: string }>("tests.lock.error")
      .tags([lockTag])
      .meta({ title: "lock" })
      .build();

    const lockContext = r
      .asyncContext<{ requestId: string }>("tests.lock.context")
      .build();

    expectDeepFrozen(lockTag);
    expectDeepFrozen(lockTagWithConfig);
    expectDeepFrozen(lockTaskMiddleware);
    expectDeepFrozen(lockResourceMiddleware);
    expectDeepFrozen(lockEvent);
    expectDeepFrozen(lockHook);
    expectDeepFrozen(lockTask);
    expectDeepFrozen(lockResource);
    expectDeepFrozen(lockError);
    expectDeepFrozen(lockContext);
  });

  it("freezes derived objects when source lineage is locked", () => {
    const lockTag = r.tag<{ mode: string }>("tests.lock.derived.tag").build();
    const lockTagUsage = lockTag.with({ mode: "secure" });

    const lockTask = r
      .task("tests.lock.derived.task")
      .run(async () => "ok")
      .build();
    const lockTaskOptional = lockTask.optional();

    const lockEvent = r.event("tests.lock.derived.event").build();
    const lockEventOptional = lockEvent.optional();

    const lockTaskMiddleware = r.middleware
      .task<{ mode: string }, void, void>("tests.lock.derived.tmw")
      .run(async ({ next, task }) => next(task.input))
      .build();
    const lockTaskMiddlewareUsage = lockTaskMiddleware.with({ mode: "strict" });

    const lockResourceMiddleware = r.middleware
      .resource<{ mode: string }, void, void>("tests.lock.derived.rmw")
      .run(async ({ next }) => next())
      .build();
    const lockResourceMiddlewareUsage = lockResourceMiddleware.with({
      mode: "strict",
    });

    const lockResource = r
      .resource<{ nested: { enabled: boolean } }>("tests.lock.derived.resource")
      .build();
    const lockResourceUsage = lockResource.with({ nested: { enabled: true } });
    const lockResourceOptional = lockResource.optional();
    const lockResourceFork = lockResource.fork(
      "tests.lock.derived.resource.fork",
    );

    const lockError = r
      .error<{ reason: string }>("tests.lock.derived.error")
      .build();
    const lockErrorOptional = lockError.optional();

    const lockContext = r
      .asyncContext<{ requestId: string }>("tests.lock.derived.context")
      .build();
    const lockContextOptional = lockContext.optional();

    const lockOverrideShorthand = r.override(lockTask, async () => "override");
    const lockOverrideBuilder = r
      .override(lockTask)
      .run(async () => "override-builder")
      .build();

    expectDeepFrozen(lockTagUsage);
    expectDeepFrozen(lockTaskOptional);
    expectDeepFrozen(lockEventOptional);
    expectDeepFrozen(lockTaskMiddlewareUsage);
    expectDeepFrozen(lockResourceMiddlewareUsage);
    expectDeepFrozen(lockResourceUsage);
    expectDeepFrozen(lockResourceOptional);
    expectDeepFrozen(lockResourceFork);
    expectDeepFrozen(lockErrorOptional);
    expectDeepFrozen(lockContextOptional);
    expectDeepFrozen(lockOverrideShorthand);
    expectDeepFrozen(lockOverrideBuilder);
  });

  it("keeps direct define outputs mutable for compatibility", () => {
    const directTag = defineTag<{ mode?: string }>({
      id: "tests.lock.direct.tag",
      config: {},
    });
    const directTask = defineTask({
      id: "tests.lock.direct.task",
      run: async () => "ok",
    });
    const directEvent = defineEvent({
      id: "tests.lock.direct.event",
      tags: [],
    });
    const directResource = defineResource({
      id: "tests.lock.direct.resource",
    });
    const directTaskMiddleware = defineTaskMiddleware({
      id: "tests.lock.direct.tmw",
      run: async (input: any) => input.next(input.task.input),
    });
    const directResourceMiddleware = defineResourceMiddleware({
      id: "tests.lock.direct.rmw",
      run: async (input: any) => input.next(),
    });

    const directTagUsage = directTag.with({ mode: "legacy" });
    const directTaskOptional = directTask.optional();
    const directEventOptional = directEvent.optional();
    const directResourceUsage = directResource.with(undefined);
    const directResourceOptional = directResource.optional();
    const directResourceFork = directResource.fork(
      "tests.lock.direct.resource.fork",
    );
    const directTaskMiddlewareUsage = directTaskMiddleware.with({});
    const directResourceMiddlewareUsage = directResourceMiddleware.with({});
    const directOverrideShorthand = r.override(
      directTask,
      async () => "patched",
    );

    expect(Object.isFrozen(directTag)).toBe(false);
    expect(Object.isFrozen(directTask)).toBe(false);
    expect(Object.isFrozen(directEvent)).toBe(false);
    expect(Object.isFrozen(directResource)).toBe(false);
    expect(Object.isFrozen(directTaskMiddleware)).toBe(false);
    expect(Object.isFrozen(directResourceMiddleware)).toBe(false);

    expect(Object.isFrozen(directTagUsage)).toBe(false);
    expect(Object.isFrozen(directTaskOptional)).toBe(false);
    expect(Object.isFrozen(directEventOptional)).toBe(false);
    expect(Object.isFrozen(directResourceUsage)).toBe(false);
    expect(Object.isFrozen(directResourceOptional)).toBe(false);
    expect(Object.isFrozen(directResourceFork)).toBe(false);
    expect(Object.isFrozen(directTaskMiddlewareUsage)).toBe(false);
    expect(Object.isFrozen(directResourceMiddlewareUsage)).toBe(false);
    expect(Object.isFrozen(directOverrideShorthand)).toBe(false);
  });

  it("always freezes fluent override builder outputs, even with mutable base", () => {
    const directTask = defineTask({
      id: "tests.lock.override.builder.base",
      run: async () => "base",
    });

    const builtOverride = r
      .override(directTask)
      .run(async () => "override")
      .build();

    expectDeepFrozen(builtOverride);
  });
});
