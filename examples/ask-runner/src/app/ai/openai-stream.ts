import type OpenAI from "openai";

import { invalidQueryError } from "../errors";

export interface StreamWriter {
  write(chunk: string): Promise<void>;
}

export async function consumeMarkdownResponseStream(
  stream: AsyncIterable<OpenAI.Responses.ResponseStreamEvent>,
  writer: StreamWriter,
): Promise<{
  model: string;
  usage: OpenAI.Responses.ResponseUsage | null;
}> {
  let finalResponse: OpenAI.Responses.Response | null = null;

  for await (const event of stream) {
    if (event.type === "response.output_text.delta" && event.delta.length > 0) {
      await writer.write(event.delta);
      continue;
    }

    if (
      event.type === "response.completed" ||
      event.type === "response.failed" ||
      event.type === "response.incomplete"
    ) {
      finalResponse = event.response;
      continue;
    }

    if (event.type === "error") {
      invalidQueryError.throw({ message: event.message });
    }
  }

  if (!finalResponse) {
    invalidQueryError.throw({
      message: "OpenAI streaming response ended without a final event.",
    });
  }

  const completedResponse = finalResponse as OpenAI.Responses.Response;

  if (completedResponse.error?.message) {
    invalidQueryError.throw({ message: completedResponse.error.message });
  }

  if (!completedResponse.output_text.trim()) {
    invalidQueryError.throw({
      message: "OpenAI returned an empty answer.",
    });
  }

  return {
    model: completedResponse.model,
    usage: completedResponse.usage ?? null,
  };
}
