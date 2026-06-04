/**
 * Subtitle generation utilities for FFmpeg drawtext.
 *
 * Key design: subtitles sync with voiceover scripts.
 * Each script line = one subtitle chunk, displayed for its speech duration.
 * Multi-line scripts use \n for line breaks within the same time window.
 */

export interface SubtitleConfig {
  videoWidth: number;
  videoHeight: number;
  audioDuration?: number;
  fontPath?: string;
  bottomMarginRatio?: number;
  fontSizeRatio?: number;
}

export interface SubtitleChunk {
  text: string;
  startTime: number;
  endTime: number;
}

export function calcMaxCharsPerLine(videoWidth: number, fontSize: number): number {
  const usableWidth = videoWidth * 0.85;
  // Character width ~= fontSize, so max chars = usableWidth / fontSize
  // Use 0.9 multiplier to account for font character spacing
  return Math.max(8, Math.floor(usableWidth / (fontSize * 0.9)));
}

export function calcFontSize(videoHeight: number, ratio = 1 / 30): number {
  // 1080p → 36px, 720p → 24px. Smaller font = more chars per line
  return Math.max(20, Math.round(videoHeight * ratio));
}

function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code >= 0x4e00 && code <= 0x9fff) {
      width += 1.0;
    } else if (code < 0x80) {
      width += 0.55;
    } else {
      width += 0.8;
    }
  }
  return width;
}

