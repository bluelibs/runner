import { RunnerError } from "../../../definers/defineError";
import {
  RunnerErrorId,
  durableExecutionError,
  middlewareCircuitBreakerOpenError,
  middlewareRateLimitExceededError,
  middlewareTimeoutError,
} from "../../../errors";
import {
  CircuitBreakerOpenError,
  circuitBreakerMiddleware,
} from "../../../globals/middleware/circuitBreaker.middleware";
import {
  RateLimitError,
  rateLimitTaskMiddleware,
} from "../../../globals/middleware/rateLimit.middleware";
import {
  TimeoutError,
  timeoutResourceMiddleware,
  timeoutTaskMiddleware,
} from "../../../globals/middleware/timeout.middleware";
import { DurableExecutionError } from "../../../node/durable/core/utils";

describe("Typed Infrastructure Errors", () => {
  it("maps timeout errors to a typed RunnerError id/data shape", () => {
    const err = new TimeoutError("Operation timed out after 100ms");

    expect(err).toBeInstanceOf(RunnerError);
    expect(err.name).toBe(RunnerErrorId.MiddlewareTimeout);
    expect(err.data.message).toBe("Operation timed out after 100ms");
    expect(middlewareTimeoutError.is(err)).toBe(true);
  });

  it("maps circuit breaker open errors to a typed RunnerError id/data shape", () => {
    const err = new CircuitBreakerOpenError('Circuit is OPEN for task "x"');

    expect(err).toBeInstanceOf(RunnerError);
    expect(err.name).toBe(RunnerErrorId.MiddlewareCircuitBreakerOpen);
    expect(err.data.message).toContain("Circuit is OPEN");
    expect(middlewareCircuitBreakerOpenError.is(err)).toBe(true);
  });

  it("maps rate limit errors to a typed RunnerError id/data shape", () => {
    const err = new RateLimitError("Rate limit exceeded");

    expect(err).toBeInstanceOf(RunnerError);
    expect(err.name).toBe(RunnerErrorId.MiddlewareRateLimitExceeded);
    expect(err.data.message).toBe("Rate limit exceeded");
    expect(middlewareRateLimitExceededError.is(err)).toBe(true);
  });

  it("maps durable execution errors to a typed RunnerError id/data shape", () => {
    const err = new DurableExecutionError(
      "Execution failed",
      "exec-1",
      "task-1",
      3,
      { message: "boom" },
    );

    expect(err).toBeInstanceOf(RunnerError);
    expect(err.name).toBe(RunnerErrorId.DurableExecutionError);
    expect(err.data.executionId).toBe("exec-1");
    expect(err.data.taskId).toBe("task-1");
    expect(err.data.attempt).toBe(3);
    expect(err.data.causeInfo?.message).toBe("boom");
    expect(durableExecutionError.is(err)).toBe(true);
  });

  it("declares throws contracts on infrastructure middleware", () => {
    expect(timeoutTaskMiddleware.throws).toContain(middlewareTimeoutError.id);
    expect(timeoutResourceMiddleware.throws).toContain(
      middlewareTimeoutError.id,
    );
    expect(circuitBreakerMiddleware.throws).toContain(
      middlewareCircuitBreakerOpenError.id,
    );
    expect(rateLimitTaskMiddleware.throws).toContain(
      middlewareRateLimitExceededError.id,
    );
  });

  it("builds middleware and durable helper errors with remediation/http metadata", () => {
    const timeout = middlewareTimeoutError.create({
      message: "timeout helper",
    });
    expect(timeout.httpCode).toBe(408);
    expect(timeout.message).toContain("timeout helper");
    expect(timeout.remediation).toContain("Increase timeout");

    const circuit = middlewareCircuitBreakerOpenError.create({
      message: "circuit helper",
    });
    expect(circuit.httpCode).toBe(503);
    expect(circuit.message).toContain("circuit helper");
    expect(circuit.remediation).toContain("Reduce downstream failures");

    const rateLimit = middlewareRateLimitExceededError.create({
      message: "rate limit helper",
    });
    expect(rateLimit.httpCode).toBe(429);
    expect(rateLimit.message).toContain("rate limit helper");
    expect(rateLimit.remediation).toContain("Reduce request frequency");

    const durable = durableExecutionError.create({
      message: "durable helper",
      executionId: "exec-99",
      taskId: "task-7",
      attempt: 2,
    });
    expect(durable.httpCode).toBe(500);
    expect(durable.message).toContain("durable helper");
    expect(durable.remediation).toContain('durable execution "exec-99"');
  });
});
