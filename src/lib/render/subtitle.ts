/**
 * Subtitle generation utilities for FFmpeg drawtext.
 *
 * Key improvements:
 * 1. Auto-fontsize based on video height (h/18 ~ h/22)
 * 2. Smart line-breaking with max-chars calculated from video width
 * 3. Punctuation-aware sentence splitting
 * 4. Audio-duration-based timing (instead of fixed chars-per-second guess)
 * 5. Prevents text overflow beyond screen width
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
  /** Scale factor for fontsize relative to video height, default 1/20 */
  fontSizeRatio?: number;
}

export interface SubtitleChunk {
  text: string;
  startTime: number;
  endTime: number;
}

/**
 * Calculate maximum characters per line based on video width and font size.
 *
 * CJK characters are roughly square (width ≈ fontsize).
 * We reserve 7.5% horizontal margin on each side (15% total).
 */
export function calcMaxCharsPerLine(videoWidth: number, fontSize: number): number {
  const usableWidth = videoWidth * 0.85;
  return Math.max(8, Math.floor(usableWidth / (fontSize * 0.95)));
}

/**
 * Calculate adaptive font size based on video height.
 * Taller videos (9:16) get slightly larger fonts relative to height.
 */
export function calcFontSize(videoHeight: number, ratio = 1 / 20): number {
  return Math.round(videoHeight * ratio);
}

/**
 * Smart sentence splitting: break by punctuation first, then by max line length.
 * Punctuation marks are treated as "soft breaks" that we try to respect.
 */
