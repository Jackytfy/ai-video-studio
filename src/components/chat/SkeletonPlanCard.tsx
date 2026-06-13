"use client";

import { LayoutList, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

interface SkeletonScene {
  sceneNumber: number;
  title: string;
  sceneType: string;
  voiceoverSummary: string;
  estimatedDuration: number;
}

interface SkeletonPlanData {
  title: string;
  plan: "A" | "B";
  sceneCount: number;
  estimatedDuration: number;
  scenes: SkeletonScene[];
}

interface SkeletonPlanCardProps {
  data: SkeletonPlanData;
}

const planLabels: Record<string, string> = {
  A: "素材剪辑成片",
  B: "素材 + MG 动画",
};

export function SkeletonPlanCard({ data }: SkeletonPlanCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-card border border-border rounded-xl p-5 max-w-lg space-y-4">
      <div className="flex items-center gap-2 text-purple">
        <LayoutList className="w-4 h-4" />
        <span className="font-semibold text-sm">创作骨架规划</span>
      </div>

      <div className="flex items-center gap-3 text-sm">
        <span className="bg-purple/10 text-purple px-2 py-0.5 rounded-full text-xs font-medium">
          方案 {data.plan}
        </span>
        <span className="text-muted-foreground">
          {planLabels[data.plan]}
        </span>
      </div>

      <div className="flex gap-4 text-xs text-muted-foreground">
        <span>{data.sceneCount} 个场景</span>
        <span>约 {Math.round(data.estimatedDuration)} 秒</span>
      </div>

      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-xs text-purple hover:text-purple-light transition-colors"
      >
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        {expanded ? "收起场景列表" : "查看场景列表"}
      </button>

      {expanded && (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {data.scenes.map((scene) => (
            <div
              key={scene.sceneNumber}
              className="bg-secondary rounded-lg p-3 space-y-1"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-purple">
                  场景 {scene.sceneNumber}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  ~{Math.round(scene.estimatedDuration)}s · {scene.sceneType === "REAL_FOOTAGE" ? "实拍" : "动画"}
                </span>
              </div>
              <p className="text-xs font-medium">{scene.title}</p>
              <p className="text-[11px] text-muted-foreground line-clamp-2">
                {scene.voiceoverSummary}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
