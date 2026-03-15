import { createMatchPatternError } from "../../errors";
import { getClassSchemaDefinition } from "../../classSchema";
import { throwUnsupported } from "../../toJsonSchema.helpers";
import { defineMatchPatternDefinition } from "../contracts";
import { matchesObjectPattern } from "../matchingObject";
import { resolveClassAllowUnknownKeys } from "../shared";
import { isPlainObject } from "../utils";
import {
  compileObjectPattern,
  getDefinitionId,
  isMatchClassPatternOptions,
  type MatchClassPatternOptions,
  type ClassHolder,
} from "./helpers";

export const classPatternDefinition = defineMatchPatternDefinition<ClassHolder>(
  {
    kind: "Match.ClassPattern",
    match(pattern, value, context, path, _parent, matchesPattern) {
      if (typeof pattern.ctor !== "function") {
        throw createMatchPatternError(
          "Bad pattern: Match.fromSchema requires a class constructor.",
        );
      }

      const ctor = pattern.ctor as abstract new (...args: never[]) => unknown;
      const options = isMatchClassPatternOptions(pattern.options)
        ? pattern.options
        : undefined;
      const classSchema = getClassSchemaDefinition(ctor);
      const allowUnknownKeys = resolveClassAllowUnknownKeys(
        options?.exact,
        classSchema.exact,
      );
      return matchesObjectPattern(
        value,
        classSchema.pattern,
        context,
        path,
        allowUnknownKeys,
        matchesPattern,
        (candidate): candidate is Record<string, unknown> =>
          isPlainObject(candidate) || candidate instanceof ctor,
      );
    },
    compileToJSONSchema(pattern, context, path, _mode, compilePattern) {
      if (
        typeof pattern.ctor !== "function" ||
        !isMatchClassPatternOptions(pattern.options)
      ) {
        throwUnsupported(
          path,
          "Match.fromClass requires a class constructor.",
          pattern,
        );
      }

      const ctor = pattern.ctor as abstract new (...args: never[]) => unknown;
      const options = pattern.options as MatchClassPatternOptions | undefined;
      const classDefinition = getClassSchemaDefinition(ctor);
      const definitionId = getDefinitionId(
        context,
        ctor,
        options?.schemaId ?? classDefinition.schemaId,
      );

      if (!context.definitions[definitionId]) {
        if (context.compilingDefinitionIds.has(definitionId)) {
          return { $ref: `#/$defs/${definitionId}` };
        }

        context.compilingDefinitionIds.add(definitionId);
        try {
          const allowUnknownKeys = resolveClassAllowUnknownKeys(
            options?.exact,
            classDefinition.exact,
          );

          context.definitions[definitionId] = compileObjectPattern(
            classDefinition.pattern,
            context,
            path,
            allowUnknownKeys,
            compilePattern,
          );
        } finally {
          context.compilingDefinitionIds.delete(definitionId);
        }
      }

      return { $ref: `#/$defs/${definitionId}` };
    },
    appliesMessageOverrideToAggregate() {
      return true;
    },
  },
);
