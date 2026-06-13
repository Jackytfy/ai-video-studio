"use client";

import { useMemo } from "react";

export interface WatermarkRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface WatermarkOverlayProps {
  videoWidth: number;
  videoHeight: number;
  containerWidth: number;
  containerHeight: number;
  regions: WatermarkRegion[];
  source: string; // e.g. "bilibili", "pexels"
  visible?: boolean;
}

/**
 * Detect watermark regions from video dimensions (mirrors server-side logic).
 */
export function detectWatermarkRegions(
  width: number,
  height: number
): WatermarkRegion[] {
  const regions: WatermarkRegion[] = [];
  const wmW = Math.round(width * 0.15);
  const wmH = Math.round(height * 0.06);
  const margin = Math.round(Math.min(width, height) * 0.02);

  // Bottom-right (most common for Bilibili)
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
 * Watermark overlay — shows red dashed rectangles where watermarks were detected,
 * with a label indicating the source and that auto-crop was applied.
 */
export function WatermarkOverlay({
  videoWidth,
  videoHeight,
  containerWidth,
  containerHeight,
  regions,
  source,
  visible = true,
}: WatermarkOverlayProps) {
  const scaleX = containerWidth / videoWidth;
  const scaleY = containerHeight / videoHeight;

  const scaledRegions = useMemo(
    () =>
      regions.map((r) => ({
        left: r.x * scaleX,
        top: r.y * scaleY,
        width: r.width * scaleX,
        height: r.height * scaleY,
      })),
    [regions, scaleX, scaleY]
  );

  if (!visible || regions.length === 0) return null;

  // Only show for sources that typically have watermarks
  const hasWatermark = source === "bilibili" || source === "youtube";

  if (!hasWatermark) return null;

  return (
    <div className="absolute inset-0 pointer-events-none">
      {scaledRegions.map((r, i) => (
        <div
          key={i}
          className="absolute border-2 border-dashed border-red-400/60"
          style={{
            left: r.left,
            top: r.top,
            width: r.width,
            height: r.height,
          }}
        >
          {i === 0 && (
            <span className="absolute -top-5 left-0 text-[10px] bg-red-500/80 text-white px-1.5 py-0.5 rounded whitespace-nowrap">
              水印区域 (已自动裁剪)
            </span>
          )}
        </div>
      ))}

      {/* Source badge */}
      <div className="absolute top-2 right-2 bg-black/60 px-2 py-0.5 rounded text-[10px] text-yellow-300">
        来源: {source === "bilibili" ? "B站" : source}
      </div>
    </div>
  );
}
