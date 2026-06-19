/**
 * AI-powered video prompt generation for Agnes Video V2.0.
 *
 * Uses the AI provider to translate Chinese visual descriptions into
 * optimized English prompts for text-to-video generation.
 */

import { chatStream } from "@/lib/ai/router";
import type { ProviderConfig } from "@/lib/ai/router";

const VIDEO_PROMPT_SYSTEM = `You are an expert prompt engineer for AI video generation models (like Agnes Video, Runway, Kling).

Your task: Convert a Chinese visual scene description into an optimized English prompt for text-to-video generation.

RULES:
1. Output ONLY the English prompt. No explanations, no markdown, no quotes.
2. Length: 50-100 words. Be concise but vivid.
3. Structure: [Subject] + [Action] + [Scene/Environment] + [Camera Movement] + [Lighting] + [Style]
4. Use present tense, active voice.
5. Be specific about visual details: colors, textures, positions, movements.
6. Include camera language: "slow push-in", "aerial shot", "close-up", "tracking shot", etc.
7. End with style keywords: "cinematic, documentary style, realistic, high quality"
8. Do NOT include: text overlays, subtitles, logos, watermarks.
9. Do NOT describe audio or narration - focus purely on visuals.
10. If English keywords are provided, incorporate them naturally.`;

/**
 * Generate an optimized English video prompt using AI.
 *
 * @param visualDesc - Chinese visual description from storyboard
 * @param voiceoverText - Chinese narration (for context, not included in prompt)
 * @param materialQueryEn - Optional English keywords from storyboard
 * @param providerConfig - AI provider config (uses default if not specified)
 * @returns English prompt optimized for Agnes Video API
 * @throws Error if AI call fails (caller should fallback to keyword translation)
 */
export async function generateAIVideoPrompt(
  visualDesc: string,
  voiceoverText: string,
  materialQueryEn?: string,
  providerConfig?: ProviderConfig
): Promise<string> {
  // Build user message with context
  const parts: string[] = [];

  if (materialQueryEn) {
    parts.push(`English keywords: ${materialQueryEn}`);
  }

  parts.push(`Chinese visual description:\n${visualDesc}`);

  // Add voiceover context (helps AI understand the scene mood)
  if (voiceoverText) {
    const voiceoverSnippet = voiceoverText.slice(0, 200);
    parts.push(`Narration context (for mood reference only):\n${voiceoverSnippet}`);
  }

  const userMessage = parts.join("\n\n");

  // Call AI via chatStream
  const config = providerConfig || "claude";
  let result = "";

  const stream = chatStream(
    [{ role: "user", content: userMessage }],
    VIDEO_PROMPT_SYSTEM,
    config
  );

  for await (const chunk of stream) {
    result += chunk;
  }

  // Clean up the result
  const cleaned = result
    .trim()
    .replace(/^["']|["']$/g, "") // Remove surrounding quotes
    .replace(/^```[\s\S]*?```$/gm, "") // Remove code blocks
    .replace(/\n+/g, " ") // Collapse newlines
    .trim();

  if (cleaned.length < 10) {
    throw new Error("AI generated prompt too short");
  }

  return cleaned;
}
