import Anthropic from "@anthropic-ai/sdk";
import type { AIProvider, AIStreamOptions, AnalysisResult, StoryboardResult } from "./types";
import { getAnalysisPrompt, getStoryboardPrompt } from "./prompts/analysis";

export class ClaudeProvider implements AIProvider {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async analyzeContent(
    text: string,
    style: string,
    options?: AIStreamOptions
  ): Promise<AnalysisResult> {
    const prompt = getAnalysisPrompt(text, style as any);

    const response = await this.client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });

    const content = response.content[0];
    if (content.type !== "text") {
      throw new Error("Unexpected response type from Claude");
    }

    const jsonMatch = content.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Failed to parse AI response as JSON");
    }

    return JSON.parse(jsonMatch[0]) as AnalysisResult;
  }

  async generateStoryboard(
    text: string,
    plan: "A" | "B",
    sceneCount: number,
    options?: AIStreamOptions
  ): Promise<StoryboardResult> {
    const prompt = getStoryboardPrompt(text, plan, sceneCount);

    const response = await this.client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
    });

    const content = response.content[0];
    if (content.type !== "text") {
      throw new Error("Unexpected response type from Claude");
    }

    const jsonMatch = content.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Failed to parse AI response as JSON");
    }

    return JSON.parse(jsonMatch[0]) as StoryboardResult;
  }

  async *chatStream(
    messages: Array<{ role: "user" | "assistant"; content: string }>,
    systemPrompt: string,
    options?: AIStreamOptions
  ): AsyncGenerator<string> {
    const stream = await this.client.messages.stream({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      system: systemPrompt,
      messages,
    });

    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        yield event.delta.text;
        options?.onChunk?.(event.delta.text);
      }
    }
  }
}
