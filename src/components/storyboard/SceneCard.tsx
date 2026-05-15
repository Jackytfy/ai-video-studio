"use client";

import { Film, Wand2, Edit3 } from "lucide-react";

interface Scene {
  id: string;
  sceneNumber: number;
  title: string | null;
  sceneType: string;
  voiceoverText: string;
  visualDesc: string;
  materialQuery: string;
  wordCount: number | null;
  estimatedDuration: number | null;
}

interface SceneCardProps {
  scene: Scene;
  onEdit: (scene: Scene) => void;
}

export function SceneCard({ scene, onEdit }: SceneCardProps) {
  const isAnimation = scene.sceneType === "ANIMATION";

  return (
    <div className="bg-card border border-border rounded-xl p-4 min-w-[280px] max-w-[320px] flex-shrink-0 hover:border-purple/30 transition-all group">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="bg-purple/10 text-purple text-xs font-medium px-2 py-0.5 rounded-full">
            场景 {scene.sceneNumber}
          </span>
          {isAnimation ? (
            <Wand2 className="w-3 h-3 text-muted-foreground" />
          ) : (
            <Film className="w-3 h-3 text-muted-foreground" />
          )}
        </div>
        <button
          onClick={() => onEdit(scene)}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-secondary rounded"
        >
          <Edit3 className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </div>

      {scene.title && (
        <h3 className="font-medium text-sm mb-2">{scene.title}</h3>
      )}

      <p className="text-xs text-muted-foreground line-clamp-3 mb-3">
        {scene.voiceoverText}
      </p>

      <div className="text-[11px] text-muted-foreground/60 bg-secondary/50 rounded px-2 py-1.5 line-clamp-2">
        {scene.visualDesc}
      </div>

      <div className="flex items-center justify-between mt-3 text-[11px] text-muted-foreground">
        <span>{scene.wordCount || "—"} 字</span>
        <span>~{scene.estimatedDuration ? Math.round(scene.estimatedDuration) : "—"}s</span>
      </div>
    </div>
  );
}
