/**
 * Subtitle generation utilities for FFmpeg drawtext.
 *
 * Key improvements:
 * 1. Auto-fontsize based on video height (h/20)
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
 * CJK characters are roughly square (width ≈ fontsize).
 * We reserve 7.5% horizontal margin on each side (15% total).
 */
export function calcMaxCharsPerLine(videoWidth: number, fontSize: number): number {
  const usableWidth = videoWidth * 0.85;
  return Math.max(8, Math.floor(usableWidth / (fontSize * 0.95)));
}

/**
 * Calculate adaptive font size based on video height.
 */
export function calcFontSize(videoHeight: number, ratio = 1 / 20): number {
  return Math.max(24, Math.round(videoHeight * ratio));
}

/**
 * Count speakable characters (excludes punctuation, spaces, etc.)
 * Used for timing calculations since only spoken characters take time.
 */
function speakableChars(text: string): number {
  return text.replace(/[，。！？、；：,;!?\s\n"'「」『』【】（）\(\)\[\]]/g, "").length;
}

/**
 * Smart sentence splitting: break by punctuation first, then by max line length.
 * Does NOT modify text content - pure splitting only.
 */
function smartSplit(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  const trimmed = text.trim();

  if (trimmed.length === 0) return lines;

  // Split by Chinese/English punctuation to get natural sentences
  // Use positive lookbehind to keep punctuation attached
  const sentences = trimmed.split(/(?<=[。！？；,;!?])|(?<=，[^，]{10,})/).filter(s => s.length > 0);

  let currentLine = "";

  for (const sentence of sentences) {
    // If adding this sentence fits within maxChars
    if (currentLine.length + sentence.length <= maxChars) {
      currentLine += sentence;
    } else {
      // Flush current line
      if (currentLine.length > 0) {
        lines.push(currentLine);
        currentLine = "";
      }

      // Handle sentence that's longer than maxChars
      if (sentence.length <= maxChars) {
        currentLine = sentence;
      } else {
        // Split long sentence by maxChars chunks
        for (let i = 0; i < sentence.length; i += maxChars) {
          const chunk = sentence.substring(i, i + maxChars);
          // If this chunk would leave a tiny remainder, don't split
          const remaining = sentence.length - (i + maxChars);
          if (remaining > 0 && remaining < maxChars * 0.3) {
            // Merge tiny tail with this chunk
            lines.push(sentence.substring(i));
            break;
          }
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
 * Escape text for use in FFmpeg drawtext filter.
 * Only modifies for FFmpeg compatibility - doesn't change visible content.
 */
function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, "\\\\")   // backslash first
    .replace(/'/g, "'\\''")   // single quote: close string, escaped quote, reopen
    .replace(/:/g, "\\:")     // colon escape
    .replace(/%/g, "\\%");    // percent escape (FFmpeg expansion)
}

/**
 * Generate subtitle chunks with timing based on audio/character proportion.
 */
export function generateSubtitleChunks(
  text: string,
  config: SubtitleConfig
): SubtitleChunk[] {
  const fontSize = calcFontSize(config.videoHeight, config.fontSizeRatio);
  const maxCharsPerLine = calcMaxCharsPerLine(config.videoWidth, fontSize);

  const lines = smartSplit(text, maxCharsPerLine);

  if (lines.length === 0) return [];

  // Total speakable characters for timing proportion
  const totalSpeakable = speakableChars(text);
  if (totalSpeakable === 0) return [];

  // Determine total duration
  let totalDuration: number;
  if (config.audioDuration && config.audioDuration > 0) {
    totalDuration = config.audioDuration;
  } else {
    const rate = /[\u4e00-\u9fff]/.test(text) ? 4 : 12;
    totalDuration = Math.max(1, totalSpeakable / rate);
  }

  // Distribute time proportional to each line's speakable character count
  const chunks: SubtitleChunk[] = [];
  let timeCursor = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineSpeakable = speakableChars(lines[i]);
    // Proportion: this line's speakable chars / total speakable chars
    const proportion = lineSpeakable / totalSpeakable;
    // Add 5% padding to prevent flash gaps, but cap at 0.5s
    const chunkDuration = Math.min(proportion * totalDuration * 1.05, proportion * totalDuration + 0.5);

    const startTime = timeCursor;
    let endTime = timeCursor + chunkDuration;

    // Last chunk always ends at totalDuration
    if (i === lines.length - 1) {
      endTime = totalDuration;
    }

    // Ensure minimum display time of 0.5s per chunk
    if (endTime - startTime < 0.5 && lines.length > 1) {
      endTime = startTime + 0.5;
    }

    // Clamp to total duration
    endTime = Math.min(endTime, totalDuration);

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

  if (chunks.length === 0) {
    return { filterParts: [], outputLabel: videoInputLabel };
  }

  const filterParts: string[] = [];
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

    // Remove characters that FFmpeg drawtext can't handle
    const cleanText = chunk.text
      .replace(/\n/g, " ")   // newlines to spaces
      .replace(/\r/g, "");   // remove carriage returns

    // Escape for FFmpeg drawtext (must happen AFTER cleaning)
    const escapedText = escapeDrawtext(cleanText);

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
    return "C\\:/Windows/Fonts/msyh.ttc";
  }
  return "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc";
}

export function estimateAudioDuration(text: string): number {
  const chineseCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const otherCount = text.length - chineseCount;

  if (text.length === 0) return 1;

  const chineseSecs = chineseCount / 4;
  const otherSecs = otherCount / 12;

  return Math.max(1, chineseSecs + otherSecs);
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
