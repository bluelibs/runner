import { defineResource, defineTask } from "../../define";
import { bResource } from "./b.resource";

export const aResource = defineResource({
  id: "a-resource",
  dependencies: {
    b: bResource,
  },
  async init(_, { b }) {
    // @ts-expect-error
    const result2: number = b;
    return `A depends on ${b}`;
  },
});

export const aTask = defineTask({
  id: "a-task",
  async run(_, { a: _a }) {
    return `Task A executed`;
  },
});
