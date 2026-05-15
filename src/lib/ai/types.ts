export type AIProviderName = "claude" | "openai";

export interface AIStreamOptions {
  onChunk?: (chunk: string) => void;
  onComplete?: (fullText: string) => void;
}

export interface AIProvider {
  analyzeContent(text: string, style: string, options?: AIStreamOptions): Promise<AnalysisResult>;
  generateStoryboard(text: string, plan: "A" | "B", sceneCount: number, options?: AIStreamOptions): Promise<StoryboardResult>;
  chatStream(messages: Array<{ role: "user" | "assistant"; content: string }>, systemPrompt: string, options?: AIStreamOptions): AsyncGenerator<string>;
}

export interface AnalysisResult {
  summary: string;
  entities: {
    people: string[];
    places: string[];
    events: string[];
    timePeriods: string[];
  };
  contentCategory: string;
  keyTopics: string[];
  suggestedPlan: "A" | "B";
  planReason: string;
  sceneCount: number;
  estimatedDuration: number;
}

export interface SceneInput {
  sceneNumber: number;
  title: string;
  sceneType: "REAL_FOOTAGE" | "ANIMATION";
  voiceoverText: string;
  visualDesc: string;
  materialQuery: string;
  wordCount: number;
}

export interface StoryboardResult {
  title: string;
  scenes: SceneInput[];
  totalWords: number;
  estimatedDuration: number;
}

export interface ChatContext {
  projectId: string;
  sourceText: string;
  currentStage: "input" | "analysis" | "plan_selection" | "storyboard" | "editing";
  analysis?: AnalysisResult;
  selectedPlan?: "A" | "B";
}
