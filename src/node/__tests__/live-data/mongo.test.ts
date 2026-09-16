import type {
  Collection,
  CountDocumentsOptions,
  Filter,
  FindCursor,
  FindOptions,
  WithId,
} from "mongodb";
import { Match, r, run } from "../../../index";
import { mongo } from "../../live-data/mongo";

type Invoice = {
  _id: string;
  tenantId: string;
  customerId: string;
  status: "open" | "paid";
};

function createCollectionFake() {
  const invoices: WithId<Invoice>[] = [
    {
      _id: "invoice-1",
      tenantId: "tenant-a",
      customerId: "customer-1",
      status: "paid",
    },
  ];
  const find = jest.fn(function (
    this: Collection<Invoice>,
    _filter: Filter<Invoice>,
    _options?: FindOptions,
  ): FindCursor<WithId<Invoice>> {
    expect(this).toBe(collection);
    return {
      toArray: async () => invoices,
    } as FindCursor<WithId<Invoice>>;
  });
  const findOne = jest.fn(function (
    this: Collection<Invoice>,
    _filter: Filter<Invoice>,
    _options?: FindOptions,
  ): Promise<WithId<Invoice> | null> {
    expect(this).toBe(collection);
    return Promise.resolve(invoices[0] ?? null);
  });
  const countDocuments = jest.fn(function (
    this: Collection<Invoice>,
    _filter: Filter<Invoice>,
    _options?: CountDocumentsOptions,
  ): Promise<number> {
    expect(this).toBe(collection);
    return Promise.resolve(invoices.length);
  });

  // A complete Collection is deliberately unnecessary for adapter unit tests.
  const collection = {
    find,
    findOne,
    countDocuments,
  } as unknown as Collection<Invoice>;
  return { collection, countDocuments, find, findOne, invoices };
}

describe("Mongo live-data adapter", () => {
  it("creates source-wide query tasks and scopes every native read", async () => {
    const fake = createCollectionFake();
    const collectionResource = r
      .resource("mongo-invoices")
      .init(async () => fake.collection)
      .build();
    let tenantId = "tenant-a";
    const source = mongo({
      collection: collectionResource,
      key: "billing.invoices",
      scope: () => ({ tenantId }),
    });
    const findDescriptor = jest.fn(
      ({ customerId }: { customerId: string }) => ({
        filter: { customerId, status: "paid" as const },
        projection: { customerId: 1, status: 1 },
        sort: { _id: -1 as const },
        limit: 20,
      }),
    );
    const paidInvoices = source.find("paid-invoices", {
      inputSchema: { customerId: Match.NonEmptyString },
      query: findDescriptor,
    });
    const latestInvoice = source.findOne("latest-paid-invoice", {
      inputSchema: { customerId: Match.NonEmptyString },
      query: ({ customerId }) => ({
        filter: { customerId, status: "paid" },
        projection: { customerId: 1 },
        sort: { _id: -1 },
      }),
    });
    const paidCount = source.count("paid-invoice-count", {
      inputSchema: { customerId: Match.NonEmptyString },
      query: ({ customerId }) => ({
        filter: { customerId, status: "paid" },
        maxTimeMS: 500,
      }),
    });
    const unscopedSource = mongo({
      collection: collectionResource,
      key: "all.invoices",
    });
    const unscopedInvoices = unscopedSource.find("all-paid-invoices", {
      inputSchema: { customerId: Match.NonEmptyString },
      query: ({ customerId }) => ({ filter: { customerId } }),
    });
    const app = r
      .resource("mongo-live-data-app")
      .register([
        collectionResource,
        paidInvoices.task,
        latestInvoice.task,
        paidCount.task,
        unscopedInvoices.task,
      ])
      .build();
    const runtime = await run(app);

    try {
      expect(source.topic()).toBe(source.topic());
      expect(source.topic().segments).toEqual(["mongo", "billing.invoices"]);
      expect(paidInvoices.topics({ customerId: "someone-else" })).toBe(
        source.topic(),
      );
      expect(latestInvoice.topics({ customerId: "customer-1" })).toBe(
        source.topic(),
      );
      expect(paidCount.topics({ customerId: "customer-1" })).toBe(
        source.topic(),
      );
      expect(unscopedInvoices.topics({ customerId: "customer-1" })).toBe(
        unscopedSource.topic(),
      );

      await expect(
        runtime.runTask(paidInvoices.task, { customerId: "" }),
      ).rejects.toThrow(/Expected non-empty string/);
      expect(findDescriptor).not.toHaveBeenCalled();

      await expect(
        runtime.runTask(paidInvoices.task, { customerId: "customer-1" }),
      ).resolves.toEqual(fake.invoices);
      expect(fake.find).toHaveBeenLastCalledWith(
        {
          $and: [
            { tenantId: "tenant-a" },
            { customerId: "customer-1", status: "paid" },
          ],
        },
        {
          projection: { customerId: 1, status: 1 },
          sort: { _id: -1 },
          limit: 20,
        },
      );

      tenantId = "tenant-b";
      const controller = new AbortController();
      await runtime.runTask(
        paidInvoices.task,
        { customerId: "customer-2" },
        { signal: controller.signal },
      );
      expect(fake.find).toHaveBeenLastCalledWith(
        {
          $and: [
            { tenantId: "tenant-b" },
            { customerId: "customer-2", status: "paid" },
          ],
        },
        {
          projection: { customerId: 1, status: 1 },
          sort: { _id: -1 },
          limit: 20,
          signal: controller.signal,
        },
      );

      await expect(
        runtime.runTask(
          latestInvoice.task,
          { customerId: "customer-1" },
          { signal: controller.signal },
        ),
      ).resolves.toEqual(fake.invoices[0]);
      expect(fake.findOne).toHaveBeenCalledWith(
        {
          $and: [
            { tenantId: "tenant-b" },
            { customerId: "customer-1", status: "paid" },
          ],
        },
        {
          projection: { customerId: 1 },
          sort: { _id: -1 },
          signal: controller.signal,
        },
      );

      await expect(
        runtime.runTask(
          paidCount.task,
          { customerId: "customer-1" },
          { signal: controller.signal },
        ),
      ).resolves.toBe(1);
      expect(fake.countDocuments).toHaveBeenCalledWith(
        {
          $and: [
            { tenantId: "tenant-b" },
            { customerId: "customer-1", status: "paid" },
          ],
        },
        { maxTimeMS: 500, signal: controller.signal },
      );

      await runtime.runTask(unscopedInvoices.task, {
        customerId: "customer-3",
      });
      expect(fake.find).toHaveBeenLastCalledWith(
        { customerId: "customer-3" },
        {},
      );
    } finally {
      await runtime.dispose();
    }
  });
});
