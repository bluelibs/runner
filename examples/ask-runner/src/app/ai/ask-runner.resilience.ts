import { middleware } from "@bluelibs/runner";

import { askRunnerBudgetMiddleware } from "./ask-runner.middleware";

const askRunnerRetryMiddleware = middleware.task.retry.with({
  retries: 2,
  stopRetryIf: (error) => /400|401|403|404/.test(error.message),
});

const askRunnerCircuitBreakerMiddleware = middleware.task.circuitBreaker.with({
  failureThreshold: 5,
  resetTimeout: 30000,
});

const askRunnerTimeoutMiddleware = middleware.task.timeout.with({ ttl: 45000 });

export function createAskRunnerMiddleware(options: { retry: boolean }) {
  return [
    askRunnerBudgetMiddleware,
    askRunnerTimeoutMiddleware,
    ...(options.retry ? [askRunnerRetryMiddleware] : []),
    askRunnerCircuitBreakerMiddleware,
  ];
}
