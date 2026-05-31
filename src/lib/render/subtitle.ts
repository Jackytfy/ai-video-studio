/**
 * Subtitle generation utilities for FFmpeg drawtext.
 *
 * Key improvements:
 * 1. Auto-fontsize based on video height (h/20)
 * 2. Smart line-breaking with display-width-aware calculation
 * 3. Punctuation-aware sentence splitting
 * 4. Support for per-script chunking via productionMeta.scripts
 * 5. Audio-duration-based proportional timing
 * 6. Increased horizontal safety margin to prevent screen-edge clipping
 */

export interface SubtitleConfig {
  videoWidth: number;
  videoHeight: number;
  /** Audio duration in seconds from ffprobe (optional, falls back to text-length estimate) */
  audioDuration?: number;
  /** Font path, platform-aware */
  fontPath?: string;
  /** Bottom margin as fraction of video height, default 0.06 */
  bottomMarginRatio?: number;
  /** Scale factor for fontsize relative to video height, default 1/22 (slightly smaller) */
  fontSizeRatio?: number;
}

export interface SubtitleChunk {
  text: string;
  startTime: number;
  endTime: number;
}

/**
 * Calculate maximum characters per line based on video width and font size.
 * Uses 85% safety margin (was 80%) to prevent edge overflow with box padding.
 */
export function calcMaxCharsPerLine(videoWidth: number, fontSize: number): number {
  const usableWidth = videoWidth * 0.85;
  // CJK chars are ~fontsize wide, 1.05 safety factor for slight variations
  return Math.max(6, Math.floor(usableWidth / (fontSize * 1.05)));
}

/**
 * Calculate adaptive font size based on video height.
 * Slightly smaller ratio (1/22 vs 1/20) for better readability with box borders.
 */
export function calcFontSize(videoHeight: number, ratio = 1 / 22): number {
  return Math.max(22, Math.round(videoHeight * ratio));
}

/**
 * Calculate display width of text (CJK = 1.0, ASCII = 0.55, other = 0.8).
 */
function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code >= 0x4e00 && code <= 0x9fff) {
      width += 1.0; // CJK
    } else if (code < 0x80) {
      width += 0.55; // ASCII
    } else {
      width += 0.8; // Other (fullwidth punctuation, etc.)
    }
  }
  return width;
}

/**
 * Estimate speaking duration for a text segment (Chinese ~3.5 chars/sec, mixed content).
 * Slightly slower rate for better subtitle readability.
 */
