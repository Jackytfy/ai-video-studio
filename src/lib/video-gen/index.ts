/**
 * Video generation orchestration.
 *
 * Bridges Scene data to video generation providers (currently Agnes Video V2.0).
 * Builds English prompts from visual descriptions and manages the full
 * create → poll → download cycle.
 */

import { join } from "path";
import {
  createVideoTask,
  pollVideoResult,
  downloadVideo,
  type AgnesVideoOptions,
} from "./agnes";
import { generateAIVideoPrompt } from "./prompt";

export interface VideoGenScene {
  visualDesc: string;
  voiceoverText: string;
  materialQuery?: string;
  materialQueryEn?: string;
  sceneNumber: number;
}

export interface VideoGenConfig {
  width: number;
  height: number;
  fps: number;
}

export interface VideoGenResult {
  filePath: string;
  duration: number;
  width: number;
  height: number;
  aiPrompt: string;
  videoId: string;
}

/**
 * Calculate optimal num_frames for Agnes based on target duration and resolution.
 * Agnes API limits: 1080p max 169 frames, 720p max 409, 480p max 961.
 * Must follow 8n+1 rule.
 */
function calcNumFrames(targetSeconds: number, frameRate: number, width: number): number {
  // Determine max frames based on resolution
  const maxFrames = width >= 1920 ? 169 : width >= 1280 ? 409 : 961;
  const raw = Math.ceil((targetSeconds * frameRate) / 8) * 8 + 1;
  return Math.min(maxFrames, Math.max(81, raw));
}

/**
 * Build an English prompt for Agnes Video from scene data.
 *
 * Priority:
 * 1. AI-generated prompt (high quality, understands context)
 * 2. Keyword translation fallback (fast, no AI dependency)
 */
export async function buildAgnesPrompt(
  scene: VideoGenScene,
  onProgress?: (status: string) => void
): Promise<string> {
  // Try AI-powered prompt generation first
  if (process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY) {
    try {
      onProgress?.("generating prompt via AI");
      const aiPrompt = await generateAIVideoPrompt(
        scene.visualDesc,
        scene.voiceoverText,
        scene.materialQueryEn
      );
      onProgress?.(`AI prompt: ${aiPrompt.slice(0, 80)}...`);
      return aiPrompt;
    } catch (err) {
      console.warn("[VideoGen] AI prompt generation failed, falling back to keyword translation:", err);
      onProgress?.("AI prompt failed, using keyword fallback");
    }
  }

  // Fallback: keyword translation
  return buildKeywordPrompt(scene);
}

/**
 * Build prompt using keyword translation (fallback).
 */
function buildKeywordPrompt(scene: VideoGenScene): string {
  const parts: string[] = [];

  // Base: use English keywords if available
  if (scene.materialQueryEn) {
    parts.push(scene.materialQueryEn);
  }

  // Visual description — translate key Chinese concepts to English
  const translated = translateVisualDesc(scene.visualDesc);
  if (translated) {
    parts.push(translated);
  }

  // If nothing useful so far, use materialQuery as last resort
  if (parts.length === 0 && scene.materialQuery) {
    parts.push(scene.materialQuery);
  }

  // Append style suffix
  parts.push("cinematic, high quality, realistic");

  return parts.filter(Boolean).join(", ");
}

/**
 * Translate Chinese visualDesc to English keywords for Agnes prompt.
 * Extracts the most important visual concepts.
 */
