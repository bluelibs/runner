import { Match, middleware, r } from "@bluelibs/runner";

import { budgetLedger, dayKey, type BudgetSnapshot } from "../budget/budget-ledger.resource";

export interface AskRunnerHealthOutput {
  status: "ok";
  budget: BudgetSnapshot;
  state: {
    storage: "memory";
    durable: false;
    note: string;
  };
}

const endpointTaskMiddleware = [
  middleware.task.timeout.with({ ttl: 2000 }),
];

export const getAskRunnerHealthTask = r
  .task("getAskRunnerHealth")
  .inputSchema(Match.compile({}))
  .dependencies({ budgetLedger })
  .middleware(endpointTaskMiddleware)
  .run(async (_input, { budgetLedger }): Promise<AskRunnerHealthOutput> => {
    return {
      status: "ok",
      budget: budgetLedger.getSnapshot(dayKey(new Date())),
      state: {
        storage: "memory",
        durable: false,
        note: "Budget, rate-limit, and admin stop state reset when the process restarts.",
      },
    };
  })
  .build();

export const getBudgetSnapshotTask = r
  .task<{ day: string }>("getBudgetSnapshot")
  .inputSchema(Match.compile({ day: Match.NonEmptyString }))
  .dependencies({ budgetLedger })
  .middleware(endpointTaskMiddleware)
  .run(async ({ day }, { budgetLedger }): Promise<BudgetSnapshot> => {
    return budgetLedger.getSnapshot(day);
  })
  .build();

export const stopBudgetForDayTask = r
  .task<{ day: string; reason: string }>("stopBudgetForDay")
  .inputSchema(
    Match.compile({
      day: Match.NonEmptyString,
      reason: Match.NonEmptyString,
    }),
  )
  .dependencies({ budgetLedger })
  .middleware(endpointTaskMiddleware)
  .run(async ({ day, reason }, { budgetLedger }): Promise<BudgetSnapshot> => {
    return budgetLedger.stopForDay(day, reason);
  })
  .build();

export const resumeBudgetTask = r
  .task<{ day: string }>("resumeBudget")
  .inputSchema(Match.compile({ day: Match.NonEmptyString }))
  .dependencies({ budgetLedger })
  .middleware(endpointTaskMiddleware)
  .run(async ({ day }, { budgetLedger }): Promise<BudgetSnapshot> => {
    return budgetLedger.resume(day);
  })
  .build();