function estimateSpeechDuration(text: string): number {
  const chineseChars = (text.match(/[一-鿿]/g) || []).length;
  const nonChineseSpeakable = text
    .replace(/[一-鿿]/g, "")
    .replace(/[，。！？、；：,;!?\s\n"'「」『』【】（）\(\)\[\]·《》—\-\—]/g, "").length;

  const chineseSecs = chineseChars / 3.5;  // slower: 3.5 chars/sec for better reading
  const nonChineseSecs = nonChineseSpeakable / 5;
  return Math.max(0.8, chineseSecs + nonChineseSecs);
}

/**
 * Smart sentence splitting: break by punctuation, then by max line width.
 * Uses display-width aware calculation for mixed CJK/ASCII content.
 */
function smartSplit(text: string, maxCharsPerLine: number): string[] {
  const lines: string[] = [];
  const trimmed = text.trim();
  if (trimmed.length === 0) return lines;

  // Split at natural break points (。！？；,;!?)
  const sentences = trimmed.split(/(?<=[。！？；,;!?])/).filter(s => s.trim().length > 0);

  // If only one sentence, try splitting by commas too
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
      // Flush current line
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
 * Generate subtitle chunks from a list of individual script lines.
 * Each script line becomes a timed chunk, with line-breaking for overflow.
 */
export function generateSubtitleChunks(
  text: string,
  config: SubtitleConfig,
  scripts?: string[],
): SubtitleChunk[] {
  const fontSize = calcFontSize(config.videoHeight, config.fontSizeRatio);
  const maxCharsPerLine = calcMaxCharsPerLine(config.videoWidth, fontSize);

  // If we have individual scripts, chunk by script with per-script timing
  if (scripts && scripts.length > 0) {
    return generateScriptChunks(scripts, config, fontSize, maxCharsPerLine);
  }

  // Fallback: smart-split the full text
  const lines = smartSplit(text, maxCharsPerLine);
  if (lines.length === 0) return [];

  return proportionallyTimeChunks(lines, config);
}

/**
 * Generate chunks from individual script lines, each treated as a separate display unit.
 * Short adjacent scripts may be merged for better pacing.
 */
function generateScriptChunks(
  scripts: string[],
  config: SubtitleConfig,
  _fontSize: number,
  maxCharsPerLine: number,
): SubtitleChunk[] {
  // First, split each script into display lines (handling overflow)
  const displayLines: { text: string; scriptIndex: number }[] = [];

  for (let i = 0; i < scripts.length; i++) {
    const scriptText = scripts[i].replace(/^脚本\d+[：:]\s*/, ""); // strip "脚本N：" prefix
    const lines = smartSplit(scriptText, maxCharsPerLine);
    for (const line of lines) {
      displayLines.push({ text: line, scriptIndex: i });
    }
  }

  if (displayLines.length === 0) return [];

  // If too many display lines, merge short consecutive ones from the same script
  const merged: { text: string }[] = [];
  for (const dl of displayLines) {
    const last = merged[merged.length - 1];
    if (last && displayWidth(last.text + dl.text) <= maxCharsPerLine) {
      merged[merged.length - 1].text += dl.text;
    } else {
      merged.push({ text: dl.text });
    }
  }

  const texts = merged.map(m => m.text);
  return proportionallyTimeChunks(texts, config);
}

/**
 * Distribute timestamps proportionally across text lines.
 */
function proportionallyTimeChunks(
  lines: string[],
  config: SubtitleConfig,
): SubtitleChunk[] {
  const lineDurations = lines.map(line => estimateSpeechDuration(line));
  const totalEstimatedDuration = lineDurations.reduce((sum, d) => sum + d, 0);
  if (totalEstimatedDuration === 0) return [];

  let totalDuration: number;
  if (config.audioDuration && config.audioDuration > 0) {
    totalDuration = config.audioDuration;
  } else {
    totalDuration = Math.max(1, totalEstimatedDuration);
  }

  // Ensure minimum readable duration: if audio is too fast, stretch
  const minReadableTotal = lines.length * 1.5; // at least 1.5s per subtitle line
  if (totalDuration < minReadableTotal) {
    totalDuration = minReadableTotal;
  }

  const chunks: SubtitleChunk[] = [];
  let timeCursor = 0;

  for (let i = 0; i < lines.length; i++) {
    const proportion = lineDurations[i] / totalEstimatedDuration;
    let chunkDuration = proportion * totalDuration * 1.02;

    // Minimum per-line: 1.5s or 0.12s per character, whichever is larger
    const charCount = lines[i].replace(/[^一-鿿a-zA-Z0-9]/g, "").length;
    const minByLength = Math.max(1.2, charCount * 0.12);
    chunkDuration = Math.max(chunkDuration, minByLength);

    let startTime = timeCursor;
    let endTime = timeCursor + chunkDuration;

    if (i === lines.length - 1) {
      endTime = totalDuration;
    }

    endTime = Math.min(endTime, totalDuration);

    if (endTime > totalDuration) {
      endTime = totalDuration;
      startTime = Math.max(0, totalDuration - chunkDuration);
    }

    chunks.push({
      text: lines[i],
      startTime: Math.round(startTime * 100) / 100,
      endTime: Math.round(endTime * 100) / 100,
    });

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
  const boxPadding = Math.round(fontSize * 0.3); // tighter box padding

  if (chunks.length === 0) {
    return { filterParts: [], outputLabel: videoInputLabel };
  }

  const filterParts: string[] = [];
  const yPos = `h-text_h-${bottomMargin + fontSize / 2}`;
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
    "line_spacing=4",
  ].join(":");

  let prevLabel = videoInputLabel;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const isLast = i === chunks.length - 1;
    const outLabel = isLast ? `${videoInputLabel}_sub` : `${videoInputLabel}_s${i}`;

    const escapedText = chunk.text
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "'\\\\''")
      .replace(/:/g, "\\:")
      .replace(/%/g, "\\%")
      .replace(/\n/g, " ")
      .replace(/\r/g, "");

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

export async function getAudioDuration(filePath: string): Promise<number> {
  try {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);

    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath,
    ], { timeout: 5000 });

    const duration = parseFloat(stdout.trim());
    return isNaN(duration) ? 0 : duration;
  } catch {
    return 0;
  }
}
