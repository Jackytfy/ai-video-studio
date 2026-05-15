"use client";

import Link from "next/link";
import { Layers, Clock, ArrowRight } from "lucide-react";

interface StoryboardCardProps {
  projectId: string;
  totalScenes: number;
  totalDuration: number | null;
}

export function StoryboardCard({
  projectId,
  totalScenes,
  totalDuration,
}: StoryboardCardProps) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 max-w-sm">
      <div className="flex items-center gap-2 text-purple mb-3">
        <Layers className="w-4 h-4" />
        <span className="font-semibold text-sm">分镜脚本已生成</span>
      </div>

      <div className="flex gap-4 text-sm text-muted-foreground mb-4">
        <span className="flex items-center gap-1">
          <Layers className="w-3 h-3" />
          {totalScenes} 个场景
        </span>
        {totalDuration && (
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            约 {Math.round(totalDuration)} 秒
          </span>
        )}
      </div>

      <Link
        href={`/projects/${projectId}/storyboard`}
        className="flex items-center justify-center gap-2 w-full bg-purple hover:bg-purple-light text-white py-2 rounded-lg text-sm font-medium transition-colors"
      >
        查看并编辑分镜
        <ArrowRight className="w-3 h-3" />
      </Link>
    </div>
  );
}
