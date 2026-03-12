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
import {
  symbolForkedFrom,
  symbolResource,
  symbolFilePath,
  symbolOptionalDependency,
  symbolResourceIsolateDeclarations,
  symbolResourceRegistersChildren,
  symbolResourceSubtreeDeclarations,
  symbolResourceWithConfig,
} from "../types/symbols";
import {
  resourceForkNonLeafUnsupportedError,
  validationError,
} from "../errors";
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
    throws: current.throws,
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
