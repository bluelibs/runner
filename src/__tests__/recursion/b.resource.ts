import { defineResource } from "../../define";
import { cResource } from "./c.resource";

export const bResource = defineResource({
  id: "b.resource",
  dependencies: {
    c: cResource,
  },
  async init(_, { c }) {
    // @ts-expect-error
    const result2: number = c;
    return `B depends on ${c}`;
  },
});
export const b1Resource = defineResource({
  id: "b.resource",
  dependencies: {
    c: cResource,
  },
  async init(_, { c: _c }) {
    return 123;
  },
});
export const b2Resource = defineResource({
  id: "b.resource",
  dependencies: {
    c: cResource,
  },
  async init(_, { c: _c }) {
    return true;
  },
});
