import type {
  IResource,
  IResourceDefinition,
  DependencyMapType,
  IResourceMeta,
  ResourceTagType,
  IOptionalDependency,
  ResourceMiddlewareAttachmentType,
  IResourceWithConfig,
} from "../types/resource";
import type {
  InferValidationSchemaInput,
  ValidationSchemaInput,
} from "../types/utilities";
import type { AnyError, ThrowsList } from "../types/error";
import {
  symbolForkedFrom,
  symbolResource,
  symbolFilePath,
  symbolOptionalDependency,
  symbolError,
  symbolResourceIsolateDeclarations,
  symbolResourceRegistersChildren,
  symbolResourceSubtreeDeclarations,
  symbolResourceWithConfig,
} from "../types/symbols";
import {
  resourceForkNonLeafUnsupportedError,
  validationError,
} from "../errors";
import { isMatchError } from "../tools/check/errors";
import { getCallerFile } from "../tools/getCallerFile";
import { deepFreeze, freezeIfLineageLocked } from "../tools/deepFreeze";
import { normalizeThrows } from "../tools/throws";
import { assertTagTargetsApplicableTo } from "./assertTagTargetsApplicable";
import { assertDefinitionId } from "./assertDefinitionId";
import { isFrameworkDefinitionMarked } from "./markFrameworkDefinition";
import {
  createDisplaySubtreePolicy,
  createSubtreePolicyDeclaration,
} from "./subtreePolicy";
import {
  createDisplayIsolatePolicy,
  createIsolatePolicyDeclaration,
} from "./isolatePolicy";
import { normalizeOptionalValidationSchema } from "./normalizeValidationSchema";

function cloneThrowsList(throwsList: readonly string[] | undefined) {
  if (throwsList === undefined) return undefined;

  return throwsList.map(
    (id) =>
      ({
        id,
        // Forked resources already hold normalized ids; rebuild the minimal
        // branded helper shape accepted by normalizeThrows().
        [symbolError]: true as const,
      }) as AnyError,
  ) satisfies ThrowsList;
}

/**
 * Defines a resource.
 *
 * Resources model long-lived services and state. Use this low-level API when you want
 * to construct the full definition object directly instead of using the fluent builder.
 */
export function defineResource<
  TConfigSchema extends ValidationSchemaInput<any>,
  TResultSchema extends ValidationSchemaInput<any>,
  TDeps extends DependencyMapType = {},
  TPrivate = any,
  TMeta extends IResourceMeta = any,
  TTags extends ResourceTagType[] = ResourceTagType[],
  TMiddleware extends ResourceMiddlewareAttachmentType[] =
    ResourceMiddlewareAttachmentType[],
>(
  constConfig: Omit<
    IResourceDefinition<
      InferValidationSchemaInput<TConfigSchema>,
      Promise<InferValidationSchemaInput<TResultSchema>>,
      TDeps,
      TPrivate,
      any,
      any,
      TMeta,
      TTags,
      TMiddleware
    >,
    "configSchema" | "resultSchema"
  > & {
    configSchema: TConfigSchema;
    resultSchema: TResultSchema;
  },
): IResource<
  InferValidationSchemaInput<TConfigSchema>,
  Promise<InferValidationSchemaInput<TResultSchema>>,
  TDeps,
  TPrivate,
  TMeta,
  TTags,
  TMiddleware
>;
export function defineResource<
  TConfigSchema extends ValidationSchemaInput<any>,
  TValue extends Promise<any> = Promise<any>,
  TDeps extends DependencyMapType = {},
  TPrivate = any,
  TMeta extends IResourceMeta = any,
  TTags extends ResourceTagType[] = ResourceTagType[],
  TMiddleware extends ResourceMiddlewareAttachmentType[] =
    ResourceMiddlewareAttachmentType[],
>(
  constConfig: Omit<
    IResourceDefinition<
      InferValidationSchemaInput<TConfigSchema>,
      TValue,
      TDeps,
      TPrivate,
      any,
      any,
      TMeta,
      TTags,
      TMiddleware
    >,
    "configSchema"
  > & {
    configSchema: TConfigSchema;
  },
): IResource<
  InferValidationSchemaInput<TConfigSchema>,
  TValue,
  TDeps,
  TPrivate,
  TMeta,
  TTags,
  TMiddleware