function translateVisualDesc(visualDesc: string): string {
  if (!visualDesc) return "";

  // Common Chinese visual terms → English mappings
  const conceptMap: Record<string, string> = {
    // Camera movements
    缓缓: "slowly",
    快速: "quickly",
    逐渐: "gradually",
    镜头: "camera",
    推近: "push in",
    拉远: "pull out",
    俯拍: "overhead shot",
    仰拍: "low angle",
    近景: "close-up",
    远景: "wide shot",
    全景: "full shot",
    特写: "extreme close-up",
    航拍: "aerial shot",
    跟随: "tracking shot",
    // Lighting
    阳光: "sunlight",
    月光: "moonlight",
    烛光: "candlelight",
    逆光: "backlit",
    侧光: "side lighting",
    暖色: "warm tones",
    冷色: "cool tones",
    明亮: "bright",
    昏暗: "dim",
    黎明: "dawn",
    黄昏: "dusk",
    日落: "sunset",
    日出: "sunrise",
    // Environments
    山脉: "mountains",
    河流: "river",
    海洋: "ocean",
    森林: "forest",
    沙漠: "desert",
    城市: "city",
    乡村: "countryside",
    田野: "fields",
    古城: "ancient city",
    宫殿: "palace",
    寺庙: "temple",
    战场: "battlefield",
    // Subjects
    人物: "person",
    人群: "crowd",
    士兵: "soldiers",
    将军: "general",
    皇帝: "emperor",
    诗人: "poet",
    学者: "scholar",
    船: "ship",
    马: "horse",
    城墙: "city wall",
    旗帜: "flags",
    // Style
    纪录片: "documentary",
    电影: "cinematic",
    史诗: "epic",
    壮观: "spectacular",
    宏大: "grand",
    古朴: "ancient style",
    庄严: "solemn",
    辉煌: "magnificent",
    肃穆: "solemn",
    苍凉: "desolate",
    // Time periods
    古代: "ancient",
    现代: "modern",
    近代: "contemporary",
    唐朝: "Tang Dynasty",
    宋朝: "Song Dynasty",
    汉朝: "Han Dynasty",
    秦朝: "Qin Dynasty",
    明朝: "Ming Dynasty",
    清朝: "Qing Dynasty",
    战国: "Warring States",
    三国: "Three Kingdoms",
  };

  // Extract translatable terms
  const translatedParts: string[] = [];
  for (const [cn, en] of Object.entries(conceptMap)) {
    if (visualDesc.includes(cn)) {
      translatedParts.push(en);
    }
  }

  // Also extract any English text already in visualDesc
  const englishWords = visualDesc.match(/[a-zA-Z]{3,}/g);
  if (englishWords) {
    translatedParts.push(...englishWords);
  }

  return translatedParts.join(", ");
}

/**
 * Generate an AI video for a scene using Agnes Video V2.0.
 *
 * Returns null on failure (caller should fall back to stock footage).
 */
export async function generateVideoFromScene(
  scene: VideoGenScene,
  workDir: string,
  config: VideoGenConfig,
  onProgress?: (status: string) => void
): Promise<VideoGenResult | null> {
  try {
    const prompt = await buildAgnesPrompt(scene, onProgress);
    if (!prompt || prompt.length < 5) {
      onProgress?.("skip: prompt too short");
      return null;
    }

    // Calculate frame count from voiceover duration
    const estimatedDuration = estimateVoiceoverDuration(scene.voiceoverText);

    // Generate at 720p to get more frames (max 409 vs 169 at 1080p).
    // Pipeline upscales to target resolution via FFmpeg afterwards.
    const genWidth = 1280;
    const genHeight = 720;
    const numFrames = calcNumFrames(estimatedDuration, config.fps, genWidth);

    const options: AgnesVideoOptions = {
      width: genWidth,
      height: genHeight,
      numFrames,
      frameRate: config.fps,
    };

    onProgress?.("creating task");
    onProgress?.(`generating at ${genWidth}x${genHeight} (${numFrames} frames, ~${(numFrames / config.fps).toFixed(1)}s)`);
    const { videoId } = await createVideoTask(prompt, options);

    onProgress?.("generating");
    const result = await pollVideoResult(videoId, (status, progress) => {
      onProgress?.(`${status} (${progress}%)`);
    });

    if (result.status !== "completed" || !result.videoUrl) {
      const reason = result.status !== "completed"
        ? `generation ${result.status}`
        : "completed but no download URL in response";
      console.warn(`[VideoGen] Scene ${scene.sceneNumber}: ${reason}, falling back to stock footage`);
      onProgress?.(`failed: ${reason}`);
      return null;
    }

    // Download to local file
    const filePath = join(workDir, `agnes-${scene.sceneNumber}.mp4`);
    onProgress?.("downloading");
    await downloadVideo(result.videoUrl, filePath);

    onProgress?.("done");
    return {
      filePath,
      duration: result.seconds,
      width: genWidth,
      height: genHeight,
      aiPrompt: prompt,
      videoId,
    };
  } catch (err) {
    onProgress?.(`error: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/**
 * Estimate voiceover duration from Chinese text.
 * Rough heuristic: ~4 Chinese chars per second.
 */
function estimateVoiceoverDuration(text: string): number {
  if (!text) return 5;
  const charCount = (text.match(/[一-鿿]/g) || []).length;
  return Math.max(3, Math.min(30, charCount / 4));
}
