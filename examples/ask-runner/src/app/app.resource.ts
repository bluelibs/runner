import { r } from "@bluelibs/runner";

import { aiDocsPrompt } from "./ai/ai-docs.resource";
import { askRunnerTask } from "./ai/ask-runner.task";
import { openAiSemaphore } from "./ai/ask-runner.task";
import { openAiClient } from "./ai/openai.resource";
import { budgetLedger } from "./budget/budget-ledger.resource";
import { sqlite } from "./budget/sqlite.resource";
import { appConfig } from "./config/app-config.resource";
import { httpServer } from "./http/http.resource";

export const app = r
  .resource("app")
  .register([
    appConfig,
    sqlite,
    budgetLedger,
    aiDocsPrompt,
    openAiClient,
    openAiSemaphore,
    askRunnerTask,
    httpServer,
  ])
  .build();