>;
export function defineResource<
  TResultSchema extends ValidationSchemaInput<any>,
  TConfig = void,
  TDeps extends DependencyMapType = {},
  TPrivate = any,
  TMeta extends IResourceMeta = any,
  TTags extends ResourceTagType[] = ResourceTagType[],
  TMiddleware extends ResourceMiddlewareAttachmentType[] =
    ResourceMiddlewareAttachmentType[],
>(
  constConfig: Omit<
    IResourceDefinition<
      TConfig,
      Promise<InferValidationSchemaInput<TResultSchema>>,
      TDeps,
      TPrivate,
      any,
      any,
      TMeta,
      TTags,
      TMiddleware
    >,
    "resultSchema"
  > & {
    resultSchema: TResultSchema;
  },
): IResource<
  TConfig,
  Promise<InferValidationSchemaInput<TResultSchema>>,
  TDeps,
  TPrivate,
  TMeta,
  TTags,
  TMiddleware
>;
export function defineResource<
  TConfig = void,
  TValue extends Promise<any> = Promise<any>,
  TDeps extends DependencyMapType = {},
  TPrivate = any,
  TMeta extends IResourceMeta = any,
  TTags extends ResourceTagType[] = ResourceTagType[],
  TMiddleware extends ResourceMiddlewareAttachmentType[] =
    ResourceMiddlewareAttachmentType[],
>(
  constConfig: IResourceDefinition<
    TConfig,
    TValue,
    TDeps,
    TPrivate,
    any,
    any,
    TMeta,
    TTags,
    TMiddleware
  >,
): IResource<TConfig, TValue, TDeps, TPrivate, TMeta, TTags, TMiddleware>;
export function defineResource<
  TConfig = void,
  TValue extends Promise<any> = Promise<any>,
  TDeps extends DependencyMapType = {},
  TPrivate = any,
  TMeta extends IResourceMeta = any,
  TTags extends ResourceTagType[] = ResourceTagType[],
  TMiddleware extends ResourceMiddlewareAttachmentType[] =
    ResourceMiddlewareAttachmentType[],
