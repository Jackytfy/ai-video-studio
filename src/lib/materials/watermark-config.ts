/**
 * Watermark removal region configuration.
 *
 * Each region is defined as ratios of video dimensions so it scales
 * across different resolutions. These are empirically determined for
 * common platforms and can be tuned via environment or a management UI.
 */

export interface WatermarkRegionRatio {
  /** X position as fraction of video width (0.0–1.0) */
  x: number;
  /** Y position as fraction of video height (0.0–1.0) */
  y: number;
  /** Width as fraction of video width (0.0–1.0) */
  w: number;
  /** Height as fraction of video height (0.0–1.0) */
  h: number;
}

/**
 * Bilibili watermark regions (ratios).
 * Bilibili places a semi-transparent logo in the top-right corner and
 * the "bilibili" text mark in the bottom-right corner. Some videos also
 * have an uploader watermark in the bottom-left.
 *
 * These ratios are tuned against 16:9 landscape content and may need
 * adjustment for 9:16 vertical videos (Bilibili vertical mode).
 */
export const BILIBILI_WATERMARK_REGIONS: WatermarkRegionRatio[] = [
  // Top-right logo (primary Bilibili brand watermark)
  { x: 0.78, y: 0.01, w: 0.21, h: 0.08 },
  // Bottom-right "bilibili" text / scroller
  { x: 0.82, y: 0.90, w: 0.17, h: 0.08 },
  // Bottom-left uploader watermark (common on mobile uploads)
  { x: 0.01, y: 0.90, w: 0.20, h: 0.08 },
];

/** Douyin / TikTok watermark regions (ratios). */
export const DOUYIN_WATERMARK_REGIONS: WatermarkRegionRatio[] = [
  // Bottom-right douyin moving logo
  { x: 0.85, y: 0.92, w: 0.12, h: 0.06 },
  // Top-right douyin ID watermark
  { x: 0.78, y: 0.02, w: 0.20, h: 0.06 },
];

/**
 * Convert ratio-based regions to absolute pixel coordinates.
 */
export function regionsToPixels(
  regions: WatermarkRegionRatio[],
  width: number,
  height: number
): Array<{ x: number; y: number; width: number; height: number }> {
  return regions.map((r) => ({
    x: Math.round(width * r.x),
    y: Math.round(height * r.y),
    width: Math.round(width * r.w),
    height: Math.round(height * r.h),
  }));
}

/**
 * Get Bilibili watermark regions in absolute pixels.
 */
export function getBilibiliWatermarkRegions(width: number, height: number) {
  return regionsToPixels(BILIBILI_WATERMARK_REGIONS, width, height);
}
