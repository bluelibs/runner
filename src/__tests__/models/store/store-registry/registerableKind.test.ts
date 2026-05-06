import {
  defineEvent,
  defineHook,
  defineResource,
  defineResourceMiddleware,
  defineTag,
  defineTask,
  defineTaskMiddleware,
} from "../../../../define";
import { defineAsyncContext } from "../../../../definers/defineAsyncContext";
import { defineError } from "../../../../definers/defineError";
import {
  describeRegisterableKind,
  RegisterableKind,
  resolveRegisterableKind,
} from "../../../../models/store/store-registry/registerableKind";

describe("registerableKind", () => {
  it("classifies every supported registerable kind", () => {
    const task = defineTask({
      id: "kind-task",
      run: async () => "ok",
    });
    const error = defineError({
      id: "kind-error",
      format: () => "boom",
    });
    const event = defineEvent({
      id: "kind-event",
    });
    const hook = defineHook({
      id: "kind-hook",
      on: event,
      run: async () => undefined,
    });
    const resource = defineResource({
      id: "kind-resource",
    });
    const asyncContext = defineAsyncContext<{ requestId: string }>({
      id: "kind-async-context",
    });
    const taskMiddleware = defineTaskMiddleware({
      id: "kind-task-middleware",
      run: async ({ next }) => next(),
    });
    const resourceMiddleware = defineResourceMiddleware({
      id: "kind-resource-middleware",
      run: async ({ next }) => next(),
    });
    const resourceWithConfig = defineResource<{ enabled: boolean }>({
      id: "kind-configured-resource",
      configSchema: { enabled: Boolean },
    }).with({ enabled: true });
    const tag = defineTag({
      id: "kind-tag",
    });

    expect(resolveRegisterableKind(task)).toBe(RegisterableKind.Task);
    expect(resolveRegisterableKind(error)).toBe(RegisterableKind.Error);
    expect(resolveRegisterableKind(hook)).toBe(RegisterableKind.Hook);
    expect(resolveRegisterableKind(resource)).toBe(RegisterableKind.Resource);
    expect(resolveRegisterableKind(event)).toBe(RegisterableKind.Event);
    expect(resolveRegisterableKind(asyncContext)).toBe(
      RegisterableKind.AsyncContext,
    );
    expect(resolveRegisterableKind(taskMiddleware)).toBe(
      RegisterableKind.TaskMiddleware,
    );
    expect(resolveRegisterableKind(resourceMiddleware)).toBe(
      RegisterableKind.ResourceMiddleware,
    );
    expect(resolveRegisterableKind(resourceWithConfig)).toBe(
      RegisterableKind.ResourceWithConfig,
    );
    expect(resolveRegisterableKind(tag)).toBe(RegisterableKind.Tag);
  });

  it("returns stable labels for every registerable kind and unknown values", () => {
    expect(describeRegisterableKind(RegisterableKind.Task)).toBe("Task");
    expect(describeRegisterableKind(RegisterableKind.Error)).toBe("Error");
    expect(describeRegisterableKind(RegisterableKind.Hook)).toBe("Hook");
    expect(describeRegisterableKind(RegisterableKind.Resource)).toBe(
      "Resource",
    );
    expect(describeRegisterableKind(RegisterableKind.Event)).toBe("Event");
    expect(describeRegisterableKind(RegisterableKind.AsyncContext)).toBe(
      "Async context",
    );
    expect(describeRegisterableKind(RegisterableKind.TaskMiddleware)).toBe(
      "Task middleware",
    );
    expect(describeRegisterableKind(RegisterableKind.ResourceMiddleware)).toBe(
      "Resource middleware",
    );
    expect(describeRegisterableKind(RegisterableKind.ResourceWithConfig)).toBe(
      "Resource",
    );
    expect(describeRegisterableKind(RegisterableKind.Tag)).toBe("Tag");
    expect(describeRegisterableKind(null)).toBe("Unknown registration");
    expect(resolveRegisterableKind(null as never)).toBe(null);
    expect(resolveRegisterableKind(undefined as never)).toBe(null);
    expect(resolveRegisterableKind("not-a-definition" as never)).toBe(null);
  });
});
