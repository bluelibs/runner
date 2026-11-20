import { randomUUID } from "node:crypto";
import { commandWakeupId } from "../../../durable/core/commandWakeup";
import type { DurableCommandRecord } from "../../../durable/core/interfaces/commands";
import {
  createPgPool,
  type PgPoolLike,
} from "../../../durable/optionalDeps/pg";
import { PostgresStore } from "../../../durable/store/PostgresStore";
import { makeSqlExecution } from "./sqlStoreContract.exec.helpers";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function watchTransactions(
  pool: PgPoolLike,
  afterQuery: (text: string) => Promise<void>,
): PgPoolLike {
  return {
    query: pool.query.bind(pool),
    async connect() {
      const client = await pool.connect();
      return {
        release: client.release.bind(client),
        async query<TRow extends Record<string, unknown>>(
          text: string,
          values?: unknown[],
        ) {
          const result = await client.query<TRow>(text, values);
          await afterQuery(text);
          return result;
        },
      };
    },
  };
}

function interleaveReadsFrom(table: string) {
  const both = deferred();
  let observed = 0;
  return async (text: string) => {
    if (
      !text.startsWith("SELECT ") ||
      !text.includes(` FROM ${table}`) ||
      !text.includes("FOR UPDATE") ||
      observed >= 2
    )
      return;
    if (++observed === 2) both.resolve();
    await both.promise;
  };
}

function holdAfterQuery(fragment: string) {
  const seen = deferred();
  const resume = deferred();
  let held = false;
  return {
    seen: seen.promise,
    release: () => resume.resolve(),
    async observe(text: string) {
      if (held || !text.includes(fragment)) return;
      held = true;
      seen.resolve();
      await resume.promise;
    },
  };
}

function command(executionId: string): DurableCommandRecord {
  return {
    id: "approval",
    executionId,
    requestedExecutionId: executionId,
    taskKey: "approve",
    status: "pending",
    input: { approved: true },
    createdAt: new Date(),
  };
}

export function registerPostgresConcurrencyTests(connectionString: string) {
  describe("concurrent Postgres workers", () => {
    let pool: PgPoolLike;
    let namespace: string;
    let store: PostgresStore;

    beforeEach(async () => {
      pool = createPgPool(connectionString);
      namespace = `concurrency:${randomUUID()}`;
      store = new PostgresStore({ pool, namespace });
      await store.init();
    });

    afterEach(async () => {
      await pool.end?.();
    });

    it("creates the schema when two workers boot together", async () => {
      const schema = `runner_test_${randomUUID().replace(/-/g, "")}`;
      await pool.query(`CREATE SCHEMA ${schema}`);
      const scopedPool = createPgPool({
        connectionString,
        options: `-c search_path=${schema}`,
      });
      try {
        const first = new PostgresStore({ pool: scopedPool, namespace: "a" });
        const second = new PostgresStore({ pool: scopedPool, namespace: "b" });
        const boot = await Promise.allSettled([first.init(), second.init()]);
        expect(boot).toEqual([
          { status: "fulfilled", value: undefined },
          { status: "fulfilled", value: undefined },
        ]);
      } finally {
        await scopedPool.end?.();
        await pool.query(`DROP SCHEMA ${schema} CASCADE`);
      }
    });

    it("awards a new execution lease to one worker", async () => {
      const contest = new PostgresStore({
        namespace,
        pool: watchTransactions(
          pool,
          interleaveReadsFrom("runner_durable_locks"),
        ),
      });
      await contest.init();
      const owners = await Promise.all([
        contest.acquireLock("execution:race", 60_000),
        contest.acquireLock("execution:race", 60_000),
      ]);
      expect(owners.filter((owner) => owner !== null)).toHaveLength(1);
    });

    it("keeps a claim made after a batch has selected its timers", async () => {
      const timer = {
        id: "due",
        type: "retry",
        status: "pending",
        executionId: "target",
        fireAt: new Date(),
      } as const;
      await store.createTimer(timer);
      const candidate = holdAfterQuery("FOR UPDATE OF t SKIP LOCKED");
      const batch = new PostgresStore({
        namespace,
        pool: watchTransactions(pool, candidate.observe),
      });
      await batch.init();
      const selected = batch.claimReadyTimers(timer.fireAt, 1, "batch", 60_000);
      try {
        await candidate.seen;
        await expect(
          store.claimTimer(timer.id, "direct", 60_000),
        ).resolves.toBe(true);
      } finally {
        candidate.release();
        await expect(selected).resolves.toEqual([]);
      }
      await expect(
        store.renewTimerClaim(timer.id, "direct", 60_000),
      ).resolves.toBe(true);
    });

    it("returns the same receipt for simultaneous idempotent command submissions", async () => {
      await store.saveExecution(
        makeSqlExecution("target", { status: "running" }),
      );
      const submitting = new PostgresStore({
        namespace,
        pool: watchTransactions(
          pool,
          interleaveReadsFrom("runner_durable_commands WHERE namespace"),
        ),
      });
      await submitting.init();
      const request = command("target");
      await expect(
        Promise.all([
          submitting.enqueueCommand(request),
          submitting.enqueueCommand(request),
        ]),
      ).resolves.toEqual([request, request]);
      expect(await store.getNextCommand("target")).toEqual(request);
    });

    it("keeps the timer for a command admitted during an older wakeup", async () => {
      const executionId = "target";
      await store.saveExecution(
        makeSqlExecution(executionId, { status: "sleeping" }),
      );
      const empty = holdAfterQuery(
        "SELECT id, status FROM runner_durable_commands",
      );
      const polling = new PostgresStore({
        namespace,
        pool: watchTransactions(pool, empty.observe),
      });
      await polling.init();
      const rescheduled = polling.rescheduleCommandTimer(
        executionId,
        new Date(),
      );
      await empty.seen;
      const hasTargetLock = await pool
        .query(
          `SELECT id FROM runner_durable_executions
         WHERE namespace = $1 AND id = $2 FOR UPDATE NOWAIT`,
          [namespace, executionId],
        )
        .then(
          () => false,
          (error: unknown) => {
            expect(error).toMatchObject({ code: "55P03" });
            return true;
          },
        );
      const admitted = store.enqueueCommand(command(executionId));
      try {
        if (!hasTargetLock) await admitted;
      } finally {
        empty.release();
        await Promise.all([rescheduled, admitted]);
      }
      expect(
        (await store.getExecutionTimers(executionId)).map((timer) => timer.id),
      ).toEqual([commandWakeupId(executionId)]);
    });

    it("keeps both simultaneous first writes to a signal backlog", async () => {
      const executionId = "target";
      const buffering = new PostgresStore({
        namespace,
        pool: watchTransactions(
          pool,
          interleaveReadsFrom("runner_durable_signal_states"),
        ),
      });
      await buffering.init();
      const receivedAt = new Date();
      await Promise.all(
        ["a", "b"].map((id) =>
          buffering.bufferSignalRecord(executionId, "approve", {
            id,
            receivedAt,
            payload: id,
          }),
        ),
      );
      const state = await store.getSignalState(executionId, "approve");
      expect(state?.queued.map(({ id }) => id).sort()).toEqual(["a", "b"]);
      expect(state?.history.map(({ id }) => id).sort()).toEqual(["a", "b"]);
    });
  });
}
