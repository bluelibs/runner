import { Semaphore } from "@bluelibs/runner";

import { invalidQueryError } from "../app/errors";
import { askRunnerTask } from "../app/ai/ask-runner.task";
import { streamAskRunnerTask } from "../app/ai/stream-ask-runner.task";
import type { AskRunnerConfig } from "../app/config/app-config.resource";
import type { AiDocsPrompt } from "../app/ai/ai-docs.resource";

type AskRunnerDeps = Parameters<typeof askRunnerTask.run>[1];
type OpenAiClientDeps = Parameters<typeof askRunnerTask.run>[1]["openAiClient"];

function createDeps(): Omit<AskRunnerDeps, "openAiClient"> {
  const appConfig: AskRunnerConfig = {
    openAiApiKey: "test-key",
    openAiApiUrl: null,
    adminSecret: "test-secret",
    host: "127.0.0.1",
    port: 3010,
    sqlitePath: "/tmp/ask-runner.test.db",
    dailyBudgetUsd: 5,
    trustProxy: true,
    rateLimitPerMinute: 5,
    rateLimitPerHour: 60,
    rateLimitPerDay: 100,
    maxConcurrentOpenAiCalls: 2,
    maxInputChars: 1000,
    model: "gpt-5.4",
    maxOutputTokens: 9000,
    tokenCharsEstimate: 4,
    reasoningEffort: "low",
    serviceTier: "priority",
    pricing: {
      inputPer1M: 0.25,
      cachedInputPer1M: 0.025,
      outputPer1M: 2,
    },
  };

  const aiDocsPrompt: AiDocsPrompt = {
    content: "Runner docs body",
    version: "v-test",
    filePath: "/virtual/COMPACT_GUIDE.md",
  };

  return {
    appConfig,
    aiDocsPrompt,
    openAiSemaphore: new Semaphore(appConfig.maxConcurrentOpenAiCalls),
  };
}

function createOpenAiClientMock(responsesCreate: jest.Mock): OpenAiClientDeps {
  return {
    responses: {
      create: responsesCreate as never,
    },
  } as unknown as OpenAiClientDeps;
}

describe("askRunner task", () => {
  test("uses mocked OpenAI responses for non-streaming requests", async () => {
    const responsesCreate = jest.fn(async () => ({
      output_text: "# Answer",
      model: "gpt-5.4",
      usage: { input_tokens: 120, output_tokens: 45 },
    }));
    const deps: AskRunnerDeps = {
      ...createDeps(),
      openAiClient: createOpenAiClientMock(responsesCreate),
    };

    const result = await askRunnerTask.run(
      { query: "Explain lifecycle", ip: "127.0.0.1" },
      deps,
    );

    expect(responsesCreate).toHaveBeenCalledTimes(1);
    expect(responsesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5.4",
        prompt_cache_key: "ask-runner:gpt-5.4:v-test",
      }),
    );
    expect(result).toEqual({
      markdown: "# Answer",
      model: "gpt-5.4",
      usage: { input_tokens: 120, output_tokens: 45 },
      aiDocsVersion: "v-test",
    });
  });

  test("uses mocked OpenAI responses for streaming requests", async () => {
    const writer = {
      write: jest.fn(async (_chunk: string) => undefined),
    };

    async function* streamEvents() {
      yield { type: "response.output_text.delta", delta: "# Answer" };
      yield { type: "response.output_text.delta", delta: "\n\nStream" };
      yield {
        type: "response.completed",
        response: {
          model: "gpt-5.4",
          usage: { input_tokens: 220, output_tokens: 60 },
          output_text: "# Answer\n\nStream",
        },
      };
    }

    const responsesCreate = jest.fn(async () => streamEvents());
    const deps: AskRunnerDeps = {
      ...createDeps(),
      openAiClient: createOpenAiClientMock(responsesCreate),
    };

    const result = await streamAskRunnerTask.run(
      { query: "Explain lifecycle", ip: "127.0.0.1", writer },
      deps,
    );

    expect(responsesCreate).toHaveBeenCalledTimes(1);
    expect(responsesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5.4",
        stream: true,
      }),
    );
    expect(writer.write).toHaveBeenNthCalledWith(1, "# Answer");
    expect(writer.write).toHaveBeenNthCalledWith(2, "\n\nStream");
    expect(result).toEqual({
      model: "gpt-5.4",
      usage: { input_tokens: 220, output_tokens: 60 },
      aiDocsVersion: "v-test",
    });
  });

  test("throws when mocked OpenAI returns an empty answer", async () => {
    const responsesCreate = jest.fn(async () => ({
      output_text: "   ",
      model: "gpt-5.4",
      usage: null,
    }));
    const deps: AskRunnerDeps = {
      ...createDeps(),
      openAiClient: createOpenAiClientMock(responsesCreate),
    };

    try {
      await askRunnerTask.run(
        { query: "Explain lifecycle", ip: "127.0.0.1" },
        deps,
      );
    } catch (error) {
      expect(invalidQueryError.is(error)).toBe(true);
      return;
    }

    throw new Error(
      "Expected askRunnerTask to reject when OpenAI returns an empty answer.",
    );
  });
});
