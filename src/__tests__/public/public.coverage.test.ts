import {
  Errors,
  Match,
  defineAsyncContext,
  defineEvent,
  defineEventLane,
  defineHook,
  defineResource,
  defineResourceMiddleware,
  defineRpcLane,
  defineTag,
  defineTask,
  defineTaskMiddleware,
  isAsyncContext,
  isError,
  isEvent,
  isEventLane,
  isHook,
  isIsolationScope,
  isOptional,
  isOverrideDefinition,
  isResource,
  isResourceMiddleware,
  isResourceWithConfig,
  isRpcLane,
  isSubtreeFilter,
  isTag,
  isTagStartup,
  isTask,
  isTaskMiddleware,
  errors,
  r,
  scope,
  subtreeOf,
  asyncContexts,
} from "../../public";
import { defineError } from "../../definers/defineError";

describe("public barrel coverage", () => {
  it("exposes callable guards for public definition types", () => {
    const task = defineTask({
      id: "public-coverage-task",
      run: async () => "ok",
    });
    const resource = defineResource<{ enabled: boolean }>({
      id: "public-coverage-resource",
      init: async (config) => config.enabled,
    });
    const event = defineEvent({
      id: "public-coverage-event",
    });
    const eventLane = defineEventLane({
      id: "public-coverage-event-lane",
    });
    const rpcLane = defineRpcLane({
      id: "public-coverage-rpc-lane",
    });
    const hook = defineHook({
      id: "public-coverage-hook",
      on: event,
      run: async () => undefined,
    });
    const taskMiddleware = defineTaskMiddleware({
      id: "public-coverage-task-middleware",
      run: async ({ next, task: currentTask }) => next(currentTask.input),
    });
    const resourceMiddleware = defineResourceMiddleware({
      id: "public-coverage-resource-middleware",
      run: async ({ next }) => next(),
    });
    const tag = defineTag<{ scope: string }>({
      id: "public-coverage-tag",
    });
    const typedError = defineError({
      id: "public-coverage-error",
      format: () => "boom",
    });
    const asyncContext = defineAsyncContext<{ requestId: string }>({
      id: "public-coverage-async-context",
    });
    const override = r.override(task, async () => "override");
    const filter = subtreeOf(resource);
    const scoped = scope(task);

    expect(isTask(task)).toBe(true);
    expect(isResource(resource)).toBe(true);
    expect(isResourceWithConfig(resource.with({ enabled: true }))).toBe(true);
    expect(isEvent(event)).toBe(true);
    expect(isEventLane(eventLane)).toBe(true);
    expect(isRpcLane(rpcLane)).toBe(true);
    expect(isHook(hook)).toBe(true);
    expect(isTaskMiddleware(taskMiddleware)).toBe(true);
    expect(isResourceMiddleware(resourceMiddleware)).toBe(true);
    expect(isTag(tag)).toBe(true);
    expect(isTagStartup(tag.startup())).toBe(true);
    expect(isOptional(task.optional())).toBe(true);
    expect(isError(typedError)).toBe(true);
    expect(isAsyncContext(asyncContext)).toBe(true);
    expect(isOverrideDefinition(override)).toBe(true);
    expect(isSubtreeFilter(filter)).toBe(true);
    expect(isIsolationScope(scoped)).toBe(true);
    expect(asyncContexts.execution.id).toBe("asyncContexts.execution");
    expect(errors.matchError.id).toBe("runner.errors.matchError");
    expect(Errors.matchError.id).toBe("runner.errors.matchError");
    expect("Error" in (Match as Record<string, unknown>)).toBe(false);
    expect(isTask({ id: "plain-object" })).toBe(false);
  });
});
