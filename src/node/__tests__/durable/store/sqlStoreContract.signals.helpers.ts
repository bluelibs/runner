import {
  MAX_QUEUED_SIGNALS_PER_KEY,
  MAX_SIGNAL_HISTORY_PER_KEY,
  type DurableSignalState,
} from "../../../durable/core/types";
import {
  contractT0,
  type SqlContractFactory,
} from "./sqlStoreContract.exec.helpers";
import { registerSqlWaitersContractTests } from "./sqlStoreContract.waiters.helpers";

export function registerSqlSignalContractTests(
  label: string,
  factory: SqlContractFactory,
): void {
  describe(`${label}: signals, trimming, buffering, and overflow`, () => {
    it("handles signal state records, trimming, buffering, and queue overflow", async () => {
      const store = await factory.createStore({ namespace: "coord-sig" });
      try {
        expect(await store.getSignalState("e1", "sig")).toBeNull();
        expect(await store.consumeQueuedSignalRecord("e1", "sig")).toBeNull();

        const internals = store as unknown as {
          runtime: {
            namespace: string;
            stringify: (v: unknown) => string;
            backend: {
              run: (
                sql: string,
                p: readonly (string | number | null)[],
              ) => Promise<void>;
            };
          };
        };
        const seedState = (
          executionId: string,
          signalId: string,
          state: DurableSignalState,
        ) =>
          internals.runtime.backend.run(
            `INSERT INTO runner_durable_signal_states (namespace, execution_id, signal_id, payload)
             VALUES (?, ?, ?, ?)
             ON CONFLICT (namespace, execution_id, signal_id) DO UPDATE SET payload = EXCLUDED.payload`,
            [
              internals.runtime.namespace,
              executionId,
              signalId,
              internals.runtime.stringify(state),
            ],
          );

        await store.bufferSignalRecord("fresh-e", "fresh-s", {
          id: "fr",
          payload: 0,
          receivedAt: contractT0,
        });
        await store.appendSignalRecord("e1", "sig-b", {
          id: "r0",
          payload: 0,
          receivedAt: contractT0,
        });
        await seedState("e1", "sig-a", {
          executionId: "e1",
          signalId: "sig-a",
          history: Array.from(
            { length: MAX_SIGNAL_HISTORY_PER_KEY },
            (_, i) => ({
              id: `h-${i}`,
              payload: i,
              receivedAt: contractT0,
            }),
          ),
          queued: [],
        });
        await store.appendSignalRecord("e1", "sig-a", {
          id: "h-trim",
          payload: "new",
          receivedAt: contractT0,
        });
        expect(
          (await store.getSignalState("e1", "sig-a"))?.history,
        ).toHaveLength(MAX_SIGNAL_HISTORY_PER_KEY);
        expect(
          (await store.listSignalStates!("e1")).map((s) => s.signalId),
        ).toEqual(["sig-a", "sig-b"]);

        await store.bufferSignalRecord("e1", "sig-a", {
          id: "q1",
          payload: { ok: true },
          receivedAt: contractT0,
        });
        await store.enqueueQueuedSignalRecord("e1", "sig-a", {
          id: "q2",
          payload: "second",
          receivedAt: contractT0,
        });
        expect((await store.consumeQueuedSignalRecord("e1", "sig-a"))?.id).toBe(
          "q1",
        );
        expect(
          await store.consumeBufferedSignalForStep({
            executionId: "e1",
            stepId: "__signal:sig-a",
            result: { state: "waiting" },
            completedAt: contractT0,
          }),
        ).toMatchObject({ id: "q2", payload: "second" });
        expect(
          await store.consumeBufferedSignalForStep({
            executionId: "e1",
            stepId: "bad",
            result: { state: "waiting", signalId: "sig-a" },
            completedAt: contractT0,
          }),
        ).toBeNull();
        await store.enqueueQueuedSignalRecord("e1", "sig-a", {
          id: "q3",
          payload: "prim",
          receivedAt: contractT0,
        });
        await expect(
          store.consumeBufferedSignalForStep({
            executionId: "e1",
            stepId: "custom",
            result: "primitive",
            completedAt: contractT0,
          }),
        ).rejects.toThrow(/Unable to resolve signal id/);
        expect(
          await store.consumeBufferedSignalForStep({
            executionId: "e1",
            stepId: "custom",
            result: { state: "waiting", signalId: "sig-a" },
            completedAt: contractT0,
          }),
        ).toMatchObject({ id: "q3" });
        await store.enqueueQueuedSignalRecord("e1", "sig-a", {
          id: "q4",
          payload: 4,
          receivedAt: contractT0,
        });
        expect(
          await store.consumeBufferedSignalForStep({
            executionId: "e1",
            stepId: "__signal:sig-a",
            result: 123,
            completedAt: contractT0,
          }),
        ).toMatchObject({ id: "q4" });

        await seedState("e-max", "sig", {
          executionId: "e-max",
          signalId: "sig",
          history: [],
          queued: Array.from(
            { length: MAX_QUEUED_SIGNALS_PER_KEY },
            (_, i) => ({
              id: `m-${i}`,
              payload: i,
              receivedAt: contractT0,
            }),
          ),
        });
        await expect(
          store.bufferSignalRecord("e-max", "sig", {
            id: "overflow",
            payload: 1,
            receivedAt: contractT0,
          }),
        ).rejects.toThrow();
      } finally {
        await store.dispose!();
      }
    });
  });

  registerSqlWaitersContractTests(label, factory);
}
