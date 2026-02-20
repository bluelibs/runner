import { defineResource } from "../../define";
import { IResource } from "../../defs";
import { aTask } from "./a.resource";
import { b1Resource, b2Resource } from "./b.resource";

const value = Math.random() > 0.5 ? b1Resource : b2Resource;

export const cResource = defineResource({
  id: "c.resource",
  dependencies: {
    aTask,
    customResource: value,
  },
  async init(_, { aTask, customResource: _customResource }) {
    const result: string = await aTask(); // Still benefits of autocompletion
    return `C depends on ${result}`;
  },
}) as IResource<void, Promise<string>>; // This is the key change.
