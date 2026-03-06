import { defineFrameworkResource } from "../../definers/frameworkDefinition";
import type { SerializerLike as Serializer } from "../../serializer";
import { globalTags } from "../globalTags";

export const serializerResource = defineFrameworkResource<
  void,
  Promise<Serializer>
>({
  id: "runner.serializer",
  meta: {
    title: "Serializer",
    description:
      "Serializes and deserializes data. Supports stringify/parse and custom type registration via addType.",
  },
  tags: [globalTags.system],
});
