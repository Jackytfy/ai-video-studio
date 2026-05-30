"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Scissors, X, Check, Play, Pause } from "lucide-react";

interface VideoTrimmerProps {
  videoUrl: string;
  duration: number;
  initialStart?: number;
  initialEnd?: number;
  onConfirm: (trimStart: number, trimEnd: number) => void;
  onClose: () => void;
}

export function VideoTrimmer({
  videoUrl,
  duration,
  initialStart = 0,
  initialEnd,
  onConfirm,
  onClose,
}: VideoTrimmerProps) {
  const [trimStart, setTrimStart] = useState(initialStart);
  const [trimEnd, setTrimEnd] = useState(initialEnd ?? duration);
  const [currentTime, setCurrentTime] = useState(initialStart);
  const [isPlaying, setIsPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const handleTimeUpdate = useCallback(() => {
    if (!videoRef.current) return;
    const time = videoRef.current.currentTime;
    setCurrentTime(time);

    if (time >= trimEnd) {
      videoRef.current.pause();
      setIsPlaying(false);
      videoRef.current.currentTime = trimStart;
    }
  }, [trimEnd, trimStart]);

  const handlePlay = useCallback(() => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = trimStart;
    videoRef.current.play();
    setIsPlaying(true);
  }, [trimStart]);

  const handlePause = useCallback(() => {
    if (!videoRef.current) return;
    videoRef.current.pause();
    setIsPlaying(false);
  }, []);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return `${m}:${s.toString().padStart(2, "0")}.${ms}`;
  };

  const trimDuration = trimEnd - trimStart;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-xl w-full max-w-3xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Scissors className="w-5 h-5 text-purple" />
            <h2 className="text-lg font-semibold">裁剪视频</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-secondary rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Video preview */}
        <div className="p-6 space-y-4">
          <div className="relative rounded-xl overflow-hidden bg-black">
            <video
              ref={videoRef}
              src={videoUrl}
              onTimeUpdate={handleTimeUpdate}
              className="w-full h-64 object-contain"
            />
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
              <button
                onClick={isPlaying ? handlePause : handlePlay}
                className="w-10 h-10 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors"
              >
                {isPlaying ? (
                  <Pause className="w-4 h-4 text-white" />
                ) : (
                  <Play className="w-4 h-4 text-white ml-0.5" />
                )}
              </button>
            </div>
          </div>

          {/* Trim timeline */}
          <div className="space-y-3">
            {/* Waveform-like visualization */}
            <div className="relative h-16 bg-secondary rounded-lg overflow-hidden">
              {/* Progress bar */}
              <div
                className="absolute top-0 bottom-0 bg-purple/20"
                style={{
                  left: `${(trimStart / duration) * 100}%`,
                  width: `${((trimEnd - trimStart) / duration) * 100}%`,
                }}
              />

              {/* Current position */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10"
                style={{ left: `${(currentTime / duration) * 100}%` }}
              />

              {/* Trim handles */}
              <div
                className="absolute top-0 bottom-0 w-3 bg-purple cursor-col-resize z-20 flex items-center justify-center"
                style={{ left: `${(trimStart / duration) * 100}%` }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  const handleMove = (me: MouseEvent) => {
                    const rect = e.currentTarget.parentElement!.getBoundingClientRect();
                    const ratio = Math.max(
                      0,
                      Math.min(1, (me.clientX - rect.left) / rect.width)
                    );
                    const newStart = Math.min(ratio * duration, trimEnd - 0.5);
                    setTrimStart(Math.max(0, newStart));
                  };
                  const handleUp = () => {
                    document.removeEventListener("mousemove", handleMove);
                    document.removeEventListener("mouseup", handleUp);
                  };
                  document.addEventListener("mousemove", handleMove);
                  document.addEventListener("mouseup", handleUp);
                }}
              >
                <div className="w-0.5 h-6 bg-white rounded" />
              </div>

              <div
                className="absolute top-0 bottom-0 w-3 bg-purple cursor-col-resize z-20 flex items-center justify-center"
                style={{ left: `calc(${(trimEnd / duration) * 100}% - 12px)` }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  const handleMove = (me: MouseEvent) => {
                    const rect = e.currentTarget.parentElement!.getBoundingClientRect();
                    const ratio = Math.max(
                      0,
                      Math.min(1, (me.clientX - rect.left) / rect.width)
                    );
                    const newEnd = Math.max(ratio * duration, trimStart + 0.5);
                    setTrimEnd(Math.min(duration, newEnd));
                  };
                  const handleUp = () => {
                    document.removeEventListener("mousemove", handleMove);
                    document.removeEventListener("mouseup", handleUp);
                  };
                  document.addEventListener("mousemove", handleMove);
                  document.addEventListener("mouseup", handleUp);
                }}
              >
                <div className="w-0.5 h-6 bg-white rounded" />
              </div>
            </div>

            {/* Time inputs */}
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">开始时间</label>
                <div className="flex items-center gap-2 bg-secondary rounded-lg px-3 py-2">
                  <input
                    type="range"
                    min={0}
                    max={duration}
                    step={0.1}
                    value={trimStart}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (v < trimEnd - 0.5) setTrimStart(v);
                    }}
                    className="flex-1 accent-purple"
                  />
                  <span className="text-sm font-mono w-16 text-right">
                    {formatTime(trimStart)}
                  </span>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">结束时间</label>
                <div className="flex items-center gap-2 bg-secondary rounded-lg px-3 py-2">
                  <input
                    type="range"
                    min={0}
                    max={duration}
                    step={0.1}
                    value={trimEnd}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (v > trimStart + 0.5) setTrimEnd(v);
                    }}
                    className="flex-1 accent-purple"
                  />
                  <span className="text-sm font-mono w-16 text-right">
                    {formatTime(trimEnd)}
                  </span>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">
                  裁剪时长
                </label>
                <div className="bg-secondary rounded-lg px-3 py-2">
                  <span className="text-sm font-mono text-purple">
                    {formatTime(trimDuration)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            取消
          </button>
          <button
            onClick={() => onConfirm(trimStart, trimEnd)}
            className="flex items-center gap-2 px-6 py-2 bg-purple hover:bg-purple-light text-white rounded-lg text-sm font-medium transition-colors"
          >
            <Check className="w-4 h-4" />
            确认裁剪
          </button>
        </div>
      </div>
    </div>
  );
}
