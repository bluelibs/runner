import { Match, Semaphore, middleware, r } from "@bluelibs/runner";

import { aiDocsPrompt } from "./ai-docs.resource";
import {
  askRunnerBudgetMiddleware,
  streamWriterSchema,
} from "./ask-runner.middleware";
import {
  type AskRunnerInput,
  type AskRunnerOutput,
  type AskRunnerStreamResult,
  buildAskRunnerRequest,
} from "./ask-runner-request";
import { consumeMarkdownResponseStream, type StreamWriter } from "./openai-stream";
import { openAiClient } from "./openai.resource";
import { appConfig } from "../config/app-config.resource";
import { invalidQueryError } from "../errors";

export const openAiSemaphore = r
  .resource("openAiSemaphore")
  .dependencies({ appConfig })
  .init(
    async (_, { appConfig }) =>
      new Semaphore(appConfig.maxConcurrentOpenAiCalls),
  )
  .dispose(async (semaphore) => {
    semaphore.dispose();
  })
  .build();

const askRunnerInputSchema = Match.compile({
  query: String,
  ip: Match.NonEmptyString,
});

export const askRunnerTask = r
  .task<AskRunnerInput>("askRunner")
  .inputSchema(askRunnerInputSchema)
  .dependencies({
    appConfig,
    aiDocsPrompt,
    openAiClient,
    openAiSemaphore,
  })
  .middleware([
    askRunnerBudgetMiddleware,
    middleware.task.timeout.with({ ttl: 45000 }),
    middleware.task.retry.with({
      retries: 2,
      stopRetryIf: (error) =>
        /400|401|403|404/.test(error.message),
    }),
    middleware.task.circuitBreaker.with({
      failureThreshold: 5,
      resetTimeout: 30000,
    }),
  ])
  .throws([invalidQueryError])
  .run(
    async (
      { query },
      { appConfig, aiDocsPrompt, openAiClient, openAiSemaphore },
    ): Promise<AskRunnerOutput> => {
      const response = await openAiSemaphore.withPermit(() =>
        openAiClient.responses.create(
          buildAskRunnerRequest({
            model: appConfig.model,
            serviceTier: appConfig.serviceTier,
            reasoningEffort: appConfig.reasoningEffort,
            maxOutputTokens: appConfig.maxOutputTokens,
            aiDocsContent: aiDocsPrompt.content,
            aiDocsVersion: aiDocsPrompt.version,
            query,
          }),
        ),
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

export interface StreamAskRunnerInput extends AskRunnerInput {
  writer: StreamWriter;
}

export const streamAskRunnerTask = r
  .task<StreamAskRunnerInput>("streamAskRunner")
  .inputSchema(
    Match.compile({
      query: String,
      ip: Match.NonEmptyString,
      writer: streamWriterSchema,
    }),
  )
  .dependencies({
    appConfig,
    aiDocsPrompt,
    openAiClient,
    openAiSemaphore,
  })
  .middleware([
    askRunnerBudgetMiddleware,
    middleware.task.timeout.with({ ttl: 45000 }),
    middleware.task.circuitBreaker.with({
      failureThreshold: 5,
      resetTimeout: 30000,
    }),
  ])
  .throws([invalidQueryError])
  .run(
    async (
      { query, writer },
      { appConfig, aiDocsPrompt, openAiClient, openAiSemaphore },
    ): Promise<AskRunnerStreamResult> => {
      const stream = await openAiSemaphore.withPermit(() =>
        openAiClient.responses.create({
          ...buildAskRunnerRequest({
            model: appConfig.model,
            serviceTier: appConfig.serviceTier,
            reasoningEffort: appConfig.reasoningEffort,
            maxOutputTokens: appConfig.maxOutputTokens,
            aiDocsContent: aiDocsPrompt.content,
            aiDocsVersion: aiDocsPrompt.version,
            query,
          }),
          stream: true,
        }),
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
