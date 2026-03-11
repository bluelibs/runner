import {
  askRunnerMaxOpenAiOutputTokens,
  buildAskRunnerRequest,
} from "../app/ai/ask-runner-request";
import { estimateProjectedCostUsd } from "../app/http/query-request";

describe("ask runner request", () => {
  test("caps max output tokens sent to OpenAI", () => {
    const request = buildAskRunnerRequest({
      model: "gpt-5.4",
      serviceTier: "priority",
      reasoningEffort: "low",
      maxOutputTokens: askRunnerMaxOpenAiOutputTokens + 5000,
      aiDocsContent: "Runner docs",
      aiDocsVersion: "v1",
      query: "Explain resource lifecycle",
    });

    expect(request.max_output_tokens).toBe(askRunnerMaxOpenAiOutputTokens);
  });

  test("cost estimate uses the same output token cap", () => {
    const projected = estimateProjectedCostUsd(
      "Runner docs",
      "Explain resource lifecycle",
      askRunnerMaxOpenAiOutputTokens + 5000,
      4,
      {
        inputPer1M: 1,
        cachedInputPer1M: 0.1,
        outputPer1M: 2,
      },
    );

    const cappedOnly = estimateProjectedCostUsd(
      "Runner docs",
      "Explain resource lifecycle",
      askRunnerMaxOpenAiOutputTokens,
      4,
      {
        inputPer1M: 1,
        cachedInputPer1M: 0.1,
        outputPer1M: 2,
      },
    );

    expect(projected).toBe(cappedOnly);
  });
});
