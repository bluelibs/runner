import type { TagTarget, TagType, ValidationSchemaInput } from "../defs";
import type { DependencyMapType } from "../types/utilities";
import type { ThrowsList } from "../types/error";
import {
  symbolFilePath,
  symbolMiddlewareConfigured,
  symbolMiddlewareConfiguredFrom,
} from "../types/symbols";
import { validationError } from "../errors";
import { isMatchError } from "../tools/check/errors";
import { deepFreeze, freezeIfLineageLocked } from "../tools/deepFreeze";
import { isSameDefinition } from "../tools/isSameDefinition";
import { mergeMiddlewareConfig } from "./middlewareConfig";
import { assertTagTargetsApplicableTo } from "./assertTagTargetsApplicable";
import { assertDefinitionId } from "./assertDefinitionId";
import { normalizeThrows } from "../tools/throws";
import { normalizeOptionalValidationSchema } from "./normalizeValidationSchema";

/**
 * Variant-specific parameters that distinguish task from resource middleware.
 * The two public definers each provide their own variant object.
 */
export type MiddlewareVariant = {
  typeSymbol: symbol;
  label: string;
  kind: "task-middleware" | "resource-middleware";
  tagTarget: TagTarget;
};

/**
 * Minimal shape that both ITaskMiddlewareDefinition and
 * IResourceMiddlewareDefinition satisfy. Only lists properties
 * the core definer accesses directly; additional fields survive
 * via the object spread.
 */
interface MiddlewareDefCore<TDeps extends DependencyMapType> {
  id: string;
  configSchema?: ValidationSchemaInput<any>;
  tags?: TagType[];
  dependencies?: TDeps | ((config: any) => TDeps);
  throws?: ThrowsList;
}

export type MiddlewareDefWithInferredSchema<
  TSchema extends ValidationSchemaInput<any>,
  TDeps extends DependencyMapType,
> = Omit<MiddlewareDefCore<TDeps>, "configSchema"> & {
  configSchema: TSchema;
};

/**
 * Shared core logic for defining both task and resource middleware.
 * The two public definers delegate here, keeping the identical
 * normalisation → wrap → freeze pipeline in a single place.
 */
export function defineMiddlewareCore<TConfig, TDeps extends DependencyMapType>(
  variant: MiddlewareVariant,
  filePath: string,
  middlewareDef: MiddlewareDefCore<TDeps>,
): Record<string | symbol, unknown> {
  assertDefinitionId(variant.label, middlewareDef.id);

  const configSchema = normalizeOptionalValidationSchema(
    middlewareDef.configSchema,
    { definitionId: middlewareDef.id, subject: "Middleware config" },
  );

  assertTagTargetsApplicableTo(
    variant.tagTarget,
    variant.label,
    middlewareDef.id,
    middlewareDef.tags,
  );

  const base = {
    [symbolFilePath]: filePath,
    [variant.typeSymbol]: true,
    config: {} as TConfig,
    ...middlewareDef,
    tags: middlewareDef.tags ?? [],
    configSchema,
    dependencies: middlewareDef.dependencies || ({} as TDeps),
    throws: normalizeThrows(
      { kind: variant.kind, id: middlewareDef.id },
      middlewareDef.throws,
    ),
  };

  type Obj = Record<string | symbol, unknown> & {
    [symbolMiddlewareConfigured]?: true;
  };

  const wrap = (obj: Obj): Record<string | symbol, unknown> => {
    const resolveCurrent = (candidate: unknown): Obj => {
      if (
        candidate &&
        typeof candidate === "object" &&
        variant.typeSymbol in candidate
      ) {
        return candidate as Obj;
      }
      return obj;
    };

    return {
      ...obj,
      with: function (config: TConfig) {
        const current = resolveCurrent(this);

        if (current.configSchema) {
          try {
            config = (
              current.configSchema as { parse: (v: unknown) => TConfig }
            ).parse(config);
          } catch (error) {
            if (isMatchError(error)) {
              throw error;
            }
            validationError.throw({
              subject: "Middleware config",
              id: current.id as string,
              originalError:
                error instanceof Error ? error : new Error(String(error)),
            });
          }
        }

        const configuredFrom =
          current[symbolMiddlewareConfiguredFrom] ?? current;

        const configured = wrap({
          ...current,
          [symbolMiddlewareConfigured]: true,
          config: mergeMiddlewareConfig(current.config as TConfig, config),
        });

        (configured as Record<symbol, unknown>)[
          symbolMiddlewareConfiguredFrom
        ] = configuredFrom;

        return freezeIfLineageLocked(current, configured);
      },
      extract: function (target: Obj) {
        if (!isSameDefinition(target, this)) {
          return undefined;
        }

        return target[symbolMiddlewareConfigured] === true
          ? (target.config as TConfig)
          : undefined;
      },
    };
  };

  return deepFreeze(wrap(base as Obj));
}
