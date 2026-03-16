import { requireDecoratorMetadataRecord } from "../../decorators/metadata";
import type { MatchSchemaOptions } from "./classSchema";
import {
  setEsClassFieldPattern,
  setEsClassSchemaOptions,
  setLegacyClassFieldPattern,
  setLegacyClassSchemaOptions,
} from "./classSchema";
import { createMatchPatternError } from "./errors";
import type {
  MatchPattern,
  MatchPropertyDecorator,
  MatchSchemaDecorator,
} from "./types";
import type {
  LegacyMatchPropertyDecorator,
  LegacyMatchSchemaDecorator,
} from "./legacy-types";

export function createEsSchemaDecorator(
  options?: MatchSchemaOptions,
): MatchSchemaDecorator {
  return (_target, context) => {
    const metadata = requireDecoratorMetadataRecord(
      context,
      "Match.Schema()",
      (message): never => {
        throw createMatchPatternError(message);
      },
    );

    setEsClassSchemaOptions(metadata, options ?? {});
  };
}

export function createEsFieldDecorator(
  pattern: MatchPattern,
): MatchPropertyDecorator {
  return (_value, context) => {
    if (context.private) {
      throw createMatchPatternError(
        "Bad pattern: Match.Field does not support private class fields.",
      );
    }

    if (typeof context.name !== "string") {
      throw createMatchPatternError(
        "Bad pattern: Match.Field supports string property names only.",
      );
    }

    const metadata = requireDecoratorMetadataRecord(
      context,
      "Match.Field()",
      (message): never => {
        throw createMatchPatternError(message);
      },
    );

    setEsClassFieldPattern(metadata, context.name, pattern);
  };
}

export function createLegacySchemaDecorator(
  options?: MatchSchemaOptions,
): LegacyMatchSchemaDecorator {
  return (target) => {
    setLegacyClassSchemaOptions(target, options ?? {});
  };
}

export function createLegacyFieldDecorator(
  pattern: MatchPattern,
): LegacyMatchPropertyDecorator {
  return (target, key) => {
    if (typeof key !== "string") {
      throw createMatchPatternError(
        "Bad pattern: Match.Field supports string property names only.",
      );
    }

    const ctor = (
      typeof target === "function" ? target : target.constructor
    ) as abstract new (...args: never[]) => unknown;

    if (typeof ctor !== "function") {
      throw createMatchPatternError(
        "Bad pattern: Match.Field can only be used on class members.",
      );
    }

    setLegacyClassFieldPattern(ctor, key, pattern);
  };
}
