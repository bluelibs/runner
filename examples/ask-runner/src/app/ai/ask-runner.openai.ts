import { Semaphore } from "@bluelibs/runner";
import type OpenAI from "openai";

import type { AiDocsPrompt } from "./ai-docs.resource";
import { buildAskRunnerRequest } from "./ask-runner-request";
import type { AskRunnerConfig } from "../config/app-config.resource";

interface AskRunnerOpenAiInput {
  appConfig: Pick<
    AskRunnerConfig,
    "model" | "serviceTier" | "reasoningEffort" | "maxOutputTokens"
  >;
  aiDocsPrompt: Pick<AiDocsPrompt, "content" | "version">;
  query: string;
}

interface OpenAiExecutionDeps {
  openAiClient: OpenAI;
  openAiSemaphore: Semaphore;
}

function buildOpenAiRequestInput(input: AskRunnerOpenAiInput) {
  return {
    model: input.appConfig.model,
    serviceTier: input.appConfig.serviceTier,
    reasoningEffort: input.appConfig.reasoningEffort,
    maxOutputTokens: input.appConfig.maxOutputTokens,
    aiDocsContent: input.aiDocsPrompt.content,
    aiDocsVersion: input.aiDocsPrompt.version,
    query: input.query,
  };
}

export async function createOpenAiResponse(
  input: AskRunnerOpenAiInput,
  deps: OpenAiExecutionDeps,
): Promise<OpenAI.Responses.Response> {
  const request = buildAskRunnerRequest(buildOpenAiRequestInput(input));

  return deps.openAiSemaphore.withPermit(() =>
    deps.openAiClient.responses.create(request),
  );
}

export async function createOpenAiResponseStream(
  input: AskRunnerOpenAiInput,
  deps: OpenAiExecutionDeps,
): Promise<AsyncIterable<OpenAI.Responses.ResponseStreamEvent>> {
  const request = buildAskRunnerRequest(buildOpenAiRequestInput(input));

  return deps.openAiSemaphore.withPermit(() =>
    deps.openAiClient.responses.create({
      ...request,
      stream: true,
    }),
  );
}
