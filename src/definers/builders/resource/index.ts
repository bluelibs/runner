import type {
  IResourceMeta,
  ResourceTagType,
  ResourceMiddlewareAttachmentType,
} from "../../../defs";
import { getCallerFile } from "../../../tools/getCallerFile";
import type { ResourceFluentBuilder } from "./fluent-builder.interface";
import { makeResourceBuilder } from "./fluent-builder";
import type { BuilderState } from "./types";

// Re-export the interface for external consumers
export type { ResourceFluentBuilder } from "./fluent-builder.interface";
export * from "./types";

/**
 * Public options accepted by {@link resourceBuilder}.
 */
export type ResourceBuilderOptions = {};

type InternalResourceBuilderOptions = ResourceBuilderOptions & {
  filePath: string;
};

function createResourceBuilder<TConfig = void>(
  id: string,
  options: InternalResourceBuilderOptions,
): ResourceFluentBuilder<
  TConfig,
  Promise<any>,
  {},
  any,
  IResourceMeta,
  ResourceTagType[],
  ResourceMiddlewareAttachmentType[]
> {
  const initial: BuilderState<
    TConfig,
    Promise<any>,
    {},
    any,
    IResourceMeta,
    ResourceTagType[],
    ResourceMiddlewareAttachmentType[]
  > = Object.freeze({
    id,
    filePath: options.filePath,
    dependencies: undefined,
    register: undefined,
    middleware: [],
    tags: [],
    context: undefined,
    init: undefined,
    dispose: undefined,
    ready: undefined,
    cooldown: undefined,
    configSchema: undefined,
    resultSchema: undefined,
    meta: undefined,
    overrides: undefined,
    isolateDeclarations: undefined,
    subtreeDeclarations: undefined,
  });
  return makeResourceBuilder(initial);
}

export function resourceBuilder<TConfig = void>(
  id: string,
  options?: ResourceBuilderOptions,
): ResourceFluentBuilder<
  TConfig,
  Promise<any>,
  {},
  any,
  IResourceMeta,
  ResourceTagType[],
  ResourceMiddlewareAttachmentType[]
> {
  return createResourceBuilder(id, {
    ...options,
    filePath: getCallerFile(),
  });
}

/**
 * Creates a fluent resource builder.
 *
 * Resources own lifecycle, registration, and isolation boundaries, so this builder
 * keeps those decisions explicit in one chain.
 */
export const resource = resourceBuilder;
