import { ClaudeProvider } from "./claude";
import { OpenAIProvider } from "./openai";
import { AIProvider, AIProviderName, AnalysisResult, StoryboardResult, AIStreamOptions } from "./types";
import { getCachedResult, setCachedResult } from "./cache";
import { CHAT_SYSTEM_PROMPT } from "./prompts/system";
import { decryptSecret } from "@/lib/utils/crypto";

export interface ProviderConfig {
  provider: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  defaultHeaders?: Record<string, string>;
}

function isMiMoUrl(url?: string): boolean {
  return !!url && (url.includes("xiaomimimo.com") || url.includes("mimo"));
}

export function getAIProvider(config: string | ProviderConfig): AIProvider {
  const cfg: ProviderConfig = typeof config === "string" ? { provider: config } : config;

  switch (cfg.provider) {
    case "claude": {
      const apiKey = cfg.apiKey || process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
      return new ClaudeProvider(apiKey);
    }

    case "openai": {
      // For MiMo URLs, prefer MIMO_API_KEY from env
      const isMiMo = isMiMoUrl(cfg.baseUrl);
      const apiKey = (isMiMo ? (process.env.MIMO_API_KEY || cfg.apiKey) : cfg.apiKey) || process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error("API Key not configured (set OPENAI_API_KEY or MIMO_API_KEY)");

      const defaultHeaders: Record<string, string> = { ...cfg.defaultHeaders };
      let sdkKey = apiKey;

      // MiMo uses `api-key` header auth, not Authorization: Bearer
      if (isMiMoUrl(cfg.baseUrl)) {
        const mimoKey = process.env.MIMO_API_KEY || apiKey;
        defaultHeaders["api-key"] = mimoKey;
        sdkKey = "unused";
      }

      return new OpenAIProvider({
        apiKey: sdkKey,
        baseUrl: cfg.baseUrl,
        model: cfg.model,
        defaultHeaders: Object.keys(defaultHeaders).length > 0 ? defaultHeaders : undefined,
      });
    }

    default:
      throw new Error(`Unknown AI provider: ${cfg.provider}`);
  }
}

export async function analyzeContent(
  text: string,
  style: string,
  config: string | ProviderConfig = "claude",
  materialReqs?: any | null,
): Promise<AnalysisResult> {
  // Check cache first
  const cacheKey = [text.slice(0, 500), style, typeof config === "string" ? config : `${config.provider}:${config.model}`, JSON.stringify(materialReqs || {})];
  const cached = await getCachedResult<AnalysisResult>("analyze", cacheKey);
  if (cached) return cached;

  const ai = getAIProvider(config);
  const result = await ai.analyzeContent(text, style, materialReqs);

  // Store in cache
  await setCachedResult("analyze", cacheKey, result);

  return result;
}

export async function generateStoryboard(
  text: string,
  plan: "A" | "B",
  sceneCount: number,
  config: string | ProviderConfig = "claude"
): Promise<StoryboardResult> {
  // Check cache first
  const cacheKey = [text.slice(0, 500), plan, String(sceneCount), typeof config === "string" ? config : `${config.provider}:${config.model}`];
  const cached = await getCachedResult<StoryboardResult>("storyboard", cacheKey);
  if (cached) return cached;

  const ai = getAIProvider(config);
  const result = await ai.generateStoryboard(text, plan, sceneCount);

  // Store in cache
  await setCachedResult("storyboard", cacheKey, result);

  return result;
}

export async function* chatStream(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  systemPrompt: string,
  config: string | ProviderConfig = "claude",
  options?: AIStreamOptions
): AsyncGenerator<string> {
  const ai = getAIProvider(config);
  yield* ai.chatStream(messages, systemPrompt, options);
}

export interface GenerateAIOptions {
  provider?: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  maxTokens?: number;
}

export async function generateAI(options: GenerateAIOptions): Promise<string> {
  const config: ProviderConfig = {
    provider: options.provider || "claude",
    model: options.model,
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
  };

  const ai = getAIProvider(config);
  let result = "";

  // Use chatStream and collect the full response
  const stream = ai.chatStream(
    options.messages,
    CHAT_SYSTEM_PROMPT
  );

  for await (const chunk of stream) {
    result += chunk;
  }

  return result;
}

