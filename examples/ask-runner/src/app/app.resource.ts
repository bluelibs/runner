import { r } from "@bluelibs/runner";

import { aiDocsPrompt } from "./ai/ai-docs.resource";
import { askRunnerBudgetMiddleware } from "./ai/ask-runner.middleware";
import { askRunnerTask } from "./ai/ask-runner.task";
import { openAiSemaphore } from "./ai/ask-runner.task";
import { streamAskRunnerTask } from "./ai/ask-runner.task";
import { openAiClient } from "./ai/openai.resource";
import { budgetLedger } from "./budget/budget-ledger.resource";
import { appConfig } from "./config/app-config.resource";
import {
  getAskRunnerHealthTask,
  getBudgetSnapshotTask,
  resumeBudgetTask,
  stopBudgetForDayTask,
} from "./http/http-endpoints.task";
import { httpServer } from "./http/http.resource";

export const app = r
  .resource("app")
  .register([
    appConfig,
    budgetLedger,
    aiDocsPrompt,
    openAiClient,
    openAiSemaphore,
    askRunnerBudgetMiddleware,
    askRunnerTask,
    streamAskRunnerTask,
    getAskRunnerHealthTask,
    getBudgetSnapshotTask,
    stopBudgetForDayTask,
    resumeBudgetTask,
    httpServer,
  ])
  .build();
