import { r } from "@bluelibs/runner";

import { aiDocsPrompt } from "./ai/ai-docs.resource";
import { askRunnerBudgetMiddleware } from "./ai/ask-runner.middleware";
import { openAiClient } from "./ai/openai.resource";
import { openAiSemaphore } from "./ai/openai-semaphore.resource";
import { askRunnerTask } from "./ai/ask-runner.task";
import { streamAskRunnerTask } from "./ai/stream-ask-runner.task";
import { budgetLedger } from "./budget/budget-ledger.resource";
import { appConfig } from "./config/app-config.resource";
import {
  getAskRunnerHealthTask,
  getBudgetSnapshotTask,
  resumeBudgetTask,
  stopBudgetForDayTask,
} from "./http/http-endpoints.task";
import { httpRoute } from "./http/http-route.tag";
import { httpRouter } from "./http/http-router.resource";
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
    httpRoute,
    getAskRunnerHealthTask,
    getBudgetSnapshotTask,
    stopBudgetForDayTask,
    resumeBudgetTask,
    httpRouter,
    httpServer,
  ])
  .build();
