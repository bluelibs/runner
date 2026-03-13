import { check, Match as defaultMatch } from "../tools/check";
import { Serializer as BaseSerializer } from "../serializer";
import {
  createLegacyFieldDecorator,
  createLegacySchemaDecorator,
} from "../tools/check/decorators";
import { createLegacySerializerFieldDecorator } from "../serializer/decorators";
import type {
  LegacyMatchPropertyDecorator,
  LegacyMatchSchemaDecorator,
} from "../tools/check/legacy-types";
import type { LegacySerializerFieldDecorator } from "../serializer/legacy-types";
import type { SerializerFieldOptions } from "../serializer";

type LegacyMatchSurface = Omit<
  typeof defaultMatch,
  "Schema" | "Class" | "Field"
> & {
  Schema: (
    options?: import("../tools/check").MatchSchemaOptions,
  ) => LegacyMatchSchemaDecorator;
  Class: (
    options?: import("../tools/check").MatchSchemaOptions,
  ) => LegacyMatchSchemaDecorator;
  Field: (
    pattern: import("../tools/check").MatchPattern,
  ) => LegacyMatchPropertyDecorator;
};

export const Match: LegacyMatchSurface = Object.freeze({
  ...defaultMatch,
  Schema: createLegacySchemaDecorator,
  Class: createLegacySchemaDecorator,
  Field: createLegacyFieldDecorator,
});

class LegacySerializerImpl extends BaseSerializer {}

type LegacySerializerConstructor = {
  new (
    ...args: ConstructorParameters<typeof BaseSerializer>
  ): InstanceType<typeof BaseSerializer>;
  prototype: InstanceType<typeof BaseSerializer>;
  Field: (options?: SerializerFieldOptions) => LegacySerializerFieldDecorator;
};

export const Serializer =
  LegacySerializerImpl as unknown as LegacySerializerConstructor;

// Keep the runtime implementation shared with the main Serializer while
// exposing the legacy decorator call signature on the compatibility entrypoint.
Serializer.Field = (
  options: SerializerFieldOptions = {},
): LegacySerializerFieldDecorator =>
  createLegacySerializerFieldDecorator(options);

export { check };

export type {
  CheckOptions,
  CheckSchemaLike,
  CheckedValue,
  InferCheckSchema,
  InferMatchPattern,
  MatchCompiledSchema,
  MatchJsonObject,
  MatchJsonPrimitive,
  MatchJsonSchema,
  MatchJsonValue,
  MatchMessageContext,
  MatchMessageDescriptor,
  MatchMessageOptions,
  MatchPattern,
  MatchSchemaOptions,
  MatchClassOptions,
  MatchToJsonSchemaOptions,
} from "../tools/check";
export type {
  LegacyMatchClassDecorator as MatchClassDecorator,
  LegacyMatchPropertyDecorator as MatchPropertyDecorator,
  LegacyMatchSchemaDecorator as MatchSchemaDecorator,
} from "../tools/check/legacy-types";
export type { LegacySerializerFieldDecorator as SerializerFieldDecorator } from "../serializer/legacy-types";
export type { SerializerFieldOptions, SerializerOptions } from "../serializer";
