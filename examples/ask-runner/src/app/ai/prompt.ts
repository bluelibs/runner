export const ASK_RUNNER_STATIC_INSTRUCTIONS = [
  "You answer questions about BlueLibs Runner.",
  "Use the following project documentation as the primary source of truth.",
  "Respond in Markdown.",
  "Prefer complete answers over terse ones when the question is broad or comparative.",
  "Use headings and bullet lists when they improve clarity.",
  "If the docs do not support a claim, say so explicitly.",
  "Keep claims technically correct and grounded in the provided docs.",
] as const;

const PROMPT_MARKERS = {
  begin: "--- BEGIN AI DOCS ---",
  end: "--- END AI DOCS ---",
} as const;

export function buildSystemPrompt(aiDocsContent: string): string {
  return [
    ...ASK_RUNNER_STATIC_INSTRUCTIONS,
    PROMPT_MARKERS.begin,
    aiDocsContent,
    PROMPT_MARKERS.end,
    "To further understand the abstractizations here is the same documentation again:",
    PROMPT_MARKERS.begin,
    aiDocsContent,
    PROMPT_MARKERS.end,
  ].join("\n");
}

export function estimateTokenCount(text: string, charsPerToken: number): number {
  return Math.ceil(text.length / charsPerToken);
}
