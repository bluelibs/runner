/** Optional real-Redis scale check: build first, then run with redis-server on PATH. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Redis from "ioredis";
import { RedisStore, DurableOperator } from "../dist/node/node.mjs";

const directory = await mkdtemp(join(tmpdir(), "runner-pagination-"));
const socket = join(directory, "redis.sock");
const server = spawn("redis-server", [
  "--port",
  "0",
  "--unixsocket",
  socket,
  "--save",
  "",
  "--appendonly",
  "no",
]);
let serverLog = "";
server.stdout.on("data", (chunk) => {
  serverLog = (serverLog + chunk).slice(-4000);
});
server.stderr.on("data", (chunk) => {
  serverLog = (serverLog + chunk).slice(-4000);
});
const redis = new Redis({ path: socket, retryStrategy: () => 50 });
redis.on("error", () => {});
const execution = (index) => ({
  id: `run-${String(index).padStart(6, "0")}`,
  workflowKey: `workflow-${index % 50}`,
  status: index < 20 ? "running" : "completed",
  input: { secret: "x".repeat(256) },
  attempt: 1,
  maxAttempts: 1,
  createdAt: new Date(1700000000000 + Math.floor(index / 3)),
  updatedAt: new Date(1700000000000),
});

try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(`Redis did not start within 10 seconds: ${serverLog}`),
        ),
      10000,
    );
    redis.once("ready", () => {
      clearTimeout(timer);
      resolve();
    });
    server.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    server.once("exit", () => {
      clearTimeout(timer);
      reject(new Error(`Redis exited during startup: ${serverLog}`));
    });
  });
  const store = new RedisStore({ redis, prefix: "scale:" });
  const operator = new DurableOperator(store);
  const seedStart = performance.now();
  for (let batch = 0; batch < 100000; batch += 250) {
    await Promise.all(
      Array.from({ length: 250 }, (_, index) =>
        store.saveExecution(execution(batch + index)),
      ),
    );
  }
  console.log(
    `Seeded 100,000 executions / 50 types / 20 active in ${Math.round(performance.now() - seedStart)}ms`,
  );
  let cursor;
  const ids = new Set();
  const timings = [];
  do {
    const start = performance.now();
    const page = await operator.listExecutionStates({ limit: 100, cursor });
    timings.push(performance.now() - start);
    assert.ok(page.states.length <= 100);
    for (const state of page.states) {
      assert.equal("input" in state, false);
      assert.equal(ids.has(state.id), false);
      ids.add(state.id);
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  assert.equal(ids.size, 100000);
  assert.equal(
    (await operator.listExecutionStates({ status: ["running", "sleeping"] }))
      .states.length,
    20,
  );
  assert.equal(
    (
      await operator.listExecutionStates({
        workflowKey: "workflow-19",
        status: ["running"],
      })
    ).states[0].id,
    "run-000019",
  );
  await store.updateExecution("run-000000", { attempt: 2 });
  const exact = await operator.getExecutionState("run-000000");
  assert.equal(exact.attempt, 2);
  assert.equal("input" in exact, false);
  assert.equal(await operator.getExecutionState("missing"), null);
  const before = await operator.listExecutionStates({ limit: 40 });
  await store.saveExecution(execution(100000));
  const after = await operator.listExecutionStates({
    limit: 40,
    cursor: before.nextCursor,
  });
  assert.equal(
    after.states.some((state) =>
      before.states.some((head) => head.id === state.id),
    ),
    false,
  );
  await store.saveExecutionIfStatus({ ...execution(19), status: "completed" }, [
    "running",
  ]);
  assert.equal(
    (await operator.listExecutionStates({ status: ["running"] })).states.length,
    19,
  );
  const legacy = new RedisStore({ redis, prefix: "legacy:" });
  await redis.set(
    "legacy:exec:run-000001",
    await redis.get("scale:exec:run-000001"),
  );
  await redis.sadd("legacy:all_executions", "run-000001");
  const evaluate = redis.eval.bind(redis);
  let raced = false;
  redis.eval = async (...args) => {
    if (
      !raced &&
      args[0].includes('if redis.call("get", KEYS[1]) ~= ARGV[1]')
    ) {
      raced = true;
      await legacy.updateExecution("run-000001", { status: "failed" });
    }
    return evaluate(...args);
  };
  await legacy.rebuildExecutionIndex();
  assert.equal(raced, true);
  assert.equal((await legacy.getExecutionState("run-000001")).status, "failed");
  assert.equal(
    (await legacy.listExecutionStates({ status: ["running"] })).length,
    0,
  );
  redis.eval = evaluate;
  const idem = await store.createExecutionWithIdempotencyKey({
    execution: execution(100001),
    workflowKey: "workflow-1",
    idempotencyKey: "once",
  });
  assert.equal(idem.created, true);
  assert.equal(await redis.sismember("scale:all_executions", "run-100001"), 1);
  assert.equal(
    (
      await store.createExecutionWithIdempotencyKey({
        execution: execution(100002),
        workflowKey: "workflow-1",
        idempotencyKey: "once",
      })
    ).created,
    false,
  );

  // Backfill is explicit and preserves writes racing a batch.
  await redis.del(
    "scale:execution_index_metadata",
    "scale:execution_index_states",
  );
  await assert.rejects(() => operator.listExecutionStates(), /backfill/);
  let backfillCursor;
  do {
    const batch = await operator.rebuildExecutionIndex({
      cursor: backfillCursor,
      limit: 1000,
    });
    backfillCursor = batch.nextCursor ?? undefined;
  } while (backfillCursor);
  assert.equal(
    (await operator.listExecutionStates({ status: ["running"] })).states.length,
    19,
  );
  timings.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      uniqueExecutions: ids.size,
      pages: timings.length,
      medianPageMs: +timings[Math.floor(timings.length / 2)].toFixed(2),
      p95PageMs: +timings[Math.floor(timings.length * 0.95)].toFixed(2),
      maxPageMs: +timings.at(-1).toFixed(2),
      indexedFilters: "passed",
      idempotency: "passed",
      backfill: "passed",
    }),
  );
} finally {
  redis.disconnect();
  if (server.exitCode === null) {
    server.kill("SIGTERM");
    await once(server, "exit");
  }
  await rm(directory, { recursive: true });
}
