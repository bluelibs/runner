import { buildSystemPrompt, estimateTokenCount } from "../app/ai/prompt";

describe("prompt helpers", () => {
  test("buildSystemPrompt keeps static instructions and AI docs markers", () => {
    const prompt = buildSystemPrompt("Runner docs body");

    expect(prompt).toContain("You answer questions about BlueLibs Runner.");
    expect(prompt).toContain("--- BEGIN AI DOCS ---");
    expect(prompt).toContain("Runner docs body");
    expect(prompt).toContain("--- END AI DOCS ---");
    expect(prompt).toContain(
      "To further understand the abstractizations here is the same documentation again:",
    );
    expect(prompt.match(/Runner docs body/g)).toHaveLength(2);
  });

  test("estimateTokenCount rounds up", () => {
    expect(estimateTokenCount("12345", 4)).toBe(2);
  });
});