function smartSplit(text: string, maxChars: number): string[] {
  const lines: string[] = [];

  // Remove problematic chars for FFmpeg drawtext
  const cleaned = text
    .replace(/'/g, "")     // single quotes break drawtext
    .replace(/:/g, " ")    // colons confuse filter syntax
    .replace(/\n/g, " ")   // newlines to spaces
    .replace(/"/g, '\\"')  // escape double quotes for drawtext
    .trim();

  if (cleaned.length === 0) return lines;

  // Split by Chinese/English punctuation to get natural sentences
  const sentences = cleaned.split(/(?<=[。！？，；：、,;!?])/);

  let currentLine = "";
  for (const sentence of sentences) {
    // Check if adding this sentence exceeds the line limit
    if (currentLine.length + sentence.length <= maxChars) {
      currentLine += sentence;
    } else {
      // Flush current line if not empty
      if (currentLine.length > 0) {
        lines.push(currentLine);
      }

      // If the sentence itself is longer than maxChars, split it by maxChars
      if (sentence.length <= maxChars) {
        currentLine = sentence;
      } else {
        for (let i = 0; i < sentence.length; i += maxChars) {
          const chunk = sentence.substring(i, i + maxChars);
          if (i + maxChars >= sentence.length) {
            currentLine = chunk;
          } else {
            lines.push(chunk);
          }
        }
      }
    }
  }

  // Flush remaining
  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  return lines;
}

/**
 * Generate subtitle chunks with timing based on text proportion and audio duration.
 *
 * Timing strategy:
 * - If audioDuration is provided, use actual duration for precise sync
 * - Otherwise, estimate from text length (Chinese: ~4 chars/sec, English: ~12 chars/sec)
 * - Each chunk gets time proportional to its character count
 */
export function generateSubtitleChunks(
  text: string,
  config: SubtitleConfig
): SubtitleChunk[] {
  const fontSize = calcFontSize(config.videoHeight, config.fontSizeRatio);
  const maxCharsPerLine = calcMaxCharsPerLine(config.videoWidth, fontSize);

  const lines = smartSplit(text, maxCharsPerLine);

  if (lines.length === 0) return [];

  // Determine total duration
  const textClean = text.replace(/[，。！？、,;!?\s\n]/g, "");
  let totalDuration: number;
  if (config.audioDuration && config.audioDuration > 0) {
    totalDuration = config.audioDuration;
  } else {
    // Fallback: Chinese ~4 chars/sec, English ~12 chars/sec
    const hasChinese = /[\u4e00-\u9fff]/.test(text);
    const rate = hasChinese ? 4 : 12;
    totalDuration = Math.max(1, textClean.length / rate);
  }

  // Distribute time proportional to line length
  const chunks: SubtitleChunk[] = [];
  let timeCursor = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineLength = lines[i].length;
    // Slight overlap: each chunk gets 2% bonus to avoid flash gap
    const chunkDuration = (lineLength / textClean.length) * totalDuration * 1.02;

    const startTime = timeCursor;
    const endTime = Math.min(timeCursor + chunkDuration, totalDuration);

    // Last chunk should always end at totalDuration
    const adjustedEnd = i === lines.length - 1 ? totalDuration : endTime;

    chunks.push({
      text: lines[i],
      startTime: Math.round(startTime * 1000) / 1000,
      endTime: Math.round(adjustedEnd * 1000) / 1000,
    });

    timeCursor = endTime;
  }

  return chunks;
}

/**
 * Build FFmpeg filter_complex drawtext chain for subtitle chunks.
 *
 * Returns an array of filter parts to be joined with ';' in the filter_complex.
 * Uses `enable=between(t,start,end)` for timed display.
 *
 * @param videoInputLabel - The input video label (e.g. "v0" or "[v0s1]")
 * @param chunks - Generated subtitle chunks
 * @param config - Subtitle configuration
 * @returns Array of filter parts and the final output label
 */
export function buildSubtitleFilterChain(
  videoInputLabel: string,
  chunks: SubtitleChunk[],
  config: SubtitleConfig
): { filterParts: string[]; outputLabel: string } {
  const fontSize = calcFontSize(config.videoHeight, config.fontSizeRatio);
  const fontPath = config.fontPath || getDefaultFontPath();
  const bottomMargin = Math.round(config.videoHeight * (config.bottomMarginRatio || 0.06));

  if (chunks.length === 0) {
    return { filterParts: [], outputLabel: videoInputLabel };
  }

  const filterParts: string[] = [];

  // Build drawtext with subtitle positioning
  // x position: center horizontally
  // y position: bottom - margin - text_height (so text doesn't overflow bottom)
  // box: semi-transparent background for readability
  const yPos = `h-text_h-${bottomMargin + fontSize / 2}`;
  const drawtextBase = [
    `fontfile='${fontPath}'`,
    `fontsize=${fontSize}`,
    "fontcolor=white",
    "borderw=3",
    "bordercolor=black",
    "shadowcolor=black",
    "shadowx=2",
    "shadowy=2",
    "x=(w-text_w)/2",
    `y=${yPos}`,
    "box=1",
    "boxcolor=black@0.5",
    "boxborderw=10",
  ].join(":");

  let prevLabel = videoInputLabel;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const isLast = i === chunks.length - 1;
    const outLabel = isLast ? `${videoInputLabel}_sub` : `${videoInputLabel}_s${i}`;

    // Escape text for FFmpeg drawtext
    const escapedText = chunk.text
      .replace(/\\/g, "\\\\")
      .replace(/:/g, "\\:");

    // Build filter: [input]drawtext=params:text='...':enable='...' [output]
    // params are separated by : internally; text/enable are also : separated
    const filter = `[${prevLabel}]drawtext=${drawtextBase}:text='${escapedText}':enable='between(t\\,${chunk.startTime}\\,${chunk.endTime})' [${outLabel}]`;

    filterParts.push(filter);
    prevLabel = outLabel;
  }

  return {
    filterParts,
    outputLabel: prevLabel,
  };
}

/**
 * Get the default font path for the current platform.
 * Windows: Microsoft YaHei (微软雅黑)
 * Linux: Noto Sans CJK
 */
export function getDefaultFontPath(): string {
  if (process.platform === "win32") {
    return "C\\:/Windows/Fonts/msyh.ttc";
  }
  return "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc";
}

/**
 * Estimate audio duration from text length.
 * Chinese: ~4 chars/sec (natural reading speed for subtitles)
 * English: ~12 chars/sec
 * Mixed: weighted average
 */
export function estimateAudioDuration(text: string): number {
  const chineseCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const otherCount = text.length - chineseCount;

  if (text.length === 0) return 1;

  // Chinese speech rate: ~4 chars/sec (slower for readability)
  // English speech rate: ~12 chars/sec
  const chineseSecs = chineseCount / 4;
  const otherSecs = otherCount / 12;

  return Math.max(1, chineseSecs + otherSecs);
}

/**
 * Get actual audio duration using ffprobe.
 * Falls back to text-based estimation on failure.
 */
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
