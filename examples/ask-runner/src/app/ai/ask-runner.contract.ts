import { Match } from "@bluelibs/runner";
import type OpenAI from "openai";

import type { StreamWriter } from "./openai-stream";

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

export interface StreamAskRunnerInput extends AskRunnerInput {
  writer: StreamWriter;
}

export interface AskRunnerStreamResult {
  model: string;
  usage: OpenAI.Responses.ResponseUsage | null;
  aiDocsVersion: string;
}

export const askRunnerInputSchema = Match.compile({
  query: String,
  ip: Match.NonEmptyString,
});

export const streamWriterSchema = Match.ObjectIncluding({
  write: Function,
});

export const streamAskRunnerInputSchema = Match.compile({
  query: String,
  ip: Match.NonEmptyString,
  writer: streamWriterSchema,
});
