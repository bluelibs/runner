import { override, r } from "../../..";
import {
  defineResource,
  defineTag,
  defineTask,
  defineTaskMiddleware,
} from "../../../define";

// Type-only tests for strict overrides and tags.

// Scenario: override(base, patch) is no longer supported.
{
  const task = defineTask({
    id: "task",
    run: async () => "Task executed",
  });

  // @ts-expect-error patch-form override is removed from the public API
  override(task, {
    run: async () => "Task overridden",
  });

  const validOverride = r.override(task, async () => "Task overridden");

  defineResource({
    id: "resource.valid.override",
    register: [task],
    overrides: [validOverride],
    init: async () => "ok",
  });

  const rawSameIdTask = defineTask({
    id: "task",
    run: async () => "raw",
  });

  defineResource({
    id: "resource.invalid.override.raw.task",
    register: [task],
    overrides: [
      // @ts-expect-error .overrides([...]) accepts only override-produced definitions
      rawSameIdTask,
    ],
    init: async () => "ok",
  });

  const baseConfigResource = defineResource<{ name: string }, Promise<string>>({
    id: "resource.with.config.base",
    init: async (config) => config.name,
  });

  const validConfigOverride = r.override(
    baseConfigResource,
    async (config) => `override:${config.name}`,
  );

  defineResource({
    id: "resource.valid.override.with.config",
    register: [baseConfigResource.with({ name: "base" })],
    overrides: [validConfigOverride.with({ name: "ok" })],
    init: async () => "ok",
  });
}

// Scenario: tag usage should enforce payload contracts and task tag compatibility.
{
  const tag = defineTag({ id: "tag" });
  const tag2 = defineTag<{ value: number }>({ id: "tag2" });
  const tag2optional = defineTag<{ value?: number }>({ id: "tag2" });
  const tag3 = tag2.with({ value: 123 });

  // @ts-expect-error
  tag.with({ value: 123 });

  defineTaskMiddleware({
    id: "middleware",
    run: async () => "Middleware executed",
  });

  defineTask({
    id: "task.tagged",
    tags: [
      tag,
      // @ts-expect-error
      tag2,
      tag2optional,
      tag2.with({ value: 123 }),
      // @ts-expect-error
      tag2.with({ value: "123" }),
      tag3,
    ],
    meta: {},
    run: async (input) => {
      return input;
    },
  });
}
