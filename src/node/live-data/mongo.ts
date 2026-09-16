import type {
  Collection,
  CountDocumentsOptions,
  Document,
  Filter,
  FindOptions,
  WithId,
} from "mongodb";
import type {
  IResource,
  InferValidationSchemaInput,
  ValidationSchemaInput,
} from "../../defs";
import { r } from "../../index";
import { query as defineLiveQuery } from "./query";
import { topic } from "./topic";

type CollectionResource<TDocument extends Document> = IResource<
  any,
  Promise<Collection<TDocument>>,
  any,
  any,
  any,
  any,
  any
>;

type FindDescriptor<TDocument extends Document> = FindOptions & {
  /** Native Mongo filter combined with the source scope for every read. */
  filter: Filter<TDocument>;
};

type CountDescriptor<TDocument extends Document> = CountDocumentsOptions & {
  /** Native Mongo filter combined with the source scope for every count. */
  filter: Filter<TDocument>;
};

type DescriptorMayProject<TDescriptor> = TDescriptor extends unknown
  ? "projection" extends keyof TDescriptor
    ? true
    : false
  : never;

type FindResult<
  TDocument extends Document,
  TDescriptor extends FindDescriptor<TDocument>,
> =
  true extends DescriptorMayProject<TDescriptor>
    ? Document[]
    : WithId<TDocument>[];

type FindOneResult<
  TDocument extends Document,
  TDescriptor extends FindDescriptor<TDocument>,
> =
  true extends DescriptorMayProject<TDescriptor>
    ? Document | null
    : WithId<TDocument> | null;

/** Definition of one generated Mongo read task. */
interface MongoReadConfig<
  TInputSchema extends ValidationSchemaInput<any>,
  TDescriptor,
> {
  /** Schema Runner validates before building the native Mongo descriptor. */
  inputSchema: TInputSchema;
  /** Builds the native Mongo filter and read options from validated input. */
  query(input: InferValidationSchemaInput<TInputSchema>): TDescriptor;
}

/** Options for a Mongo live source backed by a native driver collection resource. */
export interface MongoLiveSourceOptions<TDocument extends Document> {
  /** Runner resource whose value is a native MongoDB collection. */
  collection: CollectionResource<TDocument>;
  /** Stable application-level source key used for source-wide invalidation. */
  key: string;
  /** Database scope recomputed for each read and combined with its query filter. */
  scope?: () => Filter<TDocument>;
}

/** Creates source-wide live queries over a native MongoDB collection. */
export function mongo<TDocument extends Document>(
  options: MongoLiveSourceOptions<TDocument>,
) {
  const sourceTopic = topic("mongo", options.key);

  return Object.freeze({
    /** Exact source-wide topic to publish after a committed native Mongo write. */
    topic: () => sourceTopic,

    /** Creates a live `find(...).toArray()` read task. */
    find<
      TSchema extends ValidationSchemaInput<any>,
      TDescriptor extends FindDescriptor<TDocument>,
    >(name: string, config: MongoReadConfig<TSchema, TDescriptor>) {
      type Input = InferValidationSchemaInput<TSchema>;
      type Output = FindResult<TDocument, TDescriptor>;
      const task = r
        .task(name)
        .inputSchema(config.inputSchema)
        .dependencies({ collection: options.collection })
        .run<Input, Promise<Output>>(async (input, { collection }, context) => {
          const { filter, ...findOptions } = config.query(input);
          const scopedFilter = combineFilters(options.scope, filter);
          return (await collection
            .find(scopedFilter, withAbortSignal(findOptions, context?.signal))
            .toArray()) as Output;
        })
        .build();
      return defineLiveQuery({ task, topics: () => sourceTopic });
    },

    /** Creates a live native `findOne()` read task. */
    findOne<
      TSchema extends ValidationSchemaInput<any>,
      TDescriptor extends FindDescriptor<TDocument>,
    >(name: string, config: MongoReadConfig<TSchema, TDescriptor>) {
      type Input = InferValidationSchemaInput<TSchema>;
      type Output = FindOneResult<TDocument, TDescriptor>;
      const task = r
        .task(name)
        .inputSchema(config.inputSchema)
        .dependencies({ collection: options.collection })
        .run<Input, Promise<Output>>(async (input, { collection }, context) => {
          const { filter, ...findOptions } = config.query(input);
          return (await collection.findOne(
            combineFilters(options.scope, filter),
            withAbortSignal(findOptions, context?.signal),
          )) as Output;
        })
        .build();
      return defineLiveQuery({ task, topics: () => sourceTopic });
    },

    /** Creates a live native `countDocuments()` read task. */
    count<
      TSchema extends ValidationSchemaInput<any>,
      TDescriptor extends CountDescriptor<TDocument>,
    >(name: string, config: MongoReadConfig<TSchema, TDescriptor>) {
      type Input = InferValidationSchemaInput<TSchema>;
      const task = r
        .task(name)
        .inputSchema(config.inputSchema)
        .dependencies({ collection: options.collection })
        .run<Input, Promise<number>>(async (input, { collection }, context) => {
          const { filter, ...countOptions } = config.query(input);
          return collection.countDocuments(
            combineFilters(options.scope, filter),
            withAbortSignal(countOptions, context?.signal),
          );
        })
        .build();
      return defineLiveQuery({ task, topics: () => sourceTopic });
    },
  });
}

function combineFilters<TDocument extends Document>(
  scope: (() => Filter<TDocument>) | undefined,
  filter: Filter<TDocument>,
): Filter<TDocument> {
  // Mongo's recursive Filter<T> re-infers `_id` inside `$and`, even though both
  // operands are already native filters for the same collection document.
  return scope ? ({ $and: [scope(), filter] } as Filter<TDocument>) : filter;
}

function withAbortSignal<TOptions extends object>(
  options: TOptions,
  signal: AbortSignal | undefined,
): TOptions & { signal?: AbortSignal } {
  return signal ? { ...options, signal } : options;
}
