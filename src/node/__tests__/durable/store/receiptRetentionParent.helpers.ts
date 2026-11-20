import { r, resources, run, tags } from "../../..";
import { durableResource } from "../../../durable/core/resource";
import type { IDurableStore } from "../../../durable/core/interfaces/store";
import { waitUntil } from "../../../durable/test-utils";

export async function assertChildRetentionAfterParentExpiry(
  store: IDurableStore,
) {
  const durable = durableResource.fork("receipt-retention-test");
  const child = r
    .task("child")
    .tags([
      tags.durableWorkflow.with({
        retention: {
          onComplete: { afterMs: 60_000 },
          receipts: { afterMs: 120_000 },
        },
      }),
    ])
    .run(async () => "child result")
    .build();
  const parent = r
    .task("parent")
    .tags([
      tags.durableWorkflow.with({
        retention: { onComplete: "retain", receipts: "delete" },
      }),
    ])
    .dependencies({ durable })
    .run(async (_: undefined, { durable: backend }) =>
      backend.use().workflow("child", child),
    )
    .build();
  const runtime = await run(
    r
      .resource("app")
      .register([
        resources.durable,
        durable.with({
          store,
          timers: { enabled: false },
          garbageCollection: { enabled: false },
        }),
        parent,
        child,
      ])
      .build(),
    { logs: { printThreshold: null } },
  );
  try {
    const backend = runtime.getResourceValue(durable);
    const parentId = await backend.start(parent);
    const childId = await backend.wait<string>(parentId);
    await expect(backend.wait(childId)).resolves.toBe("child result");
    const unrelatedId = await backend.start(child, undefined, {
      parentExecutionId: "external-parent",
    });
    await backend.wait(unrelatedId);
    await waitUntil(
      async () => {
        const leases = await Promise.all(
          [parentId, childId, unrelatedId].map((id) =>
            store.hasExecutionLease!(id),
          ),
        );
        return leases.every((lease) => !lease);
      },
      { timeoutMs: 1000, intervalMs: 5 },
    );
    const parentExecution = (await store.getExecution(parentId))!;
    const childExecution = (await store.getExecution(childId))!;
    const latestCompletedAt = Math.max(
      childExecution.completedAt!.getTime(),
      (await store.getExecution(unrelatedId))!.completedAt!.getTime(),
    );
    const historyDue = new Date(latestCompletedAt + 60_000);
    const receiptsDue = new Date(latestCompletedAt + 120_000);
    expect(
      await store.collectExpiredReceipts!(parentExecution.completedAt!, 10),
    ).toBe(1);
    expect(await store.getExecution(parentId)).toBeNull();
    expect(await store.collectCompletedHistory!(historyDue, 10)).toBe(1);
    expect((await store.getExecution(childId))?.historyCollectedAt).toEqual(
      historyDue,
    );
    expect(await store.collectExpiredReceipts!(receiptsDue, 10)).toBe(1);
    expect(await store.getExecution(childId)).toBeNull();
    expect(await store.getExecution(unrelatedId)).toMatchObject({
      status: "completed",
      parentExecutionId: "external-parent",
    });
  } finally {
    await runtime.dispose();
  }
}
