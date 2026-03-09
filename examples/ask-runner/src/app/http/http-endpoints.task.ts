import { Match, middleware, r } from "@bluelibs/runner";

import { budgetLedger, dayKey, type BudgetSnapshot } from "../budget/budget-ledger.resource";
import { httpRoute } from "./http-route.tag";

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
  .tags([
    httpRoute.with({
      method: "get",
      path: "/health",
      responseType: "json",
      inputFrom: "none",
    }),
  ])
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
  .task("getBudgetSnapshot")
  .inputSchema(Match.compile({}))
  .dependencies({ budgetLedger })
  .middleware(endpointTaskMiddleware)
  .tags([
    httpRoute.with({
      method: "get",
      path: "/admin/budget",
      responseType: "json",
      inputFrom: "none",
      admin: true,
    }),
  ])
  .run(async (_input, { budgetLedger }): Promise<BudgetSnapshot> => {
    return budgetLedger.getSnapshot(dayKey(new Date()));
  })
  .build();

export const stopBudgetForDayTask = r
  .task<{ reason?: string }>("stopBudgetForDay")
  .inputSchema(
    Match.compile({
      reason: Match.Optional(String),
    }),
  )
  .dependencies({ budgetLedger })
  .middleware(endpointTaskMiddleware)
  .tags([
    httpRoute.with({
      method: "post",
      path: "/admin/stop-for-day",
      responseType: "json",
      inputFrom: "body",
      admin: true,
    }),
  ])
  .run(async ({ reason }, { budgetLedger }): Promise<BudgetSnapshot> => {
    return budgetLedger.stopForDay(
      dayKey(new Date()),
      reason?.trim() || "Stopped manually.",
    );
  })
  .build();

export const resumeBudgetTask = r
  .task("resumeBudget")
  .inputSchema(Match.compile({}))
  .dependencies({ budgetLedger })
  .middleware(endpointTaskMiddleware)
  .tags([
    httpRoute.with({
      method: "post",
      path: "/admin/resume",
      responseType: "json",
      inputFrom: "none",
      admin: true,
    }),
  ])
  .run(async (_input, { budgetLedger }): Promise<BudgetSnapshot> => {
    return budgetLedger.resume(dayKey(new Date()));
  })
  .build();
