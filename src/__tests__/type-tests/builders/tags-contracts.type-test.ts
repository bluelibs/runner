import { r } from "../../../";
import type { TagType } from "../../../";

// Type-only tests for builder tags and contract enforcement.

// Scenario: builder tags should enforce payload compatibility.
{
  const tag = r.tag("tag").build();
  const tag2 = r.tag<{ value: number }>("tag2").build();
  const tag2optional = r.tag<{ value?: number }>("tag2").build();
  const tag3 = tag2.with({ value: 123 });

  r.task("task")
    .tags([
      tag,
      // @ts-expect-error
      tag2,
      tag2optional,
      tag2.with({ value: 123 }),
      // @ts-expect-error
      tag2.with({ value: "123" }),
      tag3,
    ])
    .meta({} as Record<string, any>)
    .run(async (input) => {
      return input;
    })
    .build();
}

// Scenario: builder task/resource contracts should be inferred from tags.
{
  interface IUser {
    name: string;
  }

  interface IOther {
    age: number;
  }

  const tag = r.tag<{ value: number }, void, IUser>("tag").build();
  const tag2 = r.tag<void, void, IOther>("tag2").build();
  const tag3WithInputContract = r
    .tag<void, { a: string }, void>("tag3")
    .build();

  const tags = [tag.with({ value: 123 }), tag2] satisfies TagType[];

  r.task("task")
    .tags(tags)
    .inputSchema<{ name: string }>({ parse: (x: any) => x })
    // @ts-expect-error ensure result contract is enforced
    .run(async (input: { name: string }) => {
      return {
        age: 123,
      };
    })
    .build();

  r.task("task2")
    .tags(tags)
    // @ts-expect-error invalid result contract
    .run(async (input: { name: string }) => {
      return {
        age: "123",
      };
    })
    .build();

  r.task("task3")
    .tags(tags)
    // @ts-expect-error invalid result contract
    .run(async (input: { name: string }) => {
      return {};
    })
    .build();

  r.task("task4")
    .tags([tag3WithInputContract])
    .run(async (input) => {
      input.a;
      // @ts-expect-error
      input.b;
      return {
        age: 123,
        name: "123",
      };
    })
    .build();

  r.resource("resource")
    .tags([tag3WithInputContract])
    .init(async (config) => {
      config.a;
      // @ts-expect-error
      config.b;
    })
    .build();

  r.resource<{ a: string }>("resource5")
    .init(async (config) => {
      config.a;
      // @ts-expect-error
      config.b;
    })
    .build();

  r.resource("resource6")
    .init(async (config: { a: string }) => {
      config.a;
      // @ts-expect-error
      config.b;
    })
    .build();
}
