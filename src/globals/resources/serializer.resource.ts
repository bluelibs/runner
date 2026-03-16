import { defineResource } from "../../definers/defineResource";
import type { SerializerLike as Serializer } from "../../serializer";
import { globalTags } from "../globalTags";

export const serializerResource = defineResource<void, Promise<Serializer>>({
  id: "serializer",
  meta: {
    title: "Serializer",
    description:
      "Serializes and deserializes data. Supports stringify/parse and custom type registration via addType.",
  },
  tags: [globalTags.system],
});
