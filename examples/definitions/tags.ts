import { symbolFilePath } from "./symbols";
import { ITagMeta } from "./meta";
import { IValidationSchema } from "./validation";

export interface ITagDefinition<TConfig = void, TEnforceContract = void> {
  id: string;
  meta?: ITagMeta;
  configSchema?: IValidationSchema<TConfig>;
}

/**
 * A configured instance of a tag as produced by `ITag.with()`.
 */
export interface ITagWithConfig<TConfig = void, TEnforceContract = void> {
  id: string;
  /** The tag definition used to produce this configured instance. */
  tag: ITag<TConfig, TEnforceContract>;
  /** The configuration captured for this tag instance. */
  config: TConfig;
}

/**
 * A tag definition (builder). Use `.with(config)` to obtain configured instances,
 * and `.extract(tags)` to find either a configured instance or the bare tag in a list.
 */
export interface ITag<TConfig = void, TEnforceContract = void>
  extends ITagDefinition<TConfig, TEnforceContract> {
  /**
   * Creates a configured instance of the tag.
   */
  with(config: TConfig): ITagWithConfig<TConfig, TEnforceContract>;
  /**
   * Extracts either a configured instance or the bare tag from a list of tags
   * or from a taggable object (`{ meta: { tags?: [] } }`).
   */
  extract(
    target: TagType[] | ITaggable
  ): ExtractedTagResult<TConfig, TEnforceContract> | null;
  [symbolFilePath]: string;
}

/**
 * Restrict bare tags to those whose config can be omitted (void or optional object),
 * mirroring the same principle used for resources in `RegisterableItems`.
 * Required-config tags must appear as configured instances.
 */
export type TagType =
  | string
  | ITag<void, any>
  | ITag<{ [K in any]?: any }, any>
  | ITagWithConfig<any, any>;

/**
 * Conditional result type for `ITag.extract`:
 * - For void config → just the identifier
 * - For optional object config → identifier with optional config
 * - For required config → identifier with required config
 */
export type ExtractedTagResult<TConfig, TEnforceContract> = {} extends TConfig
  ? { id: string; config?: TConfig }
  : { id: string; config: TConfig };

/**
 * Any object that can carry tags via metadata. This mirrors how tasks,
 * resources, events, and middleware expose `meta.tags`.
 */
export interface ITaggable {
  meta?: {
    tags?: TagType[];
  };
}
