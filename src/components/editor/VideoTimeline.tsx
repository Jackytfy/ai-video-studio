"use client";

import { useState, useRef, useCallback } from "react";
import {
  GripVertical,
  Scissors,
  Trash2,
  Play,
  Pause,
  Volume2,
} from "lucide-react";

export interface TimelineSegment {
  id: string;
  name: string;
  fileUrl: string;
  thumbnailUrl?: string;
  duration: number;
  trimStart?: number;
  trimEnd?: number;
  sortOrder: number;
}

interface VideoTimelineProps {
  segments: TimelineSegment[];
  totalDuration: number;
  currentTime: number;
  isPlaying: boolean;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (time: number) => void;
  onReorder: (segments: TimelineSegment[]) => void;
  onTrim: (segmentId: string) => void;
  onDelete: (segmentId: string) => void;
  onSelect: (segment: TimelineSegment) => void;
  selectedId?: string;
}

export function VideoTimeline({
  segments,
  totalDuration,
  currentTime,
  isPlaying,
  onPlay,
  onPause,
  onSeek,
  onReorder,
  onTrim,
  onDelete,
  onSelect,
  selectedId,
}: VideoTimelineProps) {
  const timelineRef = useRef<HTMLDivElement>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const handleTimelineClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!timelineRef.current) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const ratio = x / rect.width;
      onSeek(ratio * totalDuration);
    },
    [totalDuration, onSeek]
  );

  const handleDragStart = (index: number) => {
    setDragIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index) return;

    const reordered = [...segments];
    const [moved] = reordered.splice(dragIndex, 1);
    reordered.splice(index, 0, moved);

    const updated = reordered.map((seg, i) => ({
      ...seg,
      sortOrder: i,
    }));

    onReorder(updated);
    setDragIndex(index);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const playheadPosition =
    totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Transport Controls */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-border">
        <button
          onClick={isPlaying ? onPause : onPlay}
          className="w-10 h-10 rounded-full bg-purple hover:bg-purple-light text-white flex items-center justify-center transition-colors"
        >
          {isPlaying ? (
            <Pause className="w-4 h-4" />
          ) : (
            <Play className="w-4 h-4 ml-0.5" />
          )}
        </button>

        <div className="flex items-center gap-2 text-sm font-mono text-muted-foreground">
          <span>{formatTime(currentTime)}</span>
          <span>/</span>
          <span>{formatTime(totalDuration)}</span>
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Volume2 className="w-3.5 h-3.5" />
          <span>{segments.length} 个片段</span>
        </div>
      </div>

      {/* Timeline Scrubber */}
      <div
        ref={timelineRef}
        className="relative h-16 bg-secondary/50 cursor-pointer"
        onClick={handleTimelineClick}
      >
        {/* Time markers */}
        <div className="absolute inset-x-0 top-0 h-6 flex items-center px-2 text-[10px] text-muted-foreground/50">
          {Array.from({ length: Math.ceil(totalDuration / 5) + 1 }).map(
            (_, i) => (
              <span
                key={i}
                className="absolute"
                style={{ left: `${(i * 5 / totalDuration) * 100}%` }}
              >
                {formatTime(i * 5)}
              </span>
            )
          )}
        </div>

        {/* Segment blocks */}
        <div className="absolute inset-x-0 bottom-2 top-6 flex gap-0.5 px-2">
          {segments.map((seg, i) => {
            const segDuration =
              (seg.trimEnd ?? seg.duration) - (seg.trimStart ?? 0);
            const widthPct =
              totalDuration > 0 ? (segDuration / totalDuration) * 100 : 0;
            const isSelected = seg.id === selectedId;

            return (
              <div
                key={seg.id}
                draggable
                onDragStart={() => handleDragStart(i)}
                onDragOver={(e) => handleDragOver(e, i)}
                onDragEnd={handleDragEnd}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(seg);
                }}
                className={`
                  relative group flex-shrink-0 rounded overflow-hidden cursor-grab active:cursor-grabbing
                  transition-all border
                  ${
                    isSelected
                      ? "border-purple ring-1 ring-purple/30"
                      : "border-transparent hover:border-purple/50"
                  }
                  ${dragIndex === i ? "opacity-50" : ""}
                `}
                style={{ width: `${widthPct}%` }}
              >
                {/* Thumbnail background */}
                {seg.thumbnailUrl ? (
                  <img
                    src={seg.thumbnailUrl}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover opacity-40"
                  />
                ) : (
                  <div className="absolute inset-0 bg-purple/10" />
                )}

                {/* Segment label */}
                <div className="relative z-10 flex items-center gap-1 px-1.5 h-full">
                  <GripVertical className="w-3 h-3 text-muted-foreground/50 flex-shrink-0" />
                  <span className="text-[10px] text-foreground truncate flex-1">
                    {seg.name}
                  </span>
                </div>

                {/* Actions overlay */}
                <div className="absolute top-0.5 right-0.5 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-20">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onTrim(seg.id);
                    }}
                    className="w-5 h-5 rounded bg-black/60 hover:bg-purple flex items-center justify-center"
                  >
                    <Scissors className="w-2.5 h-2.5 text-white" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(seg.id);
                    }}
                    className="w-5 h-5 rounded bg-black/60 hover:bg-red-500 flex items-center justify-center"
                  >
                    <Trash2 className="w-2.5 h-2.5 text-white" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Playhead */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-30 pointer-events-none"
          style={{ left: `${playheadPosition}%` }}
        >
          <div className="absolute -top-0.5 -left-1.5 w-3 h-2 bg-red-500 rounded-t-sm" />
        </div>
      </div>
    </div>
  );
}
