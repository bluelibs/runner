import { r } from "@bluelibs/runner";

import { aiDocsPrompt } from "./ai-docs.resource";
import {
  type AskRunnerStreamResult,
  type StreamAskRunnerInput,
  streamAskRunnerInputSchema,
} from "./ask-runner.contract";
import { createAskRunnerMiddleware } from "./ask-runner.resilience";
import { createOpenAiResponseStream } from "./ask-runner.openai";
import { consumeMarkdownResponseStream } from "./openai-stream";
import { openAiClient } from "./openai.resource";
import { openAiSemaphore } from "./openai-semaphore.resource";
import { appConfig } from "../config/app-config.resource";
import { invalidQueryError } from "../errors";

export const streamAskRunnerTask = r
  .task<StreamAskRunnerInput>("streamAskRunner")
  .inputSchema(streamAskRunnerInputSchema)
  .dependencies({
    appConfig,
    aiDocsPrompt,
    openAiClient,
    openAiSemaphore,
  })
  .middleware(createAskRunnerMiddleware({ retry: false }))
  .throws([invalidQueryError])
  .run(
    async (
      { query, writer },
      { appConfig, aiDocsPrompt, openAiClient, openAiSemaphore },
    ): Promise<AskRunnerStreamResult> => {
      const stream = await createOpenAiResponseStream(
        {
          appConfig,
          aiDocsPrompt,
          query,
        },
        { openAiClient, openAiSemaphore },
      );

      const result = await consumeMarkdownResponseStream(stream, writer);

      return {
        model: result.model,
        usage: result.usage,
        aiDocsVersion: aiDocsPrompt.version,
      };
    },
  )
  .build();
