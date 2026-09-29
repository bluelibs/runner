import { defineTaskMiddleware } from "../../../definers/defineTaskMiddleware";
import { ExecutionJournalImpl } from "../../../models/ExecutionJournal";
import { defineTask } from "../../../definers/defineTask";
import {
  requireMiddlewareApplicationIdentity,
  scopeMiddlewareApplication,
  getMiddlewareApplicationIdentity,
} from "../../../models/middleware/applicationIdentity";

it("leaves ordinary middleware untouched and scopes registered policy applications", async () => {
  const middleware = defineTaskMiddleware({
    id: "policy",
    run: async (execution) =>
      getMiddlewareApplicationIdentity(execution, "task"),
  });
  const occurrences = new Map<string, number>();
  expect(
    scopeMiddlewareApplication(middleware, "task", "policy", occurrences),
  ).toBe(middleware);
  expect(occurrences.size).toBe(0);
  requireMiddlewareApplicationIdentity(middleware);
  const first = scopeMiddlewareApplication(
    middleware,
    "task",
    "policy",
    occurrences,
  );
  const second = scopeMiddlewareApplication(
    middleware,
    "task",
    "policy",
    occurrences,
  );
  const input = () => ({
    task: {
      definition: defineTask({ id: "task", run: async () => 1 }),
      input: undefined,
    },
    next: async () => 1,
    journal: new ExecutionJournalImpl(),
  });
  await expect(first.run(input(), {}, undefined)).resolves.toBe(
    JSON.stringify(["task", "policy", 0]),
  );
  await expect(second.run(input(), {}, undefined)).resolves.toBe(
    JSON.stringify(["task", "policy", 1]),
  );
  await expect(middleware.run(input(), {}, undefined)).resolves.toBe("task");
  expect(getMiddlewareApplicationIdentity({}, "task")).toBe("task");
});