export function buildProviderConfig(user: {
  aiProvider?: string;
  aiModel?: string;
  aiBaseUrl?: string;
  aiApiKey?: string;
}): ProviderConfig {
  let provider = user.aiProvider || "claude";

  // API keys are stored encrypted in the DB; decrypt before handing off to the SDK.
  const decryptedKey = decryptSecret(user.aiApiKey) || undefined;

  // Auto-fallback when no API key available for the selected provider
  if (!decryptedKey) {
    if (provider === "claude" && !process.env.ANTHROPIC_API_KEY) {
      if (process.env.MIMO_API_KEY) {
        return {
          provider: "openai",
          model: "mimo-v2.5",
          baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
          apiKey: "unused",
          defaultHeaders: { "api-key": process.env.MIMO_API_KEY },
        };
      }
      if (process.env.OPENAI_API_KEY) {
        provider = "openai";
      }
    }

    if (provider === "openai" && !process.env.OPENAI_API_KEY) {
      // Check if user specified a MiMo base URL
      const isMiMo = isMiMoUrl(user.aiBaseUrl);
      if (isMiMo && process.env.MIMO_API_KEY) {
        return {
          provider: "openai",
          model: user.aiModel || "mimo-v2.5",
          baseUrl: user.aiBaseUrl || "https://token-plan-cn.xiaomimimo.com/v1",
          apiKey: "unused",
          defaultHeaders: { "api-key": process.env.MIMO_API_KEY },
        };
      }
      if (process.env.MIMO_API_KEY) {
        return {
          provider: "openai",
          model: "mimo-v2.5",
          baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
          apiKey: "unused",
          defaultHeaders: { "api-key": process.env.MIMO_API_KEY },
        };
      }
      if (process.env.ANTHROPIC_API_KEY) {
        provider = "claude";
      }
    }
  }

  return {
    provider,
    model: user.aiModel || undefined,
    baseUrl: user.aiBaseUrl || undefined,
    apiKey: decryptedKey,
  };
}

/**
 * Build the fallback chain of provider configs.
 * Used when the primary provider fails — try each in order.
 */
export function buildFallbackChain(
  primaryConfig: ProviderConfig
): ProviderConfig[] {
  const chain: ProviderConfig[] = [primaryConfig];
  const seen = new Set([primaryConfig.provider]);

  // Add MiMo if not already in chain and key is available
  if (!seen.has("openai") && process.env.MIMO_API_KEY) {
    chain.push({
      provider: "openai",
      model: "mimo-v2.5",
      baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
      apiKey: "unused",
      defaultHeaders: { "api-key": process.env.MIMO_API_KEY },
    });
    seen.add("openai");
  }

  // Add OpenAI if not already in chain and key is available
  if (!seen.has("openai") && process.env.OPENAI_API_KEY) {
    chain.push({
      provider: "openai",
      apiKey: process.env.OPENAI_API_KEY,
    });
    seen.add("openai");
  }

  // Add Claude if not already in chain and key is available
  if (!seen.has("claude") && process.env.ANTHROPIC_API_KEY) {
    chain.push({
      provider: "claude",
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
    seen.add("claude");
  }

  return chain;
}

/**
 * Execute an AI operation with fallback chain.
 * Tries each provider in order until one succeeds.
 */
export async function withFallback<T>(
  fn: (provider: AIProvider) => Promise<T>,
  primaryConfig: ProviderConfig
): Promise<T> {
  const chain = buildFallbackChain(primaryConfig);

  let lastError: unknown;
  for (const config of chain) {
    try {
      const provider = getAIProvider(config);
      return await fn(provider);
    } catch (error) {
      lastError = error;
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[AI Fallback] Provider ${config.provider} failed: ${msg}`);

      // Don't fallback for non-retryable errors (auth, validation)
      if (
        msg.includes("401") ||
        msg.includes("403") ||
        msg.includes("invalid") ||
        msg.includes("not configured")
      ) {
        continue;
      }
    }
  }

  throw lastError;
}
