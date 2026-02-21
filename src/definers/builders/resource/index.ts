import type {
  IResourceMeta,
  ResourceMiddlewareAttachmentType,
  TagType,
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
export function resourceBuilder<TConfig = void>(
  id: string,
): ResourceFluentBuilder<
  TConfig,
  Promise<any>,
  {},
  any,
  IResourceMeta,
  TagType[],
  ResourceMiddlewareAttachmentType[]
> {
  const filePath = getCallerFile();
  const initial: BuilderState<
    TConfig,
    Promise<any>,
    {},
    any,
    IResourceMeta,
    TagType[],
    ResourceMiddlewareAttachmentType[]
  > = Object.freeze({
    id,
    filePath,
    dependencies: undefined,
    register: undefined,
    middleware: [],
    tags: [],
    context: undefined,
    init: undefined,
    dispose: undefined,
    configSchema: undefined,
    resultSchema: undefined,
    meta: undefined,
    overrides: undefined,
    wiringAccessPolicy: undefined,
  });
  return makeResourceBuilder(initial);
}

/**
 * Alias for resourceBuilder - common shorthand.
 */
export const resource = resourceBuilder;
