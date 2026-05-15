"use client";

import { Clock, Layers, FileText } from "lucide-react";

interface StoryboardSummaryProps {
  title: string | null;
  totalScenes: number;
  totalDuration: number | null;
  totalWords: number | null;
  status: string;
}

export function StoryboardSummary({
  title,
  totalScenes,
  totalDuration,
  totalWords,
  status,
}: StoryboardSummaryProps) {
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <h2 className="font-semibold mb-3">{title || "分镜脚本"}</h2>
      <div className="flex gap-6 text-sm text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5" />
          {totalScenes} 个场景
        </span>
        {totalDuration && (
          <span className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            约 {Math.round(totalDuration)} 秒
          </span>
        )}
        {totalWords && (
          <span className="flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" />
            {totalWords} 字
          </span>
        )}
        <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-purple/10 text-purple">
          {status === "READY" ? "就绪" : status === "CONFIRMED" ? "已确认" : status}
        </span>
      </div>
    </div>
  );
}
