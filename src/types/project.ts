export type ProjectStatus =
  | "DRAFT"
  | "ANALYZING"
  | "STORYBOARD_GENERATING"
  | "STORYBOARD_READY"
  | "PRODUCING"
  | "EDITING"
  | "RENDERING"
  | "COMPLETED"
  | "FAILED";

export type AspectRatio = "W_16_9" | "W_9_16" | "W_1_1";

export type ContentStyle =
  | "KNOWLEDGE"
  | "CULTURE"
  | "CLASSIC_HISTORY"
  | "CUSTOM";

export interface Project {
  id: string;
  name: string;
  userId: string;
  status: ProjectStatus;
  sourceText: string;
  sourceType: "TEXT" | "VOICE_UPLOAD";
  audioUploadUrl?: string;
  aspectRatio: AspectRatio;
  contentStyle: ContentStyle;
  colorTheme?: string;
  aiAnalysis?: Record<string, unknown>;
  productionPlan?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  projectId: string;
  role: "USER" | "ASSISTANT" | "SYSTEM";
  content: string;
  messageType: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}
