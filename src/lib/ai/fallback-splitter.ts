/**
 * Shared fallback scene splitter — used when AI storyboard generation fails.
 *
 * Extracted from quick-generate/route.ts so both quick-generate and
 * storyboard/generate use the same paragraph-based fallback logic.
 *
 * De-duplicated from issue #44 of framework-issues.md.
 */

import { estimateAudioDuration } from "@/lib/render/subtitle";

export interface SceneData {
  sceneNumber: number;
  title: string;
  sceneType: string;
  voiceoverText: string;
  visualDesc: string;
  materialQuery: string;
  materialQueryEn: string;
  sourceVideos: string[];
  scripts: string[];
  wordCount: number;
  estimatedDuration: number;
}

/**
 * Split raw text into scenes by paragraphs when AI generation fails.
 * Merges short paragraphs and splits long ones by sentence boundaries.
 */
export function fallbackSplitScenes(rawText: string): SceneData[] {
  const paragraphs = rawText
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, "").trim())
    .filter((p) => p.length > 0);

  if (paragraphs.length === 0) {
    paragraphs.push(rawText);
  }

  // Merge short paragraphs (< 40 chars) with previous
  const merged: string[] = [];
  for (const p of paragraphs) {
    if (merged.length > 0 && p.length < 40) {
      merged[merged.length - 1] += p;
    } else {
      merged.push(p);
    }
  }

  // Split long paragraphs (> 150 chars) by sentences
  const scenes: SceneData[] = [];
  let sceneNum = 1;

  for (const para of merged) {
    const subScenes = splitParagraph(para, sceneNum);
    scenes.push(...subScenes);
    sceneNum += subScenes.length;
  }

  return scenes;
}

function splitParagraph(para: string, startNum: number): SceneData[] {
  if (para.length <= 150) {
    return [makeScene(para, startNum)];
  }

  // Split by sentence boundaries
  const sentences = para.match(/[^。！？]+[。！？]?/g) || [para];
  const scenes: SceneData[] = [];
  let currentText = "";
  let num = startNum;

  for (const sent of sentences) {
    currentText += sent;
    if (currentText.length >= 60) {
      scenes.push(makeScene(currentText.trim(), num++));
      currentText = "";
    }
  }

  if (currentText.trim()) {
    scenes.push(makeScene(currentText.trim(), num++));
  }

  return scenes;
}

function makeScene(text: string, sceneNumber: number): SceneData {
  return {
    sceneNumber,
    title: text.slice(0, 10),
    sceneType: "REAL_FOOTAGE",
    voiceoverText: text,
    visualDesc: text.slice(0, 80),
    materialQuery: text.replace(/[，。！？、]/g, " ").slice(0, 30),
    materialQueryEn: "",
    sourceVideos: [],
    scripts: [text],
    wordCount: text.length,
    estimatedDuration: Math.round(estimateAudioDuration(text)),
  };
}
