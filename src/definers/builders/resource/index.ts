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
 * Creates a new resource builder with the given id.
 */
export type ResourceBuilderOptions = {
  gateway?: boolean;
  frameworkOwned?: boolean;
};

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
  const filePath = getCallerFile();
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
    gateway: options?.gateway === true,
    frameworkOwned: options?.frameworkOwned === true,
    filePath,
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
    isolate: undefined,
    subtree: undefined,
  });
  return makeResourceBuilder(initial);
}

/**
 * Alias for resourceBuilder - common shorthand.
 */
export const resource = resourceBuilder;
