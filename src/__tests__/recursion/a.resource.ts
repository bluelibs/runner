import { defineResource, defineTask } from "../../define";
import { bResource } from "./b.resource";

export const aResource = defineResource({
  id: "a.resource",
  dependencies: {
    b: bResource,
  },
  async init(_, { b }) {
    const result: string = b;
    // @ts-expect-error
    const result2: number = b;
    return `A depends on ${b}`;
  },
});

export const aTask = defineTask({
  id: "a.task",
  dependencies: {
    a: aResource,
  },
  async run(_, { a }) {
    return `Task A executed with dependency: ${a}`;
  },
});
