import { defineResource } from "../../definers/defineResource";
import { Serializer } from "../../serializer";
import type { SerializerOptions } from "../../serializer";
import { Match } from "../../tools/check";

export type SerializerResourceConfig = SerializerOptions;

export const serializerResourceConfigSchema = Match.ObjectIncluding({
  pretty: Match.Optional(Boolean),
  types: Match.Optional(Match.ArrayOf(Object)),
  schemas: Match.Optional(Match.ArrayOf(Function)),
  maxDepth: Match.Optional(Number),
  allowedTypes: Match.Optional(Match.ArrayOf(String)),
  symbolPolicy: Match.Optional(
    Match.OneOf("allow-all", "well-known-only", "disabled"),
  ),
  maxRegExpPatternLength: Match.Optional(Number),
  allowUnsafeRegExp: Match.Optional(Boolean),
});

export const serializerResource = defineResource<
  SerializerResourceConfig,
  Promise<Serializer>
>({
  id: "serializer",
  configSchema: serializerResourceConfigSchema,
  init: async (config) => new Serializer(config),
  meta: {
    title: "Serializer",
    description:
      "Serializes and deserializes data. Supports stringify/parse and custom type registration via addType.",
  },
});
