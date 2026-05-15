import OpenAI from "openai";
import type { AIProvider, AIStreamOptions, AnalysisResult, StoryboardResult } from "./types";
import { getAnalysisPrompt, getStoryboardPrompt } from "./prompts/analysis";

export interface OpenAIProviderOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  defaultHeaders?: Record<string, string>;
}

export class OpenAIProvider implements AIProvider {
  private client: OpenAI;
  private model: string;

  constructor(options: OpenAIProviderOptions) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseUrl,
      defaultHeaders: options.defaultHeaders,
    });
    this.model = options.model || "gpt-4o";
  }

  async analyzeContent(
    text: string,
    style: string,
    options?: AIStreamOptions
  ): Promise<AnalysisResult> {
    const prompt = getAnalysisPrompt(text, style as any);

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response from AI provider");
    }

    return JSON.parse(content) as AnalysisResult;
  }

  async generateStoryboard(
    text: string,
    plan: "A" | "B",
    sceneCount: number,
    options?: AIStreamOptions
  ): Promise<StoryboardResult> {
    const prompt = getStoryboardPrompt(text, plan, sceneCount);

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response from AI provider");
    }

    return JSON.parse(content) as StoryboardResult;
  }

  async *chatStream(
    messages: Array<{ role: "user" | "assistant"; content: string }>,
    systemPrompt: string,
    options?: AIStreamOptions
  ): AsyncGenerator<string> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
      ],
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield content;
        options?.onChunk?.(content);
      }
    }
  }
}
