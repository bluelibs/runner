import { defineResource } from "../../definers/defineResource";
import { markFrameworkDefinition } from "../../definers/markFrameworkDefinition";
import type { Store } from "../../models/Store";
import { globalTags } from "../globalTags";

export const storeResource = defineResource<void, Promise<Store>>(
  markFrameworkDefinition({
    id: "system.store",
    meta: {
      title: "Store",
      description:
        "A global store that can be used to store and retrieve tasks, resources, events and middleware",
    },
    tags: [globalTags.system],
  }),
);
