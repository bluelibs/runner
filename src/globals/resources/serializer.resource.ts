import { defineResource } from "../../definers/defineResource";
import { Serializer } from "../../serializer";
import { Match } from "../../tools/check";

const serializerResourceConfigPattern = Match.ObjectIncluding({
  pretty: Match.Optional(Boolean),
  maxDepth: Match.Optional(Number),
  allowedTypes: Match.Optional(Match.ArrayOf(String)),
  symbolPolicy: Match.Optional(
    Match.OneOf("allow-all", "well-known-only", "disabled"),
  ),
  maxRegExpPatternLength: Match.Optional(Number),
  allowUnsafeRegExp: Match.Optional(Boolean),
});

export type SerializerResourceConfig = Match.infer<
  typeof serializerResourceConfigPattern
>;

export const serializerResource = defineResource<
  SerializerResourceConfig,
  Promise<Serializer>
>({
  id: "serializer",
  configSchema: serializerResourceConfigPattern,
  init: async (config) => new Serializer(config),
  meta: {
    title: "Serializer",
    description:
      "Serializes and deserializes data. Supports stringify/parse and custom type registration via addType.",
  },
});
