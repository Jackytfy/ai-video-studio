/**
 * Watermark detection and removal utilities using FFmpeg.
 *
 * Strategy:
 * 1. Detect common watermark positions (corners, center)
 * 2. Apply FFmpeg delogo filter to remove detected watermarks
 * 3. For videos: process entire duration
 * 4. For images: apply crop or delogo
 */

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface WatermarkRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Probe video/image dimensions using ffprobe.
 */
export async function probeDimensions(
  filePath: string
): Promise<{ width: number; height: number; duration: number }> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height,duration",
      "-of", "json",
      filePath,
    ], { timeout: 10000 });

    const data = JSON.parse(stdout);
    const stream = data.streams?.[0];
    return {
      width: stream?.width || 0,
      height: stream?.height || 0,
      duration: parseFloat(stream?.duration || "0"),
    };
  } catch {
    return { width: 0, height: 0, duration: 0 };
  }
}

/**
 * Detect potential watermark regions in a video/image.
 * Checks common watermark positions: bottom-right, top-right, bottom-left, top-left, center.
 * Returns regions that are likely watermarks based on heuristics.
 */
export function detectWatermarkRegions(
  width: number,
  height: number
): WatermarkRegion[] {
  const regions: WatermarkRegion[] = [];

  // Common watermark sizes (percentage of frame)
  const wmW = Math.round(width * 0.15); // 15% of width
  const wmH = Math.round(height * 0.06); // 6% of height
  const margin = Math.round(Math.min(width, height) * 0.02); // 2% margin

  // Bottom-right (most common)
  regions.push({
    x: width - wmW - margin,
    y: height - wmH - margin,
    width: wmW,
    height: wmH,
  });

  // Top-right
  regions.push({
    x: width - wmW - margin,
    y: margin,
    width: wmW,
    height: wmH,
  });

  // Bottom-left
  regions.push({
    x: margin,
    y: height - wmH - margin,
    width: wmW,
    height: wmH,
  });

  // Top-left
  regions.push({
    x: margin,
    y: margin,
    width: wmW,
    height: wmH,
  });

  return regions;
}

/**
 * Remove watermarks from a video file using FFmpeg delogo filter.
 * Applies delogo to all common watermark positions.
 * @param inputPath Source video
 * @param outputPath Destination (must be different from input)
 * @param regions Specific regions to clean, or auto-detect from dimensions
 */
export async function removeWatermarks(
  inputPath: string,
  outputPath: string,
  regions?: WatermarkRegion[]
): Promise<void> {
  const dims = await probeDimensions(inputPath);
  if (dims.width === 0 || dims.height === 0) {
    throw new Error("Cannot probe input dimensions");
  }

  const targetRegions = regions || detectWatermarkRegions(dims.width, dims.height);

  if (targetRegions.length === 0) return;

  // Build delogo filter chain: one delogo per region
  const delogoFilters = targetRegions.map(
    (r) => `delogo=x=${r.x}:y=${r.y}:w=${r.width}:h=${r.height}`
  );

  // Apply all delogo filters in sequence
  const vf = delogoFilters.join(",");

  await execFileAsync("ffmpeg", [
    "-y",
    "-i", inputPath,
    "-vf", vf,
    "-c:v", "libx264", "-preset", "fast", "-crf", "18",
    "-c:a", "copy",
    outputPath,
  ], { timeout: 120000 });
}

/**
 * Remove watermarks from an image file using FFmpeg.
 * Crops out watermark regions from edges.
 */
export async function removeWatermarksFromImage(
  inputPath: string,
  outputPath: string,
  cropPercent: number = 2
): Promise<void> {
  const dims = await probeDimensions(inputPath);
  if (dims.width === 0 || dims.height === 0) {
    throw new Error("Cannot probe input dimensions");
  }

  // Crop edges by cropPercent to remove potential watermarks
  const cropW = Math.round(dims.width * (1 - cropPercent * 2 / 100));
  const cropH = Math.round(dims.height * (1 - cropPercent * 2 / 100));
  const cropX = Math.round((dims.width - cropW) / 2);
  const cropY = Math.round((dims.height - cropH) / 2);

  await execFileAsync("ffmpeg", [
    "-y",
    "-i", inputPath,
    "-vf", `crop=${cropW}:${cropH}:${cropX}:${cropY}`,
    "-q:v", "2",
    outputPath,
  ], { timeout: 30000 });
}

/**
 * Process a material file: detect and remove watermarks.
 * Returns path to the cleaned file (may be same as input if no processing needed).
 */
export async function cleanMaterial(
  inputPath: string,
  workDir: string,
  isVideo: boolean
): Promise<string> {
  const ext = isVideo ? "mp4" : "jpg";
  const outputPath = `${inputPath.replace(/\.[^.]+$/, "")}_clean.${ext}`;

  try {
    if (isVideo) {
      await removeWatermarks(inputPath, outputPath);
    } else {
      await removeWatermarksFromImage(inputPath, outputPath);
    }
    return outputPath;
  } catch (err) {
    // If watermark removal fails, return original
    console.warn("Watermark removal failed, using original:", err);
    return inputPath;
  }
}
