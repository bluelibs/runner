import { r } from "@bluelibs/runner";

import { aiDocsPrompt } from "./ai-docs.resource";
import {
  type AskRunnerInput,
  type AskRunnerOutput,
  askRunnerInputSchema,
} from "./ask-runner.contract";
import { createAskRunnerMiddleware } from "./ask-runner.resilience";
import { createOpenAiResponse } from "./ask-runner.openai";
import { openAiClient } from "./openai.resource";
import { openAiSemaphore } from "./openai-semaphore.resource";
import { appConfig } from "../config/app-config.resource";
import { invalidQueryError } from "../errors";

export const askRunnerTask = r
  .task<AskRunnerInput>("askRunner")
  .inputSchema(askRunnerInputSchema)
  .dependencies({
    appConfig,
    aiDocsPrompt,
    openAiClient,
    openAiSemaphore,
  })
  .middleware(createAskRunnerMiddleware({ retry: true }))
  .throws([invalidQueryError])
  .run(
    async (
      { query },
      { appConfig, aiDocsPrompt, openAiClient, openAiSemaphore },
    ): Promise<AskRunnerOutput> => {
      const response = await createOpenAiResponse(
        {
          appConfig,
          aiDocsPrompt,
          query,
        },
        { openAiClient, openAiSemaphore },
      );

      const markdown = response.output_text?.trim();
      if (!markdown) {
        invalidQueryError.throw({
          message: "OpenAI returned an empty answer.",
        });
      }

      return {
        markdown,
        model: response.model,
        usage: response.usage ?? null,
        aiDocsVersion: aiDocsPrompt.version,
      };
    },
  )
  .build();
