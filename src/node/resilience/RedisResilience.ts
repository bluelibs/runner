import type { ConcurrencyWaitOptions } from "../../globals/middleware/concurrency/wait";
import { createHash, randomUUID } from "node:crypto";
import { Match } from "../../tools/check";
import { middlewareKeyCapacityExceededError } from "../../errors";
import { resilienceError } from "../../globals/resilience/errors";
import type {
  CircuitAdmission,
  CircuitSnapshot,
  Resilience,
  ResilienceConfig,
} from "../../globals/resilience/types";
import { rateLimitScript, circuitScript, permitScript } from "./scripts";
import { withRedisPermit } from "./permit";

/** Minimal Redis transport used by the resilience implementation. */
export interface ResilienceRedisClient {
  /** Run one atomic operation. */
  eval(
    script: string,
    count: number,
    ...args: (string | number)[]
  ): Promise<unknown>;
  /** Verify connection readiness during resource initialization. */
  ping(): Promise<unknown>;
  /** Close the owned connection immediately, including after a failed connection. */
  disconnect(): void;
}

const circuitReply = Match.compile([Match.OneOf(Number, String)]);

/** Redis-backed coordination scoped by namespace and complete policy identity. */
export class RedisResilience implements Resilience {
  private readonly namespace: string;
  private readonly controller = new AbortController();
  private readonly active = new Set<Promise<unknown>>();
  private readonly waiters = new Map<string, number>();
  readonly leaseMs: number;

  constructor(
    private readonly redis: ResilienceRedisClient,
    config: ResilienceConfig,
  ) {
    this.namespace = config.namespace;
    this.leaseMs = config.leaseMs ?? 30_000;
  }

  private keys(feature: string, identity: string): [string, string] {
    // The hash tag keeps each policy's keys in one Redis Cluster slot.
    const hash = createHash("sha256")
      .update(JSON.stringify([this.namespace, feature, identity]))
      .digest("hex");
    return [
      `runner:resilience:{${hash}}:state`,
      `runner:resilience:{${hash}}:index`,
    ];
  }

  async rateLimit(
    taskId: string,
    key: string,
    max: number,
    windowMs: number,
    maxKeys?: number,
  ) {
    const reply = Match.compile([Number]).parse(
      await this.redis.eval(
        rateLimitScript,
        2,
        ...this.keys("rate", taskId),
        JSON.stringify(key),
        max,
        windowMs,
        maxKeys ?? 0,
      ),
    );
    if (reply[0] === -2) {
      middlewareKeyCapacityExceededError.throw({
        middlewareId: taskId,
        maxKeys: maxKeys!,
      });
    }
    this.assertPolicy(reply[0]);
    return {
      allowed: reply[0] === 1,
      remaining: reply[1],
      resetTime: reply[2],
    };
  }

  async enterCircuit(
    taskId: string,
    threshold: number,
    resetMs: number,
  ): Promise<CircuitAdmission> {
    return this.circuit(taskId, "enter", threshold, resetMs, randomUUID());
  }

  async settleCircuit(
    taskId: string,
    admission: CircuitAdmission,
    success: boolean,
  ): Promise<CircuitSnapshot> {
    return this.circuit(
      taskId,
      success ? "success" : "failure",
      0,
      0,
      admission.generation,
    );
  }

  private async circuit(
    taskId: string,
    action: string,
    threshold: number,
    resetMs: number,
    generation: string,
  ): Promise<CircuitAdmission> {
    const reply = circuitReply.parse(
      await this.redis.eval(
        circuitScript,
        1,
        this.keys("circuit", taskId)[0],
        action,
        threshold,
        resetMs,
        this.leaseMs,
        generation,
        randomUUID(),
      ),
    );
    const allowed = Match.compile(Number).parse(reply[0]);
    const phase = Match.compile(Match.OneOf(0, 1, 2)).parse(reply[1]);
    const failures = Match.compile(Number).parse(reply[2]);
    const token = Match.compile(String).parse(reply[3]);
    this.assertPolicy(allowed);
    if (allowed === -2)
      resilienceError.throw({
        message:
          "Circuit state was lost or the probe lease expired before its outcome was recorded.",
      });
    return {
      allowed: allowed === 1,
      state: phase === 0 ? "CLOSED" : phase === 1 ? "OPEN" : "HALF_OPEN",
      failures,
      generation: token,
    };
  }

  withPermit<T>(
    key: string,
    limit: number,
    signal: AbortSignal | undefined,
    abort: (reason: Error) => void,
    run: () => Promise<T>,
    wait?: ConcurrencyWaitOptions,
  ): Promise<T> {
    const execute = async (operation: string, token: string) => {
      const result = Match.compile(Number).parse(
        await this.redis.eval(
          permitScript,
          2,
          ...this.keys("concurrency", key),
          operation,
          limit,
          token,
          this.leaseMs,
        ),
      );
      this.assertPolicy(result);
      return result === 1;
    };
    const pending = withRedisPermit({
      execute,
      wait,
      queue: { key, counts: this.waiters },
      leaseMs: this.leaseMs,
      signal,
      shutdown: this.controller.signal,
      abort,
      run,
    });
    this.active.add(pending);
    void pending.then(
      () => this.active.delete(pending),
      () => this.active.delete(pending),
    );
    return pending;
  }

  private assertPolicy(code: number) {
    if (code === -1)
      resilienceError.throw({
        message:
          "Conflicting resilience policies in the same Redis namespace. Use identical limits or a different namespace/key.",
      });
  }

  async dispose() {
    this.controller.abort(
      resilienceError.new({ message: "Resilience resource is disposing." }),
    );
    await Promise.allSettled(this.active);
    this.redis.disconnect();
  }
}
