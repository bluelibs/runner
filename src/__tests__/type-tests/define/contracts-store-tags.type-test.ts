import { defineResource, defineTag, defineTask } from "../../../define";
import type { TagType } from "../../../defs";
import type { Store } from "../../../models/Store";

// Type-only tests for contract enforcement via tags and store tagged lookups.

// Scenario: tasks/resources should enforce tag-derived contracts.
{
  interface IUser {
    name: string;
  }

  interface IOther {
    age: number;
  }

  const tag = defineTag<{ value: number }, void, IUser>({ id: "tag" });
  const tag2 = defineTag<void, void, IOther>({ id: "tag2" });
  const tag3WithInputContract = defineTag<void, { a: string }, void>({
    id: "tag3",
  });

  const tags = [tag.with({ value: 123 }), tag2] satisfies TagType[];

  defineTask({
    id: "task",
    tags,
    run: async (input: { name: string }) => {
      return {
        age: 123,
        name: "123",
      };
    },
  });

  defineTask({
    id: "task",
    tags,
    // @ts-expect-error
    run: async (input: { name: string }) => {
      return {
        age: "123",
      };
    },
  });

  defineTask({
    id: "task",
    tags,
    // @ts-expect-error
    run: async (input: { name: string }) => {
      return {};
    },
  });

  defineTask({
    id: "task",
    tags: [tag3WithInputContract],
    run: async (input) => {
      input.a;
      // @ts-expect-error
      input.b;
      return {
        age: 123,
        name: "123",
      };
    },
  });

  defineResource({
    id: "resource",
    tags: [tag3WithInputContract],
    init: async (input) => {
      input.a;
      // @ts-expect-error
      input.b;
    },
  });

  const resourceTag = defineTag<void, void, { name: string }>({
    id: "resource.tag",
  });

  defineResource({
    id: "resource.user",
    tags: [resourceTag],
    // @ts-expect-error should throw invalid because of missing name as response resource contract
    init: async () => {
      return {
        name1: "123",
      };
    },
  });
}

// Scenario: resources should enforce response contracts derived from tags.
{
  interface IUser {
    name: string;
  }

  interface IOther {
    age: number;
  }

  const tag = defineTag<{ value: number }, void, IUser>({ id: "tag" });
  const tag2 = defineTag<void, void, IOther>({ id: "tag2" });

  const tags = [tag.with({ value: 123 }), tag2] satisfies TagType[];

  defineResource({
    id: "resource.ok",
    tags,
    init: async () => {
      return {
        age: 123,
        name: "123",
      };
    },
  });

  defineResource({
    id: "resource.bad1",
    tags,
    // @ts-expect-error
    init: async () => {
      return {
        age: "123",
        name: "123",
      };
    },
  });

  defineResource({
    id: "resource.bad2",
    tags,
    // @ts-expect-error
    init: async () => {
      return {};
    },
  });
}

// Scenario: store tag lookup methods should preserve contract-based task/resource signatures.
{
  const store = null as unknown as Store;

  const contractTag = defineTag<void, { tenantId: string }, { ok: boolean }>({
    id: "types.tag.contract",
  });

  const taggedTasks = store.getTasksWithTag(contractTag);
  const taggedResources = store.getResourcesWithTag(contractTag);
  const firstTask = taggedTasks[0]!;
  const firstResource = taggedResources[0]!;

  type TaskInput = Parameters<typeof firstTask.run>[0];
  const validTaskInput: TaskInput = { tenantId: "acme" };
  // @ts-expect-error invalid task contract input
  const invalidTaskInput: TaskInput = { nope: "x" };
  void validTaskInput;
  void invalidTaskInput;

  type TaskOutput = Awaited<ReturnType<typeof firstTask.run>>;
  const validTaskOutput: TaskOutput = { ok: true };
  // @ts-expect-error invalid task contract output
  const invalidTaskOutput: TaskOutput = { nope: true };
  void validTaskOutput;
  void invalidTaskOutput;

  type ResourceInit = NonNullable<typeof firstResource.init>;
  type ResourceConfig = Parameters<ResourceInit>[0];
  const validResourceConfig: ResourceConfig = { tenantId: "acme" };
  // @ts-expect-error invalid resource contract config
  const invalidResourceConfig: ResourceConfig = { nope: "x" };
  void validResourceConfig;
  void invalidResourceConfig;

  type ResourceValue = Awaited<ReturnType<ResourceInit>>;
  const validResourceValue: ResourceValue = { ok: true };
  // @ts-expect-error invalid resource contract value
  const invalidResourceValue: ResourceValue = { nope: true };
  void validResourceValue;
  void invalidResourceValue;
}