function estimateSpeechDuration(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const nonChineseSpeakable = text
    .replace(/[\u4e00-\u9fff]/g, "")
    .replace(/[，。！？、；：,;!?\s\n"'「」『』【】（）()\[\]·《》—\-—]/g, "").length;

  const chineseSecs = chineseChars / 3.5;
  const nonChineseSecs = nonChineseSpeakable / 5;
  return Math.max(0.8, chineseSecs + nonChineseSecs);
}

/**
 * Break text into display lines that fit within max display width.
 * Returns array of lines (NOT joined) — caller decides how to group them.
 */
function breakIntoLines(text: string, maxCharsPerLine: number): string[] {
  const lines: string[] = [];
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];

  // Split at natural break points
  const sentences = trimmed.split(/(?<=[。！？；,;!?])/).filter(s => s.trim().length > 0);
  const workSentences = sentences.length <= 1
    ? trimmed.split(/(?<=[，,])/).filter(s => s.trim().length > 0)
    : sentences;

  let currentLine = "";

  for (const sentence of workSentences) {
    const combined = currentLine + sentence;
    const combinedWidth = displayWidth(combined);

    if (combinedWidth <= maxCharsPerLine) {
      currentLine = combined;
    } else {
      if (currentLine.length > 0) {
        lines.push(currentLine);
        currentLine = "";
      }

      const sentenceWidth = displayWidth(sentence);
      if (sentenceWidth <= maxCharsPerLine) {
        currentLine = sentence;
      } else {
        // Force-break long sentence character by character
        let remaining = sentence;
        while (remaining.length > 0) {
          if (displayWidth(remaining) <= maxCharsPerLine) {
            lines.push(remaining);
            break;
          }
          let splitAt = 0;
          let width = 0;
          for (let j = 0; j < remaining.length; j++) {
            const code = remaining.charCodeAt(j);
            const chWidth = code >= 0x4e00 && code <= 0x9fff ? 1.0 : code < 0x80 ? 0.55 : 0.8;
            if (width + chWidth > maxCharsPerLine) break;
            width += chWidth;
            splitAt = j + 1;
          }
          if (splitAt === 0) splitAt = 1;
          lines.push(remaining.substring(0, splitAt));
          remaining = remaining.substring(splitAt);
        }
      }
    }
  }

  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  return lines;
}

/**
 * Generate subtitle chunks. When scripts[] is provided, each script becomes
 * one timed chunk — subtitles stay in sync with voiceover pacing.
 */
export function generateSubtitleChunks(
  text: string,
  config: SubtitleConfig,
  scripts?: string[],
): SubtitleChunk[] {
  const fontSize = calcFontSize(config.videoHeight, config.fontSizeRatio);
  const maxCharsPerLine = calcMaxCharsPerLine(config.videoWidth, fontSize);

  if (scripts && scripts.length > 0) {
    return generateScriptChunks(scripts, config, maxCharsPerLine);
  }

  // Fallback: treat entire text as one script
  return generateScriptChunks([text], config, maxCharsPerLine);
}

/**
 * Each clean script = one or more subtitle chunks.
 * If a script is short (≤2 display lines), one chunk shows all lines at once.
 * If a script is long (>2 display lines), split into sequential sub-chunks
 * that appear one after another — each showing 1-2 lines.
 */
function generateScriptChunks(
  scripts: string[],
  config: SubtitleConfig,
  maxCharsPerLine: number,
): SubtitleChunk[] {
  const MAX_LINES_PER_CHUNK = 2;

  // 1. Clean scripts (strip "脚本N：" prefix)
  const cleanScripts = scripts
    .map(s => s.replace(/^脚本\d+[：:]\s*/, "").trim())
    .filter(Boolean);
  if (cleanScripts.length === 0) return [];

  // 2. Calculate speech duration for each script
  const scriptDurations = cleanScripts.map(t => estimateSpeechDuration(t));
  const totalScriptDuration = scriptDurations.reduce((sum, d) => sum + d, 0);
  if (totalScriptDuration === 0) return [];

  // 3. Total available time
  let totalDuration = config.audioDuration && config.audioDuration > 0
    ? config.audioDuration
    : Math.max(1, totalScriptDuration);

  const minReadableTotal = cleanScripts.length * 1.5;
  if (totalDuration < minReadableTotal) {
    totalDuration = minReadableTotal;
  }

  // 4. Build chunks
  const chunks: SubtitleChunk[] = [];
  let timeCursor = 0;

  for (let i = 0; i < cleanScripts.length; i++) {
    const allLines = breakIntoLines(cleanScripts[i], maxCharsPerLine);
    if (allLines.length === 0) continue;

    // Base duration for this script
    const proportion = scriptDurations[i] / totalScriptDuration;
    let scriptDuration = proportion * totalDuration;
    const charCount = cleanScripts[i].replace(/[^\u4e00-\u9fff\w]/g, "").length;
    const minByLength = Math.max(1.5, charCount * 0.12);
    scriptDuration = Math.max(scriptDuration, minByLength);

    const startTime = timeCursor;
    let endTime = timeCursor + scriptDuration;
    if (i === cleanScripts.length - 1) endTime = totalDuration;
    endTime = Math.min(endTime, totalDuration);

    if (allLines.length <= MAX_LINES_PER_CHUNK) {
      // Short script: display all lines at once
      chunks.push({
        text: allLines.join("\n"),
        startTime: Math.round(startTime * 100) / 100,
        endTime: Math.round(endTime * 100) / 100,
      });
    } else {
      // Long script: split into sequential sub-chunks (each 1-2 lines)
      const subChunkCount = Math.ceil(allLines.length / MAX_LINES_PER_CHUNK);
      const subDuration = scriptDuration / subChunkCount;

      for (let j = 0; j < subChunkCount; j++) {
        const lineStart = j * MAX_LINES_PER_CHUNK;
        const lineEnd = Math.min(lineStart + MAX_LINES_PER_CHUNK, allLines.length);
        const subLines = allLines.slice(lineStart, lineEnd);

        const subStart = startTime + j * subDuration;
        const subEnd = j === subChunkCount - 1
          ? endTime
          : subStart + subDuration;

        chunks.push({
          text: subLines.join("\n"),
          startTime: Math.round(subStart * 100) / 100,
          endTime: Math.round(subEnd * 100) / 100,
        });
      }
    }

    timeCursor = endTime;
  }

  return chunks;
}

/**
 * Build FFmpeg filter_complex drawtext chain for subtitle chunks.
 */
export function buildSubtitleFilterChain(
  videoInputLabel: string,
  chunks: SubtitleChunk[],
  config: SubtitleConfig
): { filterParts: string[]; outputLabel: string } {
  const fontSize = calcFontSize(config.videoHeight, config.fontSizeRatio);
  const fontPath = config.fontPath || getDefaultFontPath();
  const bottomMargin = Math.round(config.videoHeight * (config.bottomMarginRatio || 0.06));
  const boxPadding = Math.round(fontSize * 0.3);

  if (chunks.length === 0) {
    return { filterParts: [], outputLabel: videoInputLabel };
  }

  const filterParts: string[] = [];
  // Position from bottom: leave enough room for up to 3+ lines
  const maxLines = 4;
  const estimatedTextHeight = fontSize * maxLines + (maxLines - 1) * 4; // 4px line_spacing
  const yPos = `h-${bottomMargin + estimatedTextHeight}`;
  const drawtextBase = [
    `fontfile='${fontPath}'`,
    `fontsize=${fontSize}`,
    "fontcolor=white@0.95",
    "borderw=2",
    "bordercolor=black@0.7",
    "shadowcolor=black@0.6",
    "shadowx=1",
    "shadowy=1",
    "x=(w-text_w)/2",
    `y=${yPos}`,
    "box=1",
    "boxcolor=black@0.45",
    `boxborderw=${boxPadding}`,
    "expansion=normal",
    "line_spacing=6",
  ].join(":");

  let prevLabel = videoInputLabel;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const isLast = i === chunks.length - 1;
    const outLabel = isLast ? `${videoInputLabel}_sub` : `${videoInputLabel}_s${i}`;

    // Escape for ffmpeg drawtext, but KEEP \n as literal newline
    const escapedText = chunk.text
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "'\\''")
      .replace(/:/g, "\\:")
      .replace(/%/g, "\\%")
      .replace(/\r/g, "");
    // Note: \n is kept as-is — ffmpeg drawtext interprets it as newline

    const filter = `[${prevLabel}]drawtext=${drawtextBase}:text='${escapedText}':enable='between(t\\,${chunk.startTime}\\,${chunk.endTime})' [${outLabel}]`;

    filterParts.push(filter);
    prevLabel = outLabel;
  }

  return {
    filterParts,
    outputLabel: prevLabel,
  };
}

export function getDefaultFontPath(): string {
  if (process.platform === "win32") {
    return String.fromCharCode(67, 92, 58) + "/Windows/Fonts/msyh.ttc";
  }
  return "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc";
}

export function estimateAudioDuration(text: string): number {
  if (text.length === 0) return 1;
  return estimateSpeechDuration(text);
}
