import { defineResource } from "../../definers/defineResource";
import type { Store } from "../../models/Store";
import { globalTags } from "../globalTags";

export const storeResource = defineResource<void, Promise<Store>>({
  id: "store",
  meta: {
    title: "Store",
    description:
      "A global store that can be used to store and retrieve tasks, resources, events and middleware",
  },
  tags: [globalTags.system],
});
