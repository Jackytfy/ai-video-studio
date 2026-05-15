import { ClaudeProvider } from "./claude";
import { OpenAIProvider } from "./openai";
import { AIProvider, AIProviderName, AnalysisResult, StoryboardResult, AIStreamOptions } from "./types";

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
  config: string | ProviderConfig = "claude"
): Promise<AnalysisResult> {
  const ai = getAIProvider(config);
  return ai.analyzeContent(text, style);
}

export async function generateStoryboard(
  text: string,
  plan: "A" | "B",
  sceneCount: number,
  config: string | ProviderConfig = "claude"
): Promise<StoryboardResult> {
  const ai = getAIProvider(config);
  return ai.generateStoryboard(text, plan, sceneCount);
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

export function buildProviderConfig(user: {
  aiProvider?: string;
  aiModel?: string;
  aiBaseUrl?: string;
  aiApiKey?: string;
}): ProviderConfig {
  let provider = user.aiProvider || "claude";

  // Auto-fallback: if Claude selected but no key, try MiMo then OpenAI
  if (provider === "claude" && !user.aiApiKey && !process.env.ANTHROPIC_API_KEY) {
    if (process.env.MIMO_API_KEY) {
      return {
        provider: "openai",
        model: "mimo-v2.5-pro",
        baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
        apiKey: "unused",
        defaultHeaders: { "api-key": process.env.MIMO_API_KEY },
      };
    }
    if (process.env.OPENAI_API_KEY) {
      provider = "openai";
    }
  }

  return {
    provider,
    model: user.aiModel || undefined,
    baseUrl: user.aiBaseUrl || undefined,
    apiKey: user.aiApiKey || undefined,
  };
}