>(
  constConfig: IResourceDefinition<
    TConfig,
    TValue,
    TDeps,
    TPrivate,
    any,
    any,
    TMeta,
    TTags,
    TMiddleware
  >,
): IResource<TConfig, TValue, TDeps, TPrivate, TMeta, TTags, TMiddleware> {
  /**
   * Define a resource.
   * Produces a strongly-typed resource with id, registration hooks,
   * and optional config schema.
   *
   * - If `id` is omitted, an anonymous, file-based id is generated (resource or index flavored).
   * - Provides `.with(config)` for config-bound registration with optional runtime validation.
   *
   * @typeParam TConfig - Configuration type accepted by the resource.
   * @typeParam TValue - Promise type resolved by the resource `init`.
   * @typeParam TDeps - Dependency map type this resource requires.
   * @typeParam TPrivate - Private context type exposed to middleware during init.
   * @typeParam TMeta - Arbitrary metadata type carried by the resource.
   * @param constConfig - The resource definition config.
   * @returns A branded resource definition usable by the runner.
   */
  const filePath: string = constConfig[symbolFilePath] || getCallerFile();
  const id = constConfig.id;
  assertDefinitionId("Resource", id, {
    allowReservedDottedNamespace: isFrameworkDefinitionMarked(constConfig),
    allowReservedInternalId: isFrameworkDefinitionMarked(constConfig),
  });
  const configSchema = normalizeOptionalValidationSchema(
    constConfig.configSchema,
    {
      definitionId: id,
      subject: "Resource config",
    },
  );
  const resultSchema = normalizeOptionalValidationSchema(
    constConfig.resultSchema,
    {
      definitionId: id,
      subject: "Resource result",
    },
  );
  assertTagTargetsApplicableTo("resources", "Resource", id, constConfig.tags);

  const isolateDeclarations =
    constConfig[symbolResourceIsolateDeclarations] ??
    (constConfig.isolate
      ? Object.freeze([createIsolatePolicyDeclaration(constConfig.isolate)])
      : undefined);
  const isolate = createDisplayIsolatePolicy(isolateDeclarations, id);

  const subtreeDeclarations =
    constConfig[symbolResourceSubtreeDeclarations] ??
    (constConfig.subtree
      ? Object.freeze([createSubtreePolicyDeclaration(constConfig.subtree)])
      : undefined);
  const subtree = createDisplaySubtreePolicy(subtreeDeclarations);

  const base = {
    [symbolResource]: true,
    [symbolResourceRegistersChildren]:
      constConfig.register !== undefined ? true : undefined,
    [symbolFilePath]: filePath,
    id,
    dependencies: constConfig.dependencies,
    dispose: constConfig.dispose,
    ready: constConfig.ready,
    cooldown: constConfig.cooldown,
    health: constConfig.health,
    register: constConfig.register || [],
    overrides: constConfig.overrides || [],
    init: constConfig.init,
    context: constConfig.context,
    configSchema,
    resultSchema,
    tags: constConfig.tags ?? [],
    throws: normalizeThrows({ kind: "resource", id }, constConfig.throws),
    meta: (constConfig.meta || {}) as TMeta,
    middleware: constConfig.middleware ?? [],
    isolate,
    subtree,
    [symbolResourceIsolateDeclarations]: isolateDeclarations,
    [symbolResourceSubtreeDeclarations]: subtreeDeclarations,
  } as IResource<TConfig, TValue, TDeps, TPrivate, TMeta, TTags, TMiddleware>;

  const resolveCurrent = (
    candidate: unknown,
  ): IResource<TConfig, TValue, TDeps, TPrivate, TMeta, TTags, TMiddleware> => {
    if (
      candidate &&
      typeof candidate === "object" &&
      symbolResource in candidate
    ) {
      return candidate as IResource<
        TConfig,
        TValue,
        TDeps,
        TPrivate,
        TMeta,
        TTags,
        TMiddleware
      >;
    }
    return base;
  };

  const buildDefinition = (
    current: IResource<
      TConfig,
      TValue,
      TDeps,
      TPrivate,
      TMeta,
      TTags,
      TMiddleware
    >,
  ): IResourceDefinition<
    TConfig,
    TValue,
    TDeps,
    TPrivate,
    any,
    any,
    TMeta,
    TTags,
    TMiddleware
  > => ({
    id: current.id,
    dependencies: current.dependencies,
    register: current.register,
    overrides: current.overrides,
    init: current.init,
    context: current.context,
    configSchema: current.configSchema,
    resultSchema: current.resultSchema,
    tags: current.tags,
    throws: cloneThrowsList(current.throws),
    middleware: current.middleware,
    dispose: current.dispose,
    ready: current.ready,
    cooldown: current.cooldown,
    health: current.health,
    meta: current.meta,
    isolate: current.isolate,
    subtree: current.subtree,
    [symbolResourceIsolateDeclarations]:
      current[symbolResourceIsolateDeclarations],
    [symbolResourceSubtreeDeclarations]:
      current[symbolResourceSubtreeDeclarations],
  });

  base.with = function (config: TConfig) {
    const current = resolveCurrent(this);
    const currentId = current.id;

    // Validate config with schema if provided (fail fast)
    if (current.configSchema) {
      try {
        config = current.configSchema.parse(config);
      } catch (error) {
        if (isMatchError(error)) {
          throw error;
        }
        validationError.throw({
          subject: "Resource config",
          id: currentId,
          originalError:
            error instanceof Error ? error : new Error(String(error)),
        });
      }
    }

    const configured = {
      [symbolResourceWithConfig]: true,
      id: currentId,
      resource: current,
      config,
    } satisfies IResourceWithConfig<
      TConfig,
      TValue,
      TDeps,
      TPrivate,
      TMeta,
      TTags,
      TMiddleware
    >;
    return freezeIfLineageLocked(current, configured);
  };

  base.optional = function () {
    const current = resolveCurrent(this);
    const wrapper = {
      inner: current,
      [symbolOptionalDependency]: true,
    } as IOptionalDependency<
      IResource<TConfig, TValue, TDeps, TPrivate, TMeta, TTags, TMiddleware>
    >;
    return freezeIfLineageLocked(current, wrapper);
  };

  base.fork = function (newId: string) {
    const current = resolveCurrent(this);
    if (current[symbolResourceRegistersChildren] === true) {
      resourceForkNonLeafUnsupportedError.throw({ id: current.id });
    }
    const forkCallerFilePath = getCallerFile();
    const forked = defineResource({
      ...buildDefinition(current),
      id: newId,
      register: current.register,
      dependencies: current.dependencies,
      [symbolFilePath]: forkCallerFilePath,
    });
    const forkedWithMeta = {
      ...forked,
      [symbolForkedFrom]: {
        fromId: current.id,
      },
    };
    return freezeIfLineageLocked(current, forkedWithMeta);
  };

  return deepFreeze(base);
}
