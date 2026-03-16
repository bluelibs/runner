import { requireDecoratorMetadataRecord } from "../decorators/metadata";
import { validationError } from "./errors";
import {
  setEsSerializerFieldOptions,
  setLegacySerializerFieldOptions,
  type SerializerClassConstructor,
} from "./field-metadata";
import type { SerializerFieldDecorator, SerializerFieldOptions } from "./types";
import type { LegacySerializerFieldDecorator } from "./legacy-types";

export function createEsSerializerFieldDecorator(
  options: SerializerFieldOptions = {},
): SerializerFieldDecorator {
  return (_value, context) => {
    const propertyName = context.name;

    if (context.private) {
      validationError(
        "Invalid Serializer.Field() usage: private class fields are not supported.",
      );
    }

    if (typeof propertyName !== "string") {
      validationError(
        "Invalid Serializer.Field() usage: only string property names are supported.",
      );
    }

    const metadata = requireDecoratorMetadataRecord(
      context,
      "Serializer.Field()",
      validationError,
    );

    setEsSerializerFieldOptions(metadata, propertyName as string, options);
  };
}

export function createLegacySerializerFieldDecorator(
  options: SerializerFieldOptions = {},
): LegacySerializerFieldDecorator {
  return (target, propertyKey) => {
    const propertyName = propertyKey;

    if (typeof propertyName !== "string") {
      validationError(
        "Invalid Serializer.Field() usage: only string property names are supported.",
      );
    }

    const ctor = (
      typeof target === "function" ? target : target.constructor
    ) as SerializerClassConstructor;

    if (typeof ctor !== "function") {
      validationError(
        "Invalid Serializer.Field() usage: decorator target must be a class field.",
      );
    }

    setLegacySerializerFieldOptions(ctor, propertyName as string, options);
  };
}
