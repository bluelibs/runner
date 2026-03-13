import { defineResource } from "../../define";
import { aTask } from "./a.resource";
import { b1Resource, b2Resource } from "./b.resource";

const value = Math.random() > 0.5 ? b1Resource : b2Resource;

export const cResource = defineResource({
  id: "c-resource",
  dependencies: {
    aTask,
  },
  async init(_, { aTask }) {
    const result: string = await aTask(); // Still benefits of autocompletion
    return `C depends on ${result}`;
  },
}); // This is the key change.
