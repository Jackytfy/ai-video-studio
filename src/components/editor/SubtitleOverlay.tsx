"use client";

import { useMemo } from "react";

export interface SubtitleChunk {
  text: string;
  startTime: number;
  endTime: number;
}

interface SubtitleOverlayProps {
  chunks: SubtitleChunk[];
  currentTime: number;
}

export function SubtitleOverlay({ chunks, currentTime }: SubtitleOverlayProps) {
  const activeChunk = useMemo(() => {
    return chunks.find(
      (chunk) => currentTime >= chunk.startTime && currentTime <= chunk.endTime
    );
  }, [chunks, currentTime]);

  if (!activeChunk) return null;

  return (
    <div className="absolute bottom-12 left-1/2 -translate-x-1/2 w-[85%] text-center pointer-events-none">
      <span
        className="inline-block text-white font-medium leading-relaxed px-3 py-1.5 rounded-md"
        style={{
          fontSize: "clamp(14px, 2.5vw, 22px)",
          textShadow: "0 0 4px rgba(0,0,0,0.8), 0 2px 4px rgba(0,0,0,0.6)",
          backgroundColor: "rgba(0,0,0,0.45)",
        }}
      >
        {activeChunk.text.split("\n").map((line, i) => (
          <span key={i}>
            {i > 0 && <br />}
            {line}
          </span>
        ))}
      </span>
    </div>
  );
}
