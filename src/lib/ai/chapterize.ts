/**
 * Long text chapterization and scene-splitting utilities.
 * Breaks long input text into chapters, then each chapter into scene-ready segments.
 */

export interface Chapter {
  index: number;
  title: string;
  content: string;
  wordCount: number;
}

export interface SceneSegment {
  chapterIndex: number;
  sceneIndex: number;
  title: string;
  voiceoverText: string;
  visualDesc: string;
  wordCount: number;
}

/**
 * Split text into chapters based on structural markers.
 * Handles: markdown headings, numbered sections, blank-line-separated blocks.
 */
export function chapterize(text: string): Chapter[] {
  const chapters: Chapter[] = [];

  // Strategy 1: Markdown headings (# ## ### etc.)
  const headingRegex = /^(#{1,4})\s+(.+)$/gm;
  const headingMatches: Array<{ level: number; title: string; index: number }> = [];
  let match;

  while ((match = headingRegex.exec(text)) !== null) {
    headingMatches.push({
      level: match[1].length,
      title: match[2].trim(),
      index: match.index,
    });
  }

  if (headingMatches.length >= 2) {
    for (let i = 0; i < headingMatches.length; i++) {
      const start = headingMatches[i].index;
      const end = i + 1 < headingMatches.length ? headingMatches[i + 1].index : text.length;
      const content = text.slice(start, end).replace(/^#{1,4}\s+.+$/m, "").trim();

      chapters.push({
        index: i,
        title: headingMatches[i].title,
        content,
        wordCount: countWords(content),
      });
    }
    return chapters;
  }

  // Strategy 2: Numbered sections (一、 / 1. / 第一章 etc.)
  const numberedRegex = /^(第[一二三四五六七八九十百千\d]+[章节篇部回]|[\d]+[、.．])\s*(.+)$/gm;
  const numberedMatches: Array<{ title: string; index: number }> = [];

  while ((match = numberedRegex.exec(text)) !== null) {
    numberedMatches.push({
      title: match[0].trim(),
      index: match.index,
    });
  }

  if (numberedMatches.length >= 2) {
    for (let i = 0; i < numberedMatches.length; i++) {
      const start = numberedMatches[i].index;
      const end = i + 1 < numberedMatches.length ? numberedMatches[i + 1].index : text.length;
      const content = text.slice(start, end).replace(numberedRegex, "").trim();

      chapters.push({
        index: i,
        title: numberedMatches[i].title,
        content,
        wordCount: countWords(content),
      });
    }
    return chapters;
  }

  // Strategy 3: Split by double newlines into paragraph blocks
  const blocks = text.split(/\n{2,}/).filter((b) => b.trim().length > 0);

  if (blocks.length <= 1) {
    // Single block — treat entire text as one chapter
    return [{ index: 0, title: "全文", content: text, wordCount: countWords(text) }];
  }

  // Group blocks into chapters (target ~500-800 words per chapter)
  const TARGET_CHAPTER_WORDS = 600;
  let currentChapter = "";
  let currentTitle = "";
  let chapterIdx = 0;

  for (const block of blocks) {
    const blockWords = countWords(block);

    if (currentChapter && countWords(currentChapter) + blockWords > TARGET_CHAPTER_WORDS * 1.5) {
      chapters.push({
        index: chapterIdx++,
        title: currentTitle || `第${chapterIdx + 1}部分`,
        content: currentChapter.trim(),
        wordCount: countWords(currentChapter),
      });
      currentChapter = block;
      currentTitle = "";
    } else {
      currentChapter += (currentChapter ? "\n\n" : "") + block;
      // Use first line as title if short enough
      if (!currentTitle) {
        const firstLine = block.split("\n")[0].trim();
        if (firstLine.length <= 20) {
          currentTitle = firstLine;
        }
      }
    }
  }

  if (currentChapter.trim()) {
    chapters.push({
      index: chapterIdx,
      title: currentTitle || `第${chapterIdx + 1}部分`,
      content: currentChapter.trim(),
      wordCount: countWords(currentChapter),
    });
  }

  return chapters;
}

/**
 * Split a chapter into scene-ready segments.
 * Each segment becomes one scene in the storyboard.
 * Target: ~80-150 words per scene (roughly 20-40 seconds of voiceover).
 */
export function splitChapterToScenes(
  chapter: Chapter,
  targetSceneWords: number = 120
): SceneSegment[] {
  const scenes: SceneSegment[] = [];
  const sentences = splitToSentences(chapter.content);

  if (sentences.length === 0) return scenes;

  let currentText = "";
  let sceneIdx = 0;

  for (const sentence of sentences) {
    const sentenceWords = countWords(sentence);

    if (currentText && countWords(currentText) + sentenceWords > targetSceneWords * 1.3) {
      scenes.push({
        chapterIndex: chapter.index,
        sceneIndex: sceneIdx++,
        title: `${chapter.title} - 场景${sceneIdx}`,
        voiceoverText: currentText.trim(),
        visualDesc: extractVisualHint(currentText),
        wordCount: countWords(currentText),
      });
      currentText = sentence;
    } else {
      currentText += (currentText ? "" : "") + sentence;
    }
  }

  if (currentText.trim()) {
    scenes.push({
      chapterIndex: chapter.index,
      sceneIndex: sceneIdx,
      title: `${chapter.title} - 场景${sceneIdx + 1}`,
      voiceoverText: currentText.trim(),
      visualDesc: extractVisualHint(currentText),
      wordCount: countWords(currentText),
    });
  }

  return scenes;
}

/**
 * Split text into sentences (Chinese + English).
 */
function splitToSentences(text: string): string[] {
  // Split on Chinese/English sentence endings, preserving the delimiter
  const parts = text.split(/(?<=[。！？；.!?;])\s*/);
  return parts.filter((s) => s.trim().length > 0);
}

/**
 * Count words (Chinese chars + English words).
 */
function countWords(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const englishWords = text.replace(/[\u4e00-\u9fff]/g, " ").split(/\s+/).filter((w) => w.length > 0).length;
  return chineseChars + englishWords;
}

/**
 * Extract a visual hint from text for scene description.
 * Takes the first sentence and adds "画面展示" prefix.
 */
function extractVisualHint(text: string): string {
  const firstSentence = text.split(/[。！？.!?]/)[0];
  if (!firstSentence) return "";

  // Extract named entities (people, places, time periods)
  const people = firstSentence.match(/[\u4e00-\u9fff]{2,4}(?=(说|道|笑|哭|走|跑|看|听|想|做|在|去|来|从|到|是|有|被|把|将|给|让|叫|请|派|带|领|送|找|等|会|能|要|敢|肯|愿|得|着|了|过))/g) || [];
  const places = firstSentence.match(/[\u4e00-\u9fff]*(?:城|国|省|市|县|镇|村|山|河|湖|海|岛|宫|殿|庙|寺|院|府|苑|园|台|楼|阁|亭|廊|桥|路|街|巷|门|关)/g) || [];

  const hints: string[] = [];
  if (people.length > 0) hints.push(`人物:${[...new Set(people)].slice(0, 3).join("、")}`);
  if (places.length > 0) hints.push(`地点:${[...new Set(places)].slice(0, 2).join("、")}`);

  return hints.length > 0 ? hints.join("，") : firstSentence.slice(0, 30);
}

/**
 * Full pipeline: text → chapters → scene segments.
 */
export function splitLongText(text: string, targetSceneWords: number = 120): {
  chapters: Chapter[];
  scenes: SceneSegment[];
} {
  const chapters = chapterize(text);
  const scenes: SceneSegment[] = [];

  for (const chapter of chapters) {
    const chapterScenes = splitChapterToScenes(chapter, targetSceneWords);
    scenes.push(...chapterScenes);
  }

  return { chapters, scenes };
}
