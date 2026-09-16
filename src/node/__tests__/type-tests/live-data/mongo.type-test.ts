import type {
  Collection,
  Document,
  Filter,
  FindOptions,
  ObjectId,
  WithId,
} from "mongodb";
import { live, Match, r } from "../../../../node";
import type { ExtractTaskInput, ResolveTaskOutput } from "../../../../defs";

type Assert<T extends true> = T;
type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false;

void (() => {
  type Invoice = {
    _id: string;
    tenantId: string;
    customerId: string;
    status: "open" | "paid";
    paidAt?: Date;
  };

  const collection = null as unknown as Collection<Invoice>;
  const collectionResource = r
    .resource("types-mongo-invoices")
    .init(async () => collection)
    .build();
  const source = live.mongo({
    collection: collectionResource,
    key: "billing.invoices",
    scope: () => ({ tenantId: "tenant-a" }),
  });

  const paidInvoices = source.find("types-paid-invoices", {
    inputSchema: { customerId: Match.NonEmptyString },
    query: ({ customerId }) => ({
      filter: { customerId, status: "paid" },
      sort: { paidAt: -1, _id: -1 },
      limit: 20,
    }),
  });
  type PaidInput = Assert<
    Equal<ExtractTaskInput<typeof paidInvoices.task>, { customerId: string }>
  >;
  type PaidOutput = Assert<
    ResolveTaskOutput<typeof paidInvoices.task> extends WithId<Invoice>[]
      ? true
      : false
  >;
  const paidInput: PaidInput = true;
  const paidOutput: PaidOutput = true;
  void [paidInvoices, paidInput, paidOutput];

  const projectedInvoices = source.find("types-projected-invoices", {
    inputSchema: { customerId: Match.NonEmptyString },
    query: ({ customerId }) => ({
      filter: { customerId },
      projection: { customerId: 1, status: 1 },
    }),
  });
  const projected = null as unknown as ResolveTaskOutput<
    typeof projectedInvoices.task
  >;
  const projectedDocuments: Document[] = projected;
  type ProjectedOutput = Assert<
    Equal<ResolveTaskOutput<typeof projectedInvoices.task>, Document[]>
  >;
  const projectedOutput: ProjectedOutput = true;
  void [projectedInvoices, projectedDocuments, projectedOutput];

  const dynamicProjection = source.find("types-dynamic-projection", {
    inputSchema: { customerId: Match.NonEmptyString },
    query: ({ customerId }): FindOptions & { filter: Filter<Invoice> } => ({
      filter: { customerId },
      projection: Math.random() > 0.5 ? { customerId: 1 } : undefined,
    }),
  });
  type DynamicProjectionOutput = Assert<
    Equal<ResolveTaskOutput<typeof dynamicProjection.task>, Document[]>
  >;
  const dynamicProjectionOutput: DynamicProjectionOutput = true;
  void [dynamicProjection, dynamicProjectionOutput];

  type UnionDescriptor =
    | { filter: Filter<Invoice> }
    | { filter: Filter<Invoice>; projection: Document };
  const unionProjection = source.find("types-union-projection", {
    inputSchema: { customerId: Match.NonEmptyString },
    query: ({ customerId }): UnionDescriptor =>
      customerId === "full"
        ? { filter: { customerId } }
        : { filter: { customerId }, projection: { customerId: 1 } },
  });
  type UnionProjectionOutput = Assert<
    Equal<ResolveTaskOutput<typeof unionProjection.task>, Document[]>
  >;
  const unionProjectionOutput: UnionProjectionOutput = true;
  void [unionProjection, unionProjectionOutput];

  const latestInvoice = source.findOne("types-latest-invoice", {
    inputSchema: { customerId: Match.NonEmptyString },
    query: ({ customerId }) => ({ filter: { customerId }, sort: { _id: -1 } }),
  });
  const latest: WithId<Invoice> | null = null as unknown as ResolveTaskOutput<
    typeof latestInvoice.task
  >;
  void [latestInvoice, latest];

  const projectedInvoice = source.findOne("types-projected-invoice", {
    inputSchema: { customerId: Match.NonEmptyString },
    query: ({ customerId }) => ({
      filter: { customerId },
      projection: { customerId: 1 },
    }),
  });
  const projectedOne: Document | null = null as unknown as ResolveTaskOutput<
    typeof projectedInvoice.task
  >;
  void [projectedInvoice, projectedOne];

  const paidCount = source.count("types-paid-count", {
    inputSchema: { customerId: Match.NonEmptyString },
    query: ({ customerId }) => ({
      filter: { customerId, status: "paid" },
      maxTimeMS: 500,
    }),
  });
  const count: number = null as unknown as ResolveTaskOutput<
    typeof paidCount.task
  >;
  void [paidCount, count];

  type MongoGeneratedIdDocument = {
    _id?: ObjectId;
    tenantId: string;
    text: string;
  };
  const generatedIdCollection =
    null as unknown as Collection<MongoGeneratedIdDocument>;
  const generatedIdResource = r
    .resource("types-mongo-generated-id")
    .init(async () => generatedIdCollection)
    .build();
  const generatedIdSource = live.mongo({
    collection: generatedIdResource,
    key: "messages",
  });
  const messages = generatedIdSource.find("types-messages", {
    inputSchema: { tenantId: Match.NonEmptyString },
    query: ({ tenantId }) => ({ filter: { tenantId } }),
  });
  const generatedDocuments: WithId<MongoGeneratedIdDocument>[] =
    null as unknown as ResolveTaskOutput<typeof messages.task>;
  const generatedId: ObjectId = generatedDocuments[0]!._id;
  void [messages, generatedId];

  source.find("types-invalid-query-input", {
    inputSchema: { customerId: Match.NonEmptyString },
    query: ({ customerId }) => {
      // @ts-expect-error Match.NonEmptyString infers string input
      customerId.toFixed();
      return { filter: { customerId } };
    },
  });
})();
