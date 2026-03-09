import { Match, Semaphore, r } from "@bluelibs/runner";
import type OpenAI from "openai";

import { aiDocsPrompt } from "./ai-docs.resource";
import { buildSystemPrompt } from "./prompt";
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

export interface AskRunnerInput {
  query: string;
}

export interface AskRunnerOutput {
  markdown: string;
  model: string;
  usage: OpenAI.Responses.ResponseUsage | null;
  aiDocsVersion: string;
}

type AskRunnerResponseCreateParams =
  OpenAI.Responses.ResponseCreateParamsNonStreaming & {
    prompt_cache_retention?: "24h";
  };

const askRunnerInputSchema = Match.compile({
  query: Match.NonEmptyString,
});

export function buildAskRunnerRequest(input: {
  model: string;
  serviceTier: "auto" | "default" | "flex" | "priority";
  reasoningEffort: "minimal" | "low" | "medium" | "high";
  maxOutputTokens: number;
  aiDocsContent: string;
  aiDocsVersion: string;
  query: string;
}): AskRunnerResponseCreateParams {
  return {
    stream: false,
    model: input.model,
    service_tier: input.serviceTier,
    reasoning: { effort: input.reasoningEffort },
    prompt_cache_key: `ask-runner:${input.model}:${input.aiDocsVersion}`,
    prompt_cache_retention: "24h",
    max_output_tokens: input.maxOutputTokens,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: buildSystemPrompt(input.aiDocsContent),
          },
        ],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: input.query }],
      },
    ],
  };
}

export const askRunnerTask = r
  .task<AskRunnerInput>("askRunner")
  .inputSchema(askRunnerInputSchema)
  .dependencies({
    appConfig,
    aiDocsPrompt,
    openAiClient,
    openAiSemaphore,
  })
  .throws([invalidQueryError])
  .run(
    async (
      { query },
      { appConfig, aiDocsPrompt, openAiClient, openAiSemaphore },
    ): Promise<AskRunnerOutput> => {
      const normalizedQuery = query.trim();
      if (normalizedQuery.length === 0) {
        invalidQueryError.throw({ message: "Query must not be empty." });
      }

      const response = await openAiSemaphore.withPermit(() =>
        openAiClient.responses.create(
          buildAskRunnerRequest({
            model: appConfig.model,
            serviceTier: appConfig.serviceTier,
            reasoningEffort: appConfig.reasoningEffort,
            maxOutputTokens: appConfig.maxOutputTokens,
            aiDocsContent: aiDocsPrompt.content,
            aiDocsVersion: aiDocsPrompt.version,
            query: normalizedQuery,
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
