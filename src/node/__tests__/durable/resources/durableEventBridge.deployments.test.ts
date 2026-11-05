import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { r, run } from "../../../../index";
import { resources, tags } from "../../../node";
import { durableResource } from "../../../durable/core/resource";
import { PersistentMemoryStore } from "../../../durable/store/PersistentMemoryStore";

const logs = { printThreshold: null } as const;

describe("durable event deployment recovery", () => {
  it.each(["forward", "compensation"] as const)(
    "keeps saved membership and order while using current %s handlers",
    async (phase) => {
      const directory = await mkdtemp(join(tmpdir(), "runner-event-deploy-"));
      const filePath = join(directory, "state.json");
      const durable = durableResource.fork("workflows");
      const event = r
        .event<{ orderId: string }>("created")
        .tags([
          tags.durableEvent.with({
            compensation: phase === "compensation" ? "required" : undefined,
          }),
        ])
        .build();
      const calls: string[] = [];
      const app = (store: PersistentMemoryStore, deployed: boolean) => {
        const first = r
          .hook("first")
          .on(event)
          .order(deployed ? 40 : 10)
          .run(async (event) => {
            calls.push(deployed ? "current:first" : "original:first");
            return { reservationId: event.data.orderId };
          })
          .compensate(async (receipt) => {
            calls.push(
              `undo:${deployed ? "current" : "original"}:${receipt.reservationId}`,
            );
            if (!deployed) throw new Error("undo offline");
          })
          .build();
        const second = r
          .hook("second")
          .on(event)
          .order(20)
          .run(async () => {
            calls.push(deployed ? "current:second" : "original:second");
            if (!deployed) throw new Error("offline");
          })
          .compensate(async () => {})
          .build();
        const third = r
          .hook("third")
          .on(event)
          .order(deployed ? 10 : 30)
          .run(async () => {
            calls.push(deployed ? "current:third" : "original:third");
          })
          .compensate(async () => {})
          .build();
        const added = r
          .hook("added")
          .on(event)
          .order(0)
          .run(async () => {
            calls.push("current:added");
          })
          .compensate(async () => {
            calls.push("undo:added");
          })
          .build();
        return r
          .resource("app")
          .register([
            resources.durable,
            durable.with({ store, execution: { maxAttempts: 1 } }),
            resources.durableEventBridge,
            event,
            first,
            second,
            third,
            ...(deployed ? [added] : []),
          ])
          .build();
      };
      try {
        const originalStore = new PersistentMemoryStore({ filePath });
        const original = await run(app(originalStore, false), { logs });
        let executionId: string;
        try {
          await expect(
            original.emitEvent(event, { orderId: "order-1" }),
          ).rejects.toThrow("offline");
          const execution = (await originalStore.listExecutions())[0];
          executionId = execution.id;
          if (phase === "forward") {
            // Model process loss after a checkpoint, before the attempt outcome committed.
            await originalStore.saveExecution({
              ...execution,
              status: "pending",
              completedAt: undefined,
              error: undefined,
            });
          } else {
            expect(execution.status).toBe("compensation_failed");
          }
        } finally {
          await original.dispose();
        }
        const deployedStore = new PersistentMemoryStore({ filePath });
        const deployed = await run(app(deployedStore, true), { logs });
        try {
          const d = deployed.getResourceValue(durable);
          calls.length = 0;
          if (phase === "compensation") {
            await d.operator.retryRollback(executionId!);
          }
          await d.recover();
          if (phase === "forward") {
            await expect(d.wait(executionId!)).resolves.toMatchObject({
              totalListeners: 3,
              succeededListeners: 3,
            });
            expect(calls).toEqual(["current:second", "current:third"]);
          } else {
            await expect(d.wait(executionId!)).rejects.toThrow("offline");
            expect(calls).toEqual(["undo:current:order-1"]);
          }
          const saved = await deployedStore.getExecution(executionId!);
          expect(saved!.input).not.toHaveProperty("version");
          calls.length = 0;
          await deployed.emitEvent(event, { orderId: "order-2" });
          expect(calls).toEqual([
            "current:added",
            "current:third",
            "current:second",
            "current:first",
          ]);
        } finally {
          await deployed.dispose();
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});
