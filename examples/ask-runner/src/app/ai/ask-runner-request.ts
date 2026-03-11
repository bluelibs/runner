import type OpenAI from "openai";

import { buildSystemPrompt } from "./prompt";

export const askRunnerMaxOpenAiOutputTokens = 20_000;

export interface AskRunnerInput {
  query: string;
  ip: string;
}

export interface AskRunnerOutput {
  markdown: string;
  model: string;
  usage: OpenAI.Responses.ResponseUsage | null;
  aiDocsVersion: string;
}

export interface AskRunnerStreamResult {
  model: string;
  usage: OpenAI.Responses.ResponseUsage | null;
  aiDocsVersion: string;
}

interface AskRunnerRequestInput {
  model: string;
  serviceTier: "auto" | "default" | "flex" | "priority";
  reasoningEffort: "minimal" | "low" | "medium" | "high";
  maxOutputTokens: number;
  aiDocsContent: string;
  aiDocsVersion: string;
  query: string;
}

type AskRunnerRequestParams = {
  prompt_cache_retention?: "24h";
  model: string;
  service_tier: AskRunnerRequestInput["serviceTier"];
  reasoning: { effort: AskRunnerRequestInput["reasoningEffort"] };
  prompt_cache_key: string;
  max_output_tokens: number;
  input: Array<{
    role: "system" | "user";
    content: Array<{
      type: "input_text";
      text: string;
    }>;
  }>;
};

export function buildAskRunnerRequest(
  input: AskRunnerRequestInput,
): AskRunnerRequestParams {
  return {
    model: input.model,
    service_tier: input.serviceTier,
    reasoning: { effort: input.reasoningEffort },
    prompt_cache_key: `ask-runner:${input.model}:${input.aiDocsVersion}`,
    prompt_cache_retention: "24h",
    max_output_tokens: Math.min(
      input.maxOutputTokens,
      askRunnerMaxOpenAiOutputTokens,
    ),
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
